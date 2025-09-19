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

type FitMode = 'contain' | 'cover' | 'fill';
type QuadKey = 'TL' | 'TR' | 'BL' | 'BR';

export interface A4CompositeOptions {
  /** 기본 300. pagePx/pageMM가 없으면 A4(mm)×dpi로 계산 */
  dpi?: number;
  /** 페이지 여백(px). 기본 48 (0 가능) */
  marginPx?: number;
  /** 타일 간격(px). 기본 24 (0 가능) */
  gutterPx?: number;
  /** 배경색. 기본 '#ffffff' */
  background?: string;
  /** JPEG 품질(0~1). 기본 0.95 */
  quality?: number;
  /**
   * 배치 모드:
   * - 'fill'    : 비율 무시, 셀을 100% 채움(왜곡 가능) ← 기본
   * - 'cover'   : 비율 유지, 셀 꽉참(필요 시 중앙 크롭)
   * - 'contain' : 비율 유지, 크롭 없음(여백 생김)
   */
  fitMode?: FitMode;

  /** 🔸 전체 출력 크기를 "픽셀"로 고정 (예: { width:2480, height:3508 }) */
  pagePx?: { width: number; height: number };
  /** 🔸 전체 출력 크기를 "mm + dpi"로 고정 (예: { width:210, height:297, dpi?:350 }) */
  pageMM?: { width: number; height: number; dpi?: number };

  /** 🔸 4분면 고정 순서 (기본: 1=TL,2=TR,3=BL,4=BR) */
  quadrantOrder?: QuadKey[];
  /** 🔸 항상 2×2 레이아웃 유지 (기본 true) */
  keepEmptySlots?: boolean;
  /** 🔸 슬롯 라벨(1~4) 렌더링 */
  drawSlotLabels?:
    | boolean
    | {
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
        color?: string; // 기본 rgba(0,0,0,0.45)
        font?: string;  // 기본 'bold 28px sans-serif'
      };
  /** 🔸 빈 슬롯 테두리 표시 */
  strokeEmptySlots?: boolean | { color?: string; width?: number; dash?: number[] };
}

// ----- Constants -----
/** 스탬프/코멘트 글자 스케일(짧은 변 × 0.03 = 3%) */
export const TEXT_SCALE = 0.03;
/** 합성 캔버스 최대 한 변 픽셀 (generateCompositeImage 용) */
export const MAX_COMPOSITE_DIMENSION = 3000;

// ----- Env guard -----
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
function assertBrowser(fn: string): void {
  if (!isBrowser) {
    throw new Error(`[imageStampingService:${fn}] 브라우저 환경에서만 사용할 수 있습니다.`);
  }
}

// ----- Helpers -----
const ensureDataUrl = (src: string, mimeType: string) =>
  src.startsWith('data:') ? src : `data:${mimeType};base64,${src}`;

const mm2px = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4);

/** contain: 비율 유지 + 레터박스(여백 허용) */
function drawImageInCellContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number
) {
  const r = Math.min(w / img.width, h / img.height);
  const dw = Math.round(img.width * r);
  const dh = Math.round(img.height * r);
  const dx = Math.round(x + (w - dw) / 2);
  const dy = Math.round(y + (h - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** cover: 비율 유지, 셀을 가득 채우되 중앙 크롭 */
function drawImageInCellCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  const dx = Math.round(x + (w - dw) / 2);
  const dy = Math.round(y + (h - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** fill: 비율 무시, 셀을 100% 채움 */
function drawImageInCellFill(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number
) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawSlotLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  n: number,
  style?: NonNullable<A4CompositeOptions['drawSlotLabels']> extends true
    ? never
    : Exclude<A4CompositeOptions['drawSlotLabels'], boolean>
) {
  const pos = style?.position ?? 'top-left';
  const font = style?.font ?? 'bold 28px sans-serif';
  const color = style?.color ?? 'rgba(0,0,0,0.45)';
  const pad = 6;

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  let tx = x + pad;
  let ty = y + pad;
  if (pos.includes('right')) tx = x + w - pad - ctx.measureText(String(n)).width;
  if (pos.includes('bottom')) {
    ctx.textBaseline = 'bottom';
    ty = y + h - pad;
  }

  ctx.fillText(String(n), tx, ty);
  ctx.restore();
}

function drawEmptyStroke(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  opt?: Exclude<A4CompositeOptions['strokeEmptySlots'], boolean>
) {
  ctx.save();
  ctx.strokeStyle = opt?.color ?? 'rgba(0,0,0,0.15)';
  ctx.lineWidth = opt?.width ?? 1;
  if (opt?.dash?.length) ctx.setLineDash(opt.dash);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

async function loadImageFromBase64(dataUrl: string): Promise<HTMLImageElement> {
  assertBrowser('loadImageFromBase64');
  return new Promise((resolve, reject) => {
    const img = new Image();
    // dataURL이면 crossOrigin 불필요하나, 안전상 지정
    img.crossOrigin = 'anonymous';
    (img as any).decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = dataUrl;
  });
}

function safeToDataURL(
  canvas: HTMLCanvasElement,
  type: 'image/jpeg' | 'image/png',
  quality?: number
): string {
  try {
    if (type === 'image/jpeg') return canvas.toDataURL(type, quality ?? 0.95);
    return canvas.toDataURL(type);
  } catch {
    // 일부 브라우저/환경에서 실패 시 PNG로 폴백
    return canvas.toDataURL('image/png');
  }
}

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
  assertBrowser('generateStampedImage');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    (img as any).decoding = 'async';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get 2D context from canvas.'));
        return;
      }

      ctx.drawImage(img, 0, 0);

      // ⚙️ 폰트 크기: 사진 짧은 변 × TEXT_SCALE
      const baseDim = Math.min(img.width, img.height);
      const fontSize = Math.max(12, Math.round(baseDim * TEXT_SCALE));
      const padding = Math.round(fontSize * 0.5);
      const lineHeight = Math.round(fontSize * 1.4);

      const lines: { text: string; isComment: boolean }[] = [];
      if (receiptNumber?.trim()) lines.push({ text: `접수번호: ${receiptNumber}`, isComment: false });
      if (siteLocation?.trim())  lines.push({ text: `현장: ${siteLocation}`, isComment: false });
      if (item?.trim())          lines.push({ text: `항목: ${item}`, isComment: false });
      if (inspectionDate?.trim()) lines.push({ text: `검사시작일: ${inspectionDate}`, isComment: false });
      if (comment?.trim())       lines.push({ text: `코멘트: ${comment}`, isComment: true });

      if (!lines.length) {
        resolve(ensureDataUrl(base64Image, mimeType));
        return;
      }

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

      resolve(safeToDataURL(canvas, mimeType === 'image/png' ? 'image/png' : 'image/jpeg'));
    };
    img.onerror = () => reject(new Error('Failed to load image for stamping.'));
    img.src = ensureDataUrl(base64Image, mimeType);
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

/**
 * 여러 이미지를 하나의 캔버스에 타일링하고 스탬프를 추가하여 단일 이미지 dataURL을 생성합니다. (Page 3, Page 4용)
 * 결과 이미지의 크기는 MAX_COMPOSITE_DIMENSION을 초과하지 않도록 축소됩니다.
 */
export const generateCompositeImage = async (
  images: CompositeImageInput[],
  stampDetails: StampDetails,
  outputMimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality: number = 0.9
): Promise<string> => {
  assertBrowser('generateCompositeImage');

  if (!images.length) {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for blank composite canvas.');
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#777';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('첨부된 사진 없음', c.width / 2, c.height / 2);
    return safeToDataURL(c, outputMimeType, quality);
  }

  const loadedImages = await Promise.all(
    images.map((img) => loadImageFromBase64(ensureDataUrl(img.base64, img.mimeType)))
  );

  const n = loadedImages.length;
  let padding = 10;
  let cols = Math.ceil(Math.sqrt(n));
  let rows = Math.ceil(n / cols);
  if (n === 2) {
    cols = 2;
    rows = 1;
  } else if (n === 3) {
    cols = 3;
    rows = 1;
  } else if (n === 4) {
    cols = 2;
    rows = 2;
  }

  const maxW = Math.max(...loadedImages.map((i) => i.width), 300);
  const maxH = Math.max(...loadedImages.map((i) => i.height), 200);
  const cellW0 = maxW;
  const cellH0 = maxH;

  let canvasW = cols * cellW0 + (cols + 1) * padding;
  let canvasH = rows * cellH0 + (rows + 1) * padding;

  let scale = 1;
  if (canvasW > MAX_COMPOSITE_DIMENSION || canvasH > MAX_COMPOSITE_DIMENSION) {
    scale = Math.min(MAX_COMPOSITE_DIMENSION / canvasW, MAX_COMPOSITE_DIMENSION / canvasH);
  }

  const canvas = document.createElement('canvas');
  const cellW = Math.round(cellW0 * scale);
  const cellH = Math.round(cellH0 * scale);
  padding = Math.round(padding * scale);

  canvas.width = Math.round(canvasW * scale);
  canvas.height = Math.round(canvasH * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context for composite canvas.');
  }

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  loadedImages.forEach((img, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const x = padding + c * (cellW + padding);
    const y = padding + r * (cellH + padding);

    drawImageInCellContain(ctx, img, x, y, cellW, cellH);

    const comment = images[idx].comment?.trim();
    if (comment) {
      const baseDim = Math.min(cellW, cellH);
      const fontSize = Math.max(12, Math.round(baseDim * TEXT_SCALE));
      const pad = Math.round(fontSize * 0.4);

      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      const text = `코멘트: ${comment}`;
      const metrics = ctx.measureText(text);
      const blockW = Math.min(cellW - pad * 4, Math.round(metrics.width + pad * 2));
      const blockH = Math.round(fontSize + pad * 2);

      const rx = x + pad;
      const ry = y + pad;

      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(rx, ry, blockW, blockH);

      ctx.fillStyle = '#FFD700';
      ctx.textBaseline = 'top';
      ctx.fillText(text, rx + pad, ry + pad, blockW - pad * 2);
      ctx.textBaseline = 'alphabetic';
    }
  });

  const { receiptNumber, siteLocation, inspectionStartDate, item } = stampDetails;
  const canvasBase = Math.min(canvas.width, canvas.height);
  const stampFont = Math.max(12, Math.round(canvasBase * TEXT_SCALE));
  const stampPad = Math.round(stampFont * 0.5);
  const lineH = Math.round(stampFont * 1.4);

  const lines: string[] = [];
  if (receiptNumber?.trim()) lines.push(`접수번호: ${receiptNumber}`);
  if (siteLocation?.trim()) lines.push(`현장: ${siteLocation}`);
  if (item?.trim()) lines.push(`항목: ${item}`);
  if (inspectionStartDate?.trim()) lines.push(`검사시작일: ${inspectionStartDate}`);

  if (lines.length) {
    const ctx2 = canvas.getContext('2d')!;
    ctx2.font = `bold ${stampFont}px Arial, sans-serif`;
    let maxTextWidth = 0;
    for (const l of lines) {
      const w = ctx2.measureText(l).width;
      if (w > maxTextWidth) maxTextWidth = w;
    }
    const blockW = maxTextWidth + stampPad * 2;
    const blockH = Math.max(
      lineH + stampPad,
      lines.length * lineH - (lineH - stampFont) + stampPad
    );
    const rectX = Math.round(stampPad / 2);
    const rectY = Math.round(canvas.height - blockH - stampPad / 2);

    ctx2.fillStyle = 'rgba(0,0,0,0.7)';
    ctx2.fillRect(rectX, rectY, blockW, blockH);

    ctx2.fillStyle = '#fff';
    lines.forEach((l, i) => {
      const y = rectY + i * lineH + stampFont + stampPad / 2 - (lineH - stampFont) / 2;
      ctx2.fillText(l, rectX + stampPad, y);
    });
  }

  return safeToDataURL(canvas, outputMimeType, quality);
};

// ===== A4 composite: 2×2(4분면) 고정 + 옵션 확장 =====

export type A4Base64Image = { base64: string; mimeType: string; comment?: string };

/**
 * 입력 이미지를 A4 JPG로, 페이지당 최대 4장(2×2) 타일링하여 여러 장 생성. (P1/P2/P4 페이지용)
 * - 기본 "4분면 고정"(TL,TR,BL,BR). keepEmptySlots=true면 1~3장도 2×2 유지.
 * - fitMode:
 *    'fill'    → 왜곡 허용, 셀 100% 채움(여백/크롭 없음)
 *    'cover'   → 비율 유지, 여백 0, 필요 시 중앙 크롭
 *    'contain' → 비율 유지, 크롭 0, 여백 생김
 * - pagePx / pageMM 로 전체 출력 픽셀 크기 고정 가능
 * - quadrantOrder 로 입력 이미지 → 슬롯 매핑 제어 가능
 * @returns 각 페이지를 dataURL(JPEG)로 담은 배열
 */
export async function generateA4CompositeJPEGPages(
  imgs: A4Base64Image[],
  stampDetails?: StampDetails,
  opts: A4CompositeOptions = {}
): Promise<string[]> {
  assertBrowser('generateA4CompositeJPEGPages');

  const dpi = opts.dpi ?? 300;

  // 페이지 픽셀 결정
  let pageW: number, pageH: number;
  if (opts.pagePx) {
    pageW = Math.max(1, Math.round(opts.pagePx.width));
    pageH = Math.max(1, Math.round(opts.pagePx.height));
  } else if (opts.pageMM) {
    const dpiMM = opts.pageMM.dpi ?? dpi;
    pageW = mm2px(opts.pageMM.width, dpiMM);
    pageH = mm2px(opts.pageMM.height, dpiMM);
  } else {
    // A4(mm) → px
    pageW = mm2px(210, dpi);
    pageH = mm2px(297, dpi);
  }

  const margin = Math.max(0, opts.marginPx ?? 48);
  const gutter = Math.max(0, opts.gutterPx ?? 24);
  const bg = opts.background ?? '#ffffff';
  const quality = opts.quality ?? 0.95;
  const mode: FitMode = opts.fitMode ?? 'fill';
  const keepEmpty = opts.keepEmptySlots ?? true;
  const quadOrder: QuadKey[] =
    opts.quadrantOrder && opts.quadrantOrder.length === 4
      ? opts.quadrantOrder
      : ['TL', 'TR', 'BL', 'BR'];

  const drawLabels = opts.drawSlotLabels ?? false;
  const labelStyle = typeof drawLabels === 'object' ? drawLabels : undefined;
  const strokeEmpty = opts.strokeEmptySlots ?? false;
  const strokeStyle = typeof strokeEmpty === 'object' ? strokeEmpty : undefined;

  // 4개씩 끊기
  const groups: A4Base64Image[][] = [];
  for (let i = 0; i < imgs.length; i += 4) groups.push(imgs.slice(i, i + 4));
  if (groups.length === 0) groups.push([]); // 빈 그룹 방어

  const pages: string[] = [];

  for (const group of groups) {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, pageW, pageH);

    // 작업영역(여백 제외)
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;

    // 2×2 셀 계산 (항상 고정)
    const tileW = Math.floor((innerW - gutter) / 2);
    const tileH = Math.floor((innerH - gutter) / 2);
    const usedW = tileW * 2 + gutter;
    const usedH = tileH * 2 + gutter;
    const originX = margin + Math.round((innerW - usedW) / 2);
    const originY = margin + Math.round((innerH - usedH) / 2);

    // 4분면 좌표 (TL,TR,BL,BR)
    const cellsBase = [
      { key: 'TL' as const, x: originX, y: originY, w: tileW, h: tileH },
      { key: 'TR' as const, x: originX + tileW + gutter, y: originY, w: tileW, h: tileH },
      { key: 'BL' as const, x: originX, y: originY + tileH + gutter, w: tileW, h: tileH },
      { key: 'BR' as const, x: originX + tileW + gutter, y: originY + tileH + gutter, w: tileW, h: tileH },
    ];
    const cellsOrdered = quadOrder.map((k) => cellsBase.find((c) => c.key === k)!);

    // 그룹 이미지 로드 (dataURL 정규화)
    const loaded = await Promise.all(
      group.map((g) =>
        loadImageFromBase64(g.base64.startsWith('data:')
          ? g.base64
          : `data:${g.mimeType || 'image/jpeg'};base64,${g.base64}`)
      )
    );

    // 몇 슬롯을 사용할지
    const slotCount = keepEmpty ? 4 : Math.min(4, loaded.length);

    // 슬롯별 렌더
    for (let i = 0; i < slotCount; i++) {
      const cell = cellsOrdered[i];
      const img = loaded[i];

      if (img) {
        if (mode === 'fill') {
          drawImageInCellFill(ctx, img, cell.x, cell.y, cell.w, cell.h);
        } else if (mode === 'cover') {
          drawImageInCellCover(ctx, img, cell.x, cell.y, cell.w, cell.h);
        } else {
          drawImageInCellContain(ctx, img, cell.x, cell.y, cell.w, cell.h);
        }
      } else {
        // 빈 슬롯: 테두리(선택)
        if (strokeEmpty) drawEmptyStroke(ctx, cell.x, cell.y, cell.w, cell.h, strokeStyle);
      }

      // 라벨(선택): 1~4
      if (drawLabels) drawSlotLabel(ctx, cell.x, cell.y, cell.w, cell.h, i + 1, labelStyle);
    }

    if (stampDetails) {
        const { receiptNumber, siteLocation, inspectionStartDate, item } = stampDetails;
        const canvasBase = Math.min(pageW, pageH);
        const stampFont = Math.max(16, Math.round(canvasBase * 0.015)); 
        const stampPad = Math.round(stampFont * 0.5);
        const lineH = Math.round(stampFont * 1.4);

        const lines: string[] = [];
        if (receiptNumber?.trim()) lines.push(`접수번호: ${receiptNumber}`);
        if (siteLocation?.trim()) lines.push(`현장: ${siteLocation}`);
        if (item?.trim()) lines.push(`항목: ${item}`);
        if (inspectionStartDate?.trim()) lines.push(`검사시작일: ${inspectionStartDate}`);
        
        if (lines.length > 0) {
            ctx.font = `bold ${stampFont}px Arial, sans-serif`;
            let maxTextWidth = 0;
            for (const l of lines) {
                const w = ctx.measureText(l).width;
                if (w > maxTextWidth) maxTextWidth = w;
            }
            
            const blockW = maxTextWidth + stampPad * 2;
            const blockH = lines.length * lineH + stampPad;
            
            const rectX = pageW - margin - blockW;
            const rectY = pageH - margin - blockH;

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(rectX, rectY, blockW, blockH);

            ctx.fillStyle = '#fff';
            lines.forEach((l, i) => {
                const y = rectY + i * lineH + stampFont + (stampPad / 2);
                ctx.fillText(l, rectX + stampPad, y);
            });
        }
    }

    pages.push(safeToDataURL(canvas, 'image/jpeg', quality));
  }

  return pages;
}

export const compressImage = (base64: string, mimeType: string, maxWidth = 1280, maxHeight = 1280, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let { width, height } = img;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round(width * (maxHeight / height));
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Could not get canvas context for compression.'));
      }
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image for compression.'));
    img.src = ensureDataUrl(base64, mimeType);
  });
};
