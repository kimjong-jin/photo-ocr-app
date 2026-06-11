// services/photoStorageService.ts
// 맥스튜디오 사진 서버와의 통신 서비스
// Vercel /api/photos 프록시를 통해 접근

import axios from 'axios';
import { compressImage } from './imageStampingService';

const PHOTO_API = '/api/photos';

export interface ServerPhoto {
  id: number;
  filename: string;
  original: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  expiresAt: string;
  url: string;
}

/** 서버 사진에서 파싱된 메타데이터 */
export interface DownloadedPhoto {
  base64: string;
  mimeType: string;
  file: File;
  selectedItem: string;  // 'P1' | 'P2' | 'P3' | 'P4'
  photoUserName: string; // 파일명에서 파싱한 사용자명
  comment?: string;      // 파일명에서 파싱한 코멘트 → 웹 UI 사진 코멘트 필드에 복원
}

// ─── 파일명 규칙 ───────────────────────────────────────────────────────────
// 저장: ITEM_{pageCode}||{원본명}_{userName}||{comment}.jpg
//       코멘트 없으면: ITEM_{pageCode}||{원본명}_{userName}.jpg
// 예)   ITEM_P1||photo_김종진||운용프로그램.jpg
//       ITEM_P2||photo_권민경.jpg
// ────────────────────────────────────────────────────────────────────────────

/** base64 + mimeType를 Blob으로 변환 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteArray = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mimeType });
}

/** Blob을 base64 dataURL로 변환 */
async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 파일명에서 메타데이터 파싱
 * 형식: ITEM_{pageCode}||{원본명}_{userName}||{comment}.jpg
 * 반환: { pageCode, userName, comment }
 */
function parseFilename(original: string): { pageCode: string; userName: string; comment: string } {
  if (!original) return { pageCode: 'P1', userName: '', comment: '' };
  // || 로 분리
  const parts = original.split('||');
  // parts[0] = "ITEM_P1", parts[1] = "{원본명}_{userName}"[.jpg], parts[2] = "{comment}.jpg" (있으면)

  const pageCode = parts[0]?.startsWith('ITEM_') ? parts[0].slice(5) : 'P1';

  // ★ 핵심: parts[2]가 있으면(코멘트 있음) parts[1]에 확장자가 없으므로 제거하면 안 됨
  // 예) "이미지 2026. 5. 20. 오후 10.04_김종진" → .04_김종진을 확장자로 오인 방지
  const hasComment = parts.length >= 3;
  let namePart = parts[1] || '';
  if (!hasComment) {
    // 코멘트 없을 땐 마지막 부분이 "원본명_userName.jpg" 형식 → .jpg만 제거
    namePart = namePart.replace(/\.[^/.]+$/, '');
  }
  const lastUnderscore = namePart.lastIndexOf('_');
  const userName = lastUnderscore >= 0 ? namePart.slice(lastUnderscore + 1) : '';

  // 코멘트: parts[2]에서 확장자 제거
  const comment = parts[2] ? parts[2].replace(/\.[^/.]+$/, '') : '';

  return { pageCode, userName, comment };
}

/** 업로드에 사용할 파일명 생성 */
export function buildPhotoFilename(
  originalFileName: string,
  pageCode: string,
  userName: string,
  comment?: string
): string {
  let baseName = originalFileName.replace(/\.[^/.]+$/, '');
  // 이미 ITEM_ 형식이면 원본명만 추출
  if (baseName.startsWith('ITEM_') && baseName.includes('||')) {
    const parts = baseName.split('||');
    const namePart = parts[1] || '';
    const lastUnderscore = namePart.lastIndexOf('_');
    baseName = lastUnderscore >= 0 ? namePart.slice(0, lastUnderscore) : namePart;
  }
  const commentSuffix = comment?.trim() ? `||${comment.trim()}` : '';
  return `ITEM_${pageCode}||${baseName}_${userName}${commentSuffix}.jpg`;
}

/**
 * 사진 1장을 맥스튜디오 서버에 업로드
 * - 파일명: ITEM_{pageCode}||{원본명}_{userName}||{comment}.jpg  (코멘트 없으면 마지막 || 생략)
 * - 사진은 원본 그대로 압축만 해서 저장 (스탬프 없음, 덮어쓰기 없음)
 * - 코멘트는 파일명에 인코딩 → 불러올 때 웹 UI 사진 코멘트 필드에 복원
 */
export async function uploadPhotoToServer(
  receiptNo: string,
  photo: { base64: string; mimeType: string; file: { name: string } },
  pageCode: 'P1' | 'P2' | 'P3' | 'P4' | 'P6',
  options: {
    userName: string;
    comment?: string;
    siteLocation?: string;
    selectedItem?: string;
    inspectionDate?: string;
    address?: string;    // 자동 위치 저장용
    lat?: number;
    lng?: number;
    siteName?: string;
  }
): Promise<void> {
  const { userName, comment, address, lat, lng, siteName } = options;

  // ① 원본 그대로 압축 (스탬프 없음)
  const compressedDataUrl = await compressImage(photo.base64, photo.mimeType, 1024, 1024, 0.65);
  const compressedBase64 = compressedDataUrl.split(',')[1];

  // ② 파일명: 코멘트 있으면 ||{comment} 추가
  let originalName = photo.file.name.replace(/\.[^/.]+$/, '');
  if (originalName.startsWith('ITEM_') && originalName.includes('||')) {
    const parts = originalName.split('||');
    const namePart = parts[1] || '';
    const lastUnderscore = namePart.lastIndexOf('_');
    originalName = lastUnderscore >= 0 ? namePart.slice(0, lastUnderscore) : namePart;
  }
  const commentSuffix = comment?.trim() ? `||${comment.trim()}` : '';
  const filename = `ITEM_${pageCode}||${originalName}_${userName}${commentSuffix}.jpg`;

  // ③ JSON 방식으로 전송 (위치 정보 포함)
  await axios.post(`${PHOTO_API}/upload-json`, {
    receiptNo,
    photos: [{
      base64: compressedBase64,
      mimeType: 'image/jpeg',
      filename,
    }],
    // 위치 자동 저장 (address 있을 때만 서버에서저장)
    userName,
    address: address || '',
    lat: lat ?? 0,
    lng: lng ?? 0,
    siteName: siteName || '',
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

/**
 * 접수번호로 서버에 저장된 사진 목록 조회
 */
export async function getPhotosFromServer(receiptNo: string): Promise<ServerPhoto[]> {
  try {
    const res = await axios.get(`${PHOTO_API}/${receiptNo}`, { timeout: 10000 });
    return res.data.photos || [];
  } catch (e) {
    console.warn('[PhotoStorage] 사진 목록 조회 실패:', e);
    return [];
  }
}

/**
 * 서버 사진 URL 반환 (Vercel 프록시 경유)
 */
export function getPhotoProxyUrl(receiptNo: string, filename: string): string {
  return `${PHOTO_API}/${receiptNo}/file/${filename}`;
}

/**
 * 서버 사진을 메모리 photo 객체로 복원
 * - filterUserName: 지정 시 해당 사용자의 사진만 반환
 * - 반환값 comment: 파일명에서 파싱 → 호출자가 photoComments[uid]에 세팅해야 함
 */
export async function downloadPhotosFromServer(
  receiptNo: string,
  filterUserName?: string
): Promise<DownloadedPhoto[]> {
  const serverPhotos = await getPhotosFromServer(receiptNo);
  console.log(`[사진다운] ${receiptNo} 서버사진 ${serverPhotos.length}장:`,
    serverPhotos.map(p => ({ original: p.original, filename: p.filename })));

  if (serverPhotos.length === 0) return [];

  // 사용자명 필터링 (client-side)
  const filtered = filterUserName
    ? serverPhotos.filter(sp => {
        const { userName } = parseFilename(sp.original);
        const match = userName === filterUserName;
        console.log(`[사진다운] 필터: "${sp.original}" → userName="${userName}" ${match ? '✅' : `❌ (기대: "${filterUserName}")`}`);
        return match;
      })
    : serverPhotos;

  console.log(`[사진다운] 필터 후 ${filtered.length}장`);

  const results = await Promise.allSettled(
    filtered.map(async (sp) => {
      const url = getPhotoProxyUrl(receiptNo, sp.filename);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`사진 다운로드 실패(${response.status}): ${sp.filename}`);

      const blob = await response.blob();
      const dataUrl = await blobToBase64DataUrl(blob);
      const base64 = dataUrl.split(',')[1];

      const { pageCode, userName, comment } = parseFilename(sp.original);
      console.log(`[사진다운] 완료: pageCode=${pageCode} userName=${userName} comment="${comment}"`);

      return {
        base64,
        mimeType: sp.mimeType || 'image/jpeg',
        file: new File([blob], sp.original, { type: sp.mimeType || 'image/jpeg' }),
        selectedItem: pageCode,
        photoUserName: userName,
        comment: comment || undefined,
      } as DownloadedPhoto;
    })
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[사진다운] ${i}번 실패:`, r.reason);
  });

  return results
    .filter((r): r is PromiseFulfilledResult<DownloadedPhoto> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * 접수번호의 사진 삭제
 * - pageCode: 지정 시 해당 페이지만
 * - userName: 지정 시 해당 사용자만
 * - 둘 다 지정 가능 (AND 조건)
 */
export async function deletePhotosFromServer(
  receiptNo: string,
  pageCode?: 'P1' | 'P2' | 'P3' | 'P4',
  userName?: string
): Promise<void> {
  const params = new URLSearchParams();
  if (pageCode) params.append('pageCode', pageCode);
  if (userName) params.append('userName', userName);
  const query = params.toString();
  const url = query ? `${PHOTO_API}/${receiptNo}?${query}` : `${PHOTO_API}/${receiptNo}`;
  await axios.delete(url, { timeout: 10000 });
}

/** 개별 사진 삭제 (DB id 기준) */
export async function deletePhotoById(id: number): Promise<void> {
  await axios.delete(`${PHOTO_API}/file/${id}`, { timeout: 10000 });
}

/**
 * 접수번호의 서버 사진 중복 정리.
 * original(업로드 파일명)+크기가 같은 사진은 가장 오래된 1장만 남기고 나머지를 id로 삭제.
 * 다운로드/재업로드 없이 여분만 지우므로 안전(데이터 손실 위험 없음).
 * @returns { removed: 제거 장수, kept: 유지 장수 }
 */
export async function dedupePhotosForReceipt(receiptNo: string): Promise<{ removed: number; kept: number }> {
  const photos = await getPhotosFromServer(receiptNo);  // uploaded ASC (오래된 순)
  if (photos.length === 0) return { removed: 0, kept: 0 };

  const seen = new Set<string>();
  const extras: ServerPhoto[] = [];
  for (const p of photos) {
    const key = `${p.original}__${p.sizeBytes}`;
    if (seen.has(key)) extras.push(p);   // 같은 사진 재업로드분 → 여분
    else seen.add(key);                  // 그룹의 첫(가장 오래된) 1장 유지
  }

  for (const p of extras) {
    await deletePhotoById(p.id).catch(e => console.warn('[중복정리] 삭제 실패', p.id, e?.message));
  }
  return { removed: extras.length, kept: seen.size };
}
