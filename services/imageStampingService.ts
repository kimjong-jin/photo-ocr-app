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
        const fontSize = Math.max(12, Math.round(baseDim * TEXT_SCALE)); // 셀 기준 5%
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
    const stampFont = Math.max(12, Math.round(canvasBase * TEXT_SCALE)); // 캔버스 기준 5%
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
