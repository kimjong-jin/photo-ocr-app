/**
 * locationService.ts
 *
 * 위치 데이터를 Mac Studio(서버) ↔ parser.work(클라이언트) 간 실시간 연동.
 * 사용자별 완전 분리: 김종진의 위치는 김종진만, 권민경의 위치는 권민경만 볼 수 있음.
 *
 * 서버 미연결 시 IndexedDB 로컬 폴백으로 동작 (사용자별 별도 DB 이름 사용).
 */

const API_BASE = '/api/locations';

export interface LocationEntry {
  id: string;       // 접수번호: "26-031078-01" 또는 "26-031078-01-1"
  address: string;
  lat: number;
  lng: number;
  savedAt: number;
  siteName?: string; // 현장명 (저장 시 함께 보관)
}

// ── 현재 로그인 사용자 이름 (PageContainer에서 주입) ─────────────
let _currentUserName = '';
export function setLocationUserName(name: string) {
  _currentUserName = name;
}
function getUN(): string {
  return _currentUserName || localStorage.getItem('ktl_user_name') || '';
}

// ── 연결 상태 체크 ─────────────────────────────────────────────────
let _serverAvailable: boolean | null = null;

async function isServerAvailable(): Promise<boolean> {
  if (_serverAvailable !== null) return _serverAvailable;
  const un = getUN();
  if (!un) return false;
  try {
    const res = await fetch(`${API_BASE}?userName=${encodeURIComponent(un)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    _serverAvailable = res.ok || res.status === 400; // 400도 서버 살아있음
  } catch {
    _serverAvailable = false;
  }
  setTimeout(() => { _serverAvailable = null; }, 10_000);
  return _serverAvailable;
}

// ── IndexedDB 폴백 (서버 미연결 시, 사용자별 DB) ──────────────────
function getDBName(): string {
  return `ktl-location-db-${getUN() || 'default'}`;
}
const DB_VERSION = 1;
const STORE_NAME = 'locations';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(getDBName(), DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<LocationEntry[]> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as LocationEntry[]).sort((a, b) => b.savedAt - a.savedAt));
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(entry: LocationEntry): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── 공개 API ──────────────────────────────────────────────────────

export async function getAllLocations(): Promise<LocationEntry[]> {
  const un = getUN();
  if (!un) return [];
  if (await isServerAvailable()) {
    try {
      const res = await fetch(`${API_BASE}?userName=${encodeURIComponent(un)}`);
      if (!res.ok) throw new Error('server error');
      return await res.json() as LocationEntry[];
    } catch {
      _serverAvailable = false;
    }
  }
  return idbGetAll();
}

export async function saveLocation(entry: LocationEntry): Promise<void> {
  const un = getUN();
  if (!un) { await idbPut(entry); return; }
  if (await isServerAvailable()) {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...entry, userName: un }),
      });
      if (!res.ok) throw new Error('server error');
      return;
    } catch {
      _serverAvailable = false;
    }
  }
  return idbPut(entry);
}

export async function deleteLocation(id: string): Promise<void> {
  const un = getUN();
  if (!un) { await idbDelete(id); return; }
  if (await isServerAvailable()) {
    try {
      const res = await fetch(
        `${API_BASE}?id=${encodeURIComponent(id)}&userName=${encodeURIComponent(un)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('server error');
      return;
    } catch {
      _serverAvailable = false;
    }
  }
  return idbDelete(id);
}

/** 접수번호 base(예: "25-000000-01")와 관련된 모든 위치 일괄 삭제
 *  - "25-000000-01" 및 "25-000000-01-1", "-2", "-3" 등 전부 제거 */
export async function deleteLocationsByBase(baseId: string): Promise<void> {
  const all = await getAllLocations();
  const toDelete = all.filter(l =>
    l.id === baseId || l.id.startsWith(baseId + '-')
  );
  await Promise.allSettled(toDelete.map(l => deleteLocation(l.id)));
}

export async function getLocation(id: string): Promise<LocationEntry | null> {
  const all = await getAllLocations();
  return all.find(l => l.id === id) ?? null;
}

// ── GPS / 지오코딩 유틸 ────────────────────────────────────────────

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
      { headers: { Authorization: `KakaoAK ${(import.meta as any).env?.VITE_KAKAO_REST_API_KEY || ''}` } }
    );
    if (!res.ok) throw new Error('geocode fail');
    const data = await res.json();
    const doc = data.documents?.[0];
    return doc?.road_address?.address_name || doc?.address?.address_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation 미지원 (맥 스튜디오는 주소 직접 입력 권장)'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export async function extractGpsFromImage(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const exifr = await import('exifr').catch(() => null);
    if (!exifr) return null;
    const gps = await (exifr as any).gps(file);
    if (gps?.latitude && gps?.longitude) return { lat: gps.latitude, lng: gps.longitude };
    return null;
  } catch {
    return null;
  }
}

export function isValidReceiptId(id: string): boolean {
  return /^\d{2}-\d{6}-\d{2}(-\d+)?$/.test(id.trim());
}

export async function getServerStatus(): Promise<'server' | 'local'> {
  return (await isServerAvailable()) ? 'server' : 'local';
}
