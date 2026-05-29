/**
 * photoCacheService.ts
 * IndexedDB를 이용한 사진 자동 백업/복구 서비스
 *
 * 흐름:
 *  - 사진이 메모리에 로드되면 → IndexedDB에 자동 저장 (백업)
 *  - 페이지 재시작 시 → 미저장 캐시 확인 → 복구 배너 표시
 *  - 서버 저장 성공 시 → 해당 접수번호 캐시 삭제
 */

const DB_NAME = 'ktl_photo_cache';
const DB_VERSION = 1;
const STORE = 'photos';

export interface CachedPhoto {
  key: string;          // `${receiptNumber}||${pageCode}||${uid}`
  receiptNumber: string;
  pageCode: 'P1' | 'P2' | 'P3' | 'P4' | 'EXTRA';
  uid: string;
  base64: string;
  mimeType: string;
  fileName: string;
  comment?: string;
  photoType?: string;   // EXTRA 전용: 사진 유형 ('기록부' | '추가 증빙자료' | ...)
  savedAt: number;      // timestamp
}

export interface CacheSummary {
  receiptNumber: string;
  pageCode: string;
  photoCount: number;
  savedAt: number;
}

// ── DB 연결 ──────────────────────────────────────────────
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('by_receipt', 'receiptNumber', { unique: false });
        store.createIndex('by_receipt_page', ['receiptNumber', 'pageCode'], { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db!);
    };
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });

  return _dbPromise;
}

// ── 사진 캐시 저장 ────────────────────────────────────────
export async function cachePhotos(
  receiptNumber: string,
  pageCode: 'P1' | 'P2' | 'P3' | 'P4',  // EXTRA는 cacheExtraPhotos 전용 사용
  photos: Array<{ uid: string; base64: string; mimeType: string; file: { name: string } }>,
  photoComments: Record<string, string> = {}
): Promise<void> {
  if (photos.length === 0) return;
  const db = await openDB();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    // 기존 항목 삭제 후 전체 재작성
    const idx = store.index('by_receipt_page');
    const range = IDBKeyRange.only([receiptNumber, pageCode]);
    const delReq = idx.openCursor(range);
    delReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) { cursor.delete(); cursor.continue(); }
      else {
        // 새 사진 삽입
        for (const p of photos) {
          const record: CachedPhoto = {
            key: `${receiptNumber}||${pageCode}||${p.uid}`,
            receiptNumber,
            pageCode,
            uid: p.uid,
            base64: p.base64,
            mimeType: p.mimeType,
            fileName: p.file.name,
            comment: photoComments[p.uid],
            savedAt: now,
          };
          store.put(record);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── 접수번호의 캐시된 사진 불러오기 ────────────────────────
export async function loadCachedPhotos(
  receiptNumber: string,
  pageCode?: 'P1' | 'P2' | 'P3' | 'P4' | 'EXTRA'
): Promise<CachedPhoto[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);

    const results: CachedPhoto[] = [];
    const idx = pageCode
      ? store.index('by_receipt_page')
      : store.index('by_receipt');
    const range = pageCode
      ? IDBKeyRange.only([receiptNumber, pageCode])
      : IDBKeyRange.only(receiptNumber);

    const req = idx.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── 접수번호 캐시 삭제 (서버 저장 성공 후 호출) ────────────
export async function clearCachedPhotos(
  receiptNumber: string,
  pageCode?: 'P1' | 'P2' | 'P3' | 'P4' | 'EXTRA'
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    const idx = pageCode
      ? store.index('by_receipt_page')
      : store.index('by_receipt');
    const range = pageCode
      ? IDBKeyRange.only([receiptNumber, pageCode])
      : IDBKeyRange.only(receiptNumber);

    const req = idx.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) { cursor.delete(); cursor.continue(); }
      else resolve();
    };
    req.onerror = () => reject(req.error);

    tx.oncomplete = () => resolve();
  });
}

// ── 전체 캐시 요약 (복구 배너용) ─────────────────────────
export async function getAllCacheSummaries(): Promise<CacheSummary[]> {
  const db = await openDB();

  const all: CachedPhoto[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // receipt+pageCode 기준으로 그룹화
  const map = new Map<string, CacheSummary>();
  for (const p of all) {
    const k = `${p.receiptNumber}||${p.pageCode}`;
    const existing = map.get(k);
    if (existing) {
      existing.photoCount++;
      if (p.savedAt > existing.savedAt) existing.savedAt = p.savedAt;
    } else {
      map.set(k, {
        receiptNumber: p.receiptNumber,
        pageCode: p.pageCode,
        photoCount: 1,
        savedAt: p.savedAt,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.savedAt - a.savedAt);
}

// ── EXTRA 사진자료 전용 함수 ──────────────────────────────
// File → base64 변환 (캐시 저장 시점에만 사용)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data:...;base64, 접두사 제거하여 순수 base64만 반환
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** EXTRA 추가 사진자료를 IndexedDB에 캐시 저장
 *  - File을 base64로 변환 후 저장 (변환 후 base64를 state에 보관하지 않음)
 */
export async function cacheExtraPhotos(
  receiptNumber: string,
  photos: Array<{
    uid: string;
    file: File;
    mimeType: string;
    photoType: string;
    comment: string;
  }>
): Promise<void> {
  const db = await openDB();
  const now = Date.now();

  // 파일들을 base64로 일괄 변환
  const records: CachedPhoto[] = await Promise.all(
    photos.map(async (p, idx) => ({
      key: `${receiptNumber}||EXTRA||${p.uid}`,
      receiptNumber,
      pageCode: 'EXTRA' as const,
      uid: p.uid,
      base64: await fileToBase64(p.file),
      mimeType: p.mimeType,
      fileName: p.file.name,
      comment: p.comment,
      photoType: p.photoType,
      savedAt: now + idx,
    }))
  );

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // 기존 EXTRA 캐시 삭제 후 전체 재작성
    const idx = store.index('by_receipt_page');
    const range = IDBKeyRange.only([receiptNumber, 'EXTRA']);
    const delReq = idx.openCursor(range);
    delReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) { cursor.delete(); cursor.continue(); }
      else {
        for (const record of records) {
          store.put(record);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** EXTRA 캐시에서 추가 사진자료 복원
 *  - base64 → Blob → File 변환 후 반환 (호출자가 Object URL 생성)
 */
export async function loadCachedExtraPhotos(
  receiptNumber: string
): Promise<Array<{
  uid: string;
  file: File;
  mimeType: string;
  photoType: string;
  comment: string;
  order: number;
}>> {
  const cached = await loadCachedPhotos(receiptNumber, 'EXTRA');
  if (cached.length === 0) return [];

  return cached
    .sort((a, b) => a.savedAt - b.savedAt)
    .map((item, idx) => {
      // base64 → Blob → File 변환
      const binaryStr = atob(item.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: item.mimeType });
      const file = new File([blob], item.fileName, { type: item.mimeType });
      return {
        uid: item.uid,
        file,
        mimeType: item.mimeType,
        photoType: item.photoType ?? '기타',
        comment: item.comment ?? '',
        order: idx,
      };
    });
}
