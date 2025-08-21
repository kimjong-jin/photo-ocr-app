// services/imageStampingService.ts

// ----- Types -----
/** (참고용) dataURL 또는 순수 base64 + MIME 페어 */
export interface Base64ImageSource {
  base64: string;   // dataURL 전체 또는 순수 base64
  mimeType: string; // 예) 'image/jpeg', 'image/png'
}

/** 합성 이미지 입력(각 이미지 별 코멘트 선택적) */
export interface CompositeImageInput {
  base64: string;          // dataURL 전체 또는 순수 base64
  mimeType: string;        // 각 이미지의 MIME
  comment?: string;        // 이미지 별 코멘트(합성 타일 위쪽에 표시)
}

/** 합성/스탬프 하단 블록에 들어갈 공통 정보 */
interface StampDetails {
  receiptNumber: string;
  siteLocation: string;
  inspectionStartDate?: string; // 선택
  item: string;
}

export interface A4CompositeOptions {
  dpi?: number;          // 기본 300
  marginPx?: number;     // 페이지 여백, 기본 48px
  gutterPx?: number;     // 타일 간격, 기본 24px
  background?: string;   // 배경색, 기본 '#ffffff'
  quality?: number;      // JPEG 품질(0~1), 기본 0.95
  fitMode?: 'contain' | 'cover'; // ← contain=안잘림(여백), cover=꽉참(잘릴수있음)
}

// ----- Constants -----
/** 스탬프/코멘트 글자 스케일(짧은 변 × 0.03 = 3%) */
export const TEXT_SCALE = 0.03;
/** 합성 캔버스 최대 한 변 픽셀 */
export const MAX_COMPOSITE_DIMENSION = 3000;

// ----- Helpers -----
const ensureDataUrl = (src: string, mimeType: string) =>
  src.startsWith('data:') ? src : `data:${mimeType};base64,${src}`;

// ----- Public APIs -----

/**
 * 단일 이미지에 하단 스탬프(접수번호/현장/항목/검사시작일/코멘트)를 그려 dataURL 반환.
 * 글자 크기 = 이미지의 "짧은 변 × TEXT_SCALE(기본 0.03)" (최소 12px 보장)
 */
export const generateStampedImage = (
  base64Image: string,     // dataURL 전체 또는 순수 base64
  mimeType: string,
  receiptNumber: string,
  siteLocation: string,
  inspectionDate: string,  // 필요 없으면 ''로
  item: string,
  comment?: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Failed to get 2D context from canvas.')); return; }

      ctx.drawImage(img, 0, 0);

      // ⚙️ 폰트 크기: 사진 짧은 변 × TEXT_SCALE
      const baseDim = Math.min(img.width, img.height);
      const fontSize = Math.max(12, Math.round(baseDim * TEXT_SCALE));
      const padding = Math.round(fontSize * 0.5);
      const lineHeight = Math.round(fontSize * 1.4);

      const lines: { text: string; isComment: boolean }[] = [];
      if (receiptNumber?.trim()) lines.push({ text: `접수번호: ${receiptNumber}`, isComment: false });
      if (siteLocation?.trim())  lines.push({ text: `현장: ${siteLocation}`,     isComment: false });
      if (item?.trim())          lines.push({ text: `항목: ${item}`,            isComment: false });
      if (inspectionDate?.trim())lines.push({ text: `검사시작일: ${inspectionDate}`, isComment: false });
      if (comment?.trim())       lines.push({ text: `코멘트: ${comment}`,       isComment: true });

      if (!lines.length) { resolve(ensureDataUrl(base64Image, mimeType)); return; }

      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      let maxTextWidth = 0;
      for (const l of lines) {
        const w = ctx.measureText(l.text).width;
        if (w > maxTextWidth) maxTextWidth = w;
      }

      const blockW = maxTextWidth + padding * 2;
      const blockH = Math.max(lineHeight + padding, lines.length * lineHeight - (lineHeight - fontSize) + padding);
      const rectX = Math.round(padding / 2);
      const rectY = Math.round(canvas.height - blockH - padding / 2);

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(rectX, rectY, blockW, blockH);

      lines.forEach((l, i) => {
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = l.isComment ? '#FFD700' : '#FFFFFF';
        const y = rectY + i * lineHeight + fontSize + padding / 2 - (lineHeight - fontSize) / 2;
        ctx.fillText(l.text, rectX + padding, y);
      });

      resolve(canvas.toDataURL(mimeType));
    };
    img.onerror = () => reject(new Error('Failed to load image for stamping.'));
    img.src = ensureDataUrl(base64Image, mimeType);
  });
};

/**
 * 여러 장을 그리드로 배치해 1장의 합성 이미지로 만들고,
 * 하단에 공통 스탬프(접수번호/현장/항목/검사시작일)를 그려 dataURL 반환.
 *
 * - 각 타일의 코멘트(comment)는 해당 타일의 좌상단에 표시
 * - 글자 크기 = (셀/캔버스) 짧은 변 × TEXT_SCALE (최소 12px)
 * - 결과 포맷: JPEG(기본) 또는 PNG
 */
export const generateCompositeImage = (
  images: CompositeImageInput[],
  stampDetails: StampDetails,
  outputMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.9
): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    if (!images.length) {
      // 빈 안내 이미지
      const c = document.createElement('canvas');
      c.width = 400; c.height = 300;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('Failed to get 2D context for blank composite canvas.')); return; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle = '#777'; ctx.font = '20px Arial'; ctx.textAlign='center';
      ctx.fillText('첨부된 사진 없음', c.width/2, c.height/2);
      resolve(c.toDataURL(outputMimeType, quality));
      return;
    }

    // (1) 이미지 로드
    const loaded = await Promise
      .all(images.map(info => new Promise<HTMLImageElement>((ok, bad) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => bad(new Error(`Failed to load an image (MIME: ${info.mimeType}) for composite.`));
        im.src = ensureDataUrl(info.base64, info.mimeType);
      })))
      .catch(reject);
    if (!loaded) return;

    // (2) 그리드 계산
    const n = loaded.length;
    let padding = 10;
    let cols = Math.ceil(Math.sqrt(n));
    let rows = Math.ceil(n / cols);
    if (n === 2) { cols = 2; rows = 1; }
    else if (n === 3) { cols = 3; rows = 1; }
    else if (n === 4) { cols = 2; rows = 2; }

    const maxW = Math.max(...loaded.map(i => i.width), 300);
    const maxH = Math.max(...loaded.map(i => i.height), 200);
    const cellW0 = maxW;
    const cellH0 = maxH;

    let canvasW = cols * cellW0 + (cols + 1) * padding;
    let canvasH = rows * cellH0 + (rows + 1) * padding;

    let scale = 1;
    if (canvasW > MAX_COMPOSITE_DIMENSION || canvasH > MAX_COMPOSITE_DIMENSION) {
      scale = Math.min(
        MAX_COMPOSITE_DIMENSION / canvasW,
        MAX_COMPOSITE_DIMENSION / canvasH
      );
    }

    const canvas = document.createElement('canvas');
    const cellW = Math.round(cellW0 * scale);
    const cellH = Math.round(cellH0 * scale);
    padding = Math.round(padding * scale);

    canvas.width  = Math.round(canvasW * scale);
    canvas.height = Math.round(canvasH * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('Failed to get 2D context for composite canvas.')); return; }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // (3) 각 이미지 그리기 + 코멘트
    loaded.forEach((img, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = padding + c * (cellW + padding);
      const y = padding + r * (cellH + padding);

      const hRatio = cellW / img.width;
      const vRatio = cellH / img.height;
      const ratio = Math.min(hRatio, vRatio);

      const dw = Math.round(img.width * ratio);
      const dh = Math.round(img.height * ratio);
      const cx = x + Math.round((cellW - dw) / 2);
      const cy = y + Math.round((cellH - dh) / 2);

      ctx.drawImage(img, cx, cy, dw, dh);

      // 코멘트(타일 좌상단)
      const comment = images[idx].comment?.trim();
      if (comment) {
        const baseDim = Math.min(dw, dh);
        const fontSize = Math.max(12, Math.round(baseDim * TEXT_SCALE)); // 셀 기준 3%
        const pad = Math.round(fontSize * 0.4);

        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        const text = `코멘트: ${comment}`;
        const metrics = ctx.measureText(text);
        const blockW = Math.min(dw - pad * 2, Math.round(metrics.width + pad * 2));
        const blockH = Math.round(fontSize + pad * 2);

        const rx = cx + pad;
        const ry = cy + pad;

        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(rx, ry, blockW, blockH);

        ctx.fillStyle = '#FFD700';
        ctx.textBaseline = 'top';
        ctx.fillText(text, rx + pad, ry + pad, blockW - pad * 2);
        ctx.textBaseline = 'alphabetic';
      }
    });

    // (4) 하단 공통 스탬프
    const { receiptNumber, siteLocation, inspectionStartDate, item } = stampDetails;
    const canvasBase = Math.min(canvas.width, canvas.height);
    const stampFont = Math.max(12, Math.round(canvasBase * TEXT_SCALE)); // 캔버스 기준 3%
    const stampPad = Math.round(stampFont * 0.5);
    const lineH = Math.round(stampFont * 1.4);

    const lines: string[] = [];
    if (receiptNumber?.trim()) lines.push(`접수번호: ${receiptNumber}`);
    if (siteLocation?.trim())  lines.push(`현장: ${siteLocation}`);
    if (item?.trim())          lines.push(`항목: ${item}`);
    if (inspectionStartDate?.trim()) lines.push(`검사시작일: ${inspectionStartDate}`);

    if (lines.length) {
      ctx.font = `bold ${stampFont}px Arial, sans-serif`;
      let maxTextWidth = 0;
      for (const l of lines) {
        const w = ctx.measureText(l).width;
        if (w > maxTextWidth) maxTextWidth = w;
      }
      const blockW = maxTextWidth + stampPad * 2;
      const blockH = Math.max(lineH + stampPad, lines.length * lineH - (lineH - stampFont) + stampPad);
      const rectX = Math.round(stampPad / 2);
      const rectY = Math.round(canvas.height - blockH - stampPad / 2);

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(rectX, rectY, blockW, blockH);

      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => {
        const y = rectY + i * lineH + stampFont + stampPad / 2 - (lineH - stampFont) / 2;
        ctx.fillText(l, rectX + stampPad, y);
      });
    }

    // (5) export
    const dataUrl = canvas.toDataURL(outputMimeType, quality);
    const parts = dataUrl.split(',');
    if (parts.length < 2 || !parts[0].includes(';base64') || parts[1].trim() === '') {
      reject(new Error('합성 이미지 생성 실패: 잘못된 dataURL'));
      return;
    }
    resolve(dataUrl);
  });
};

/** dataURL → Blob 변환 */
export const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  if (arr.length < 2) throw new Error('Invalid data URL format for blob conversion.');
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch?.[1]) throw new Error('Could not determine MIME type from data URL.');

  const mime = mimeMatch[1];
  let bstr: string;
  try {
    bstr = atob(arr[1]);
  } catch (e: any) {
    throw new Error(`Invalid base64 data in data URL: ${e.message}`);
  }

  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
};

// ===== A4 composite additions =====

type A4Base64Image = { base64: string; mimeType: string; comment?: string };

/** 셀(box) 안에 이미지 비율 유지하며 맞추기(여백 생길 수 있음) */
function a4FitContain(srcW: number, srcH: number, boxW: number, boxH: number) {
  const r = Math.min(boxW / srcW, boxH / srcH);
  const w = Math.round(srcW * r);
  const h = Math.round(srcH * r);
  const x = Math.round((boxW - w) / 2);
  const y = Math.round((boxH - h) / 2);
  return { x, y, w, h };
}

/** 셀(box)을 꽉 채우도록 중앙 크롭(이미지 일부 잘림) */
function a4CoverCrop(srcW: number, srcH: number, boxW: number, boxH: number) {
  const srcR = srcW / srcH;
  const boxR = boxW / boxH;

  if (srcR > boxR) {
    // 원본이 더 '와이드' → 가로 자르기
    const sw = Math.round(srcH * boxR);
    const sh = srcH;
    const sx = Math.round((srcW - sw) / 2);
    const sy = 0;
    return { sx, sy, sw, sh };
  } else {
    // 원본이 더 '세로' → 세로 자르기
    const sw = srcW;
    const sh = Math.round(srcW / boxR);
    const sx = 0;
    const sy = Math.round((srcH - sh) / 2);
    return { sx, sy, sw, sh };
  }
}

async function loadImageFromBase64(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
  });
}

/**
 * 입력 이미지를 A4(세로) JPG로, 페이지당 최대 4장(2x2) 타일링하여 여러 장 생성.
 * - 1장: 전체
 * - 2장: 좌/우 반반
 * - 3장: 2x2 (마지막 셀 비움)
 * - 4장: 2x2
 * @returns 각 페이지를 dataURL(JPEG)로 담은 배열
 */
export async function generateA4CompositeJPEGPages(
  imgs: A4Base64Image[],
  opts: A4CompositeOptions = {}
): Promise<string[]> {
  const dpi = opts.dpi ?? 300;
  const pageW = Math.round(8.27 * dpi);   // ≈2481 @300dpi
  const pageH = Math.round(11.69 * dpi);  // ≈3507 @300dpi
  const margin = opts.marginPx ?? 48;
  const gutter = opts.gutterPx ?? 24;
  const bg = opts.background ?? '#ffffff';
  const quality = opts.quality ?? 0.95;
  const mode = opts.fitMode ?? 'contain'; // 'contain' | 'cover'

  // 4개씩 끊기
  const groups: A4Base64Image[][] = [];
  for (let i = 0; i < imgs.length; i += 4) groups.push(imgs.slice(i, i + 4));

  const pages: string[] = [];

  for (const group of groups) {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, pageW, pageH);

    // 셀 배치 계산
    let cells: Array<{ x: number; y: number; w: number; h: number }> = [];

    if (group.length === 1) {
      // 1장: 전체
      cells = [{ x: margin, y: margin, w: pageW - margin * 2, h: pageH - margin * 2 }];
    } else if (group.length === 2) {
      // 2장: 좌/우 반반
      const tileW = Math.floor((pageW - margin * 2 - gutter) / 2);
      const tileH = pageH - margin * 2;
      const y = margin;
      const x1 = margin;
      const x2 = margin + tileW + gutter;
      cells = [
        { x: x1, y, w: tileW, h: tileH },
        { x: x2, y, w: tileW, h: tileH },
      ];
    } else {
      // 3~4장: 2x2 (3장은 마지막 셀 비움)
      const tileW = Math.floor((pageW - margin * 2 - gutter) / 2);
      const tileH = Math.floor((pageH - margin * 2 - gutter) / 2);
      const x1 = margin;
      const x2 = margin + tileW + gutter;
      const y1 = margin;
      const y2 = margin + tileH + gutter;
      cells = [
        { x: x1, y: y1, w: tileW, h: tileH },
        { x: x2, y: y1, w: tileW, h: tileH },
        { x: x1, y: y2, w: tileW, h: tileH },
        { x: x2, y: y2, w: tileW, h: tileH },
      ];
    }

    // 이미지 드로잉
    for (let i = 0; i < group.length; i++) {
      const g = group[i];
      const cell = cells[i];
      const img = await loadImageFromBase64(
        g.base64.startsWith('data:') ? g.base64 : `data:${g.mimeType};base64,${g.base64}`
      );

      if (mode === 'cover') {
        // 칸을 꽉 채우기(중앙 크롭)
        const { sx, sy, sw, sh } = a4CoverCrop(img.width, img.height, cell.w, cell.h);
        ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h);
      } else {
        // contain (여백 가능)
        const fit = a4FitContain(img.width, img.height, cell.w, cell.h);
        ctx.drawImage(img, cell.x + fit.x, cell.y + fit.y, fit.w, fit.h);
      }

      // ※ 필요 시 각 타일 코멘트 렌더링 지점 (g.comment) — 현재는 생략
    }

    // 페이지 export
    pages.push(canvas.toDataURL('image/jpeg', quality));
  }

  return pages;
}
