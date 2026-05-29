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
  /** 🔸 전체 출력 크기를 "mm + dpi"로 고정 (예: { width:297, height:210, dpi?:300 }) */
  pageMM?: { width: number; height: number; dpi?: number };

  /** 🔸 그리드 열 수 (기본 2, 6장/페이지는 3) */
  gridCols?: number;
  /** 🔸 그리드 행 수 (기본 2, 6장/페이지는 2) */
  gridRows?: number;

  /** 🔸 4분면 고정 순서 (gridCols=2, gridRows=2일 때만 적용) */
  quadrantOrder?: QuadKey[];
  /** 🔸 항상 지정 그리드 슬롯 수 유지 (기본 true) */
  keepEmptySlots?: boolean;
  /** 🔸 슬롯 라벨(1~N) 렌더링 */
  drawSlotLabels?:
    | boolean
    | {
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
        color?: string;
        font?: string;
      };
  /** 🔸 빈 슬롯 테두리 표시 */
  strokeEmptySlots?: boolean | { color?: string; lineWidth?: number; dash?: number[] };
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
 * 단일 이미지에 좌하단 스탬프(접수번호 / 현장 / 항목)를 그려 dataURL 반환.
 * 코멘트는 사진에 삽입하지 않음 — 웹 UI 필드에만 존재.
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

      const lines: { text: string }[] = [];
      if (receiptNumber?.trim()) lines.push({ text: `접수번호: ${receiptNumber}` });
      if (siteLocation?.trim())  lines.push({ text: `현장: ${siteLocation}` });
      if (item?.trim())          lines.push({ text: `항목: ${item}` });
      if (comment?.trim())       lines.push({ text: `코멘트: ${comment}` });

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
        ctx.fillStyle = '#FFFFFF';
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
  const gridCols = opts.gridCols ?? 2;
  const gridRows = opts.gridRows ?? 2;
  const photosPerPage = gridCols * gridRows;

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
    // A4(mm) 세로 기본
    pageW = mm2px(210, dpi);
    pageH = mm2px(297, dpi);
  }

  const margin = Math.max(0, opts.marginPx ?? 48);
  const gutter = Math.max(0, opts.gutterPx ?? 24);
  const bg = opts.background ?? '#ffffff';
  const quality = opts.quality ?? 0.95;
  const mode: FitMode = opts.fitMode ?? 'fill';
  const keepEmpty = opts.keepEmptySlots ?? true;

  const drawLabels = opts.drawSlotLabels ?? false;
  const labelStyle = typeof drawLabels === 'object' ? drawLabels : undefined;
  const strokeEmpty = opts.strokeEmptySlots ?? false;
  const strokeStyle = typeof strokeEmpty === 'object' ? strokeEmpty : undefined;

  // photosPerPage 장씩 그룹화
  const groups: A4Base64Image[][] = [];
  for (let i = 0; i < imgs.length; i += photosPerPage) groups.push(imgs.slice(i, i + photosPerPage));
  if (groups.length === 0) groups.push([]);

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

    // N×M 셀 계산
    const tileW = Math.floor((innerW - gutter * (gridCols - 1)) / gridCols);
    const tileH = Math.floor((innerH - gutter * (gridRows - 1)) / gridRows);
    const usedW = tileW * gridCols + gutter * (gridCols - 1);
    const usedH = tileH * gridRows + gutter * (gridRows - 1);
    const originX = margin + Math.round((innerW - usedW) / 2);
    const originY = margin + Math.round((innerH - usedH) / 2);

    // 셀 좌표 (왼쪽→오른쪽, 위→아래 순서)
    const cells: { x: number; y: number; w: number; h: number }[] = [];
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        cells.push({
          x: originX + c * (tileW + gutter),
          y: originY + r * (tileH + gutter),
          w: tileW,
          h: tileH,
        });
      }
    }

    // 이미지 로드
    const loaded = await Promise.all(
      group.map((g) =>
        loadImageFromBase64(g.base64.startsWith('data:')
          ? g.base64
          : `data:${g.mimeType || 'image/jpeg'};base64,${g.base64}`)
      )
    );

    const slotCount = keepEmpty ? photosPerPage : Math.min(photosPerPage, loaded.length);

    for (let i = 0; i < slotCount; i++) {
      const cell = cells[i];
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
        if (strokeEmpty) drawEmptyStroke(ctx, cell.x, cell.y, cell.w, cell.h, strokeStyle as any);
      }

      if (drawLabels) drawSlotLabel(ctx, cell.x, cell.y, cell.w, cell.h, i + 1, labelStyle as any);
    }

    // 스탬프 (우하단)
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

// ===== 성적서 스타일 A4 사진 기록지 (P2/P3용) =====

export interface ReportMeta {
  receiptNumber?: string;
  siteLocation?: string;
  item?: string;
  inspectionStartDate?: string;
  inspectionEndDate?: string;
  postInspectionDate?: string;  // P1 측정범위 확인일
  userName?: string;
}

/**
 * 성적서 스타일 A4 사진 기록지 생성 (P2/P3용)
 * - 상단: 네이비 헤더 (문서 제목 + 접수번호 + 현장/항목)
 * - 중단: 2×2 사진 그리드 (캡션 포함)
 * - 하단: 페이지 번호 + 생성 정보 푸터
 */
export async function generateA4ReportPages(
  imgs: A4Base64Image[],
  meta: ReportMeta,
  opts: { quality?: number; dpi?: number } = {}
): Promise<string[]> {
  assertBrowser('generateA4ReportPages');

  const dpi     = opts.dpi ?? 300;
  const quality = opts.quality ?? 0.92;
  const PHOTOS_PER_PAGE = 4;

  const pageW  = mm2px(210, dpi);
  const pageH  = mm2px(297, dpi);
  const margin = mm2px(12, dpi);

  // 레이아웃 높이 구성
  const headerH      = mm2px(22, dpi);  // 기관명 + 문서 제목
  const dividerH     = mm2px(0.4, dpi); // 구분선
  const infoBarH     = mm2px(8, dpi);   // 정보 행
  const gapH         = mm2px(3, dpi);   // 헤더~사진 간격
  const footerH      = mm2px(8, dpi);
  const footerLineH  = mm2px(0.4, dpi);

  const photoAreaY = margin + headerH + dividerH + infoBarH + gapH;
  const photoAreaH = pageH - photoAreaY - footerH - footerLineH - margin;
  const photoAreaW = pageW - margin * 2;

  const gutterX  = mm2px(3, dpi);
  const gutterY  = mm2px(3, dpi);
  const captionH = mm2px(7, dpi);

  const cellW  = Math.floor((photoAreaW - gutterX) / 2);
  const cellH  = Math.floor((photoAreaH - gutterY) / 2);
  const photoH = cellH - captionH;

  const groups: A4Base64Image[][] = [];
  for (let i = 0; i < imgs.length; i += PHOTOS_PER_PAGE)
    groups.push(imgs.slice(i, i + PHOTOS_PER_PAGE));
  if (groups.length === 0) groups.push([]);
  const totalPages = groups.length;

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace('.', '년 ').replace('.', '월 ').replace('.', '일');

  const pages: string[] = [];

  for (let pageIdx = 0; pageIdx < groups.length; pageIdx++) {
    const group = groups[pageIdx];
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d')!;

    // ── 전체 흰색 배경 ──────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);

    // ── 헤더 영역 (흰 배경, 테두리 박스) ─────────────────
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = mm2px(0.4, dpi);
    ctx.strokeRect(margin, margin, pageW - margin * 2, headerH);

    // 기관명 (상단 작은 글씨)
    const orgSize = mm2px(3.2, dpi);
    ctx.font = `${orgSize}px "Arial", sans-serif`;
    ctx.fillStyle = '#444444';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('한국산업기술시험원 (KTL)', pageW / 2, margin + headerH * 0.28);

    // 문서 제목 (크고 굵게)
    const titleSize = mm2px(7, dpi);
    ctx.font = `bold ${titleSize}px "Arial", sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.fillText('사   진   기   록   지', pageW / 2, margin + headerH * 0.68);

    // 우상단: 접수번호
    const receiptSize = mm2px(3, dpi);
    ctx.font = `${receiptSize}px "Arial", sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'right';
    ctx.fillText(`접수번호: ${meta.receiptNumber || '-'}`, pageW - margin - mm2px(3, dpi), margin + mm2px(3.5, dpi));
    ctx.textAlign = 'left';

    // ── 구분선 ─────────────────────────────────────────
    const divY = margin + headerH;
    ctx.fillStyle = '#000000';
    ctx.fillRect(margin, divY, pageW - margin * 2, dividerH);

    // ── 정보 행 (표 형식) ──────────────────────────────
    const infoY = divY + dividerH;
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = mm2px(0.3, dpi);
    ctx.strokeRect(margin, infoY, pageW - margin * 2, infoBarH);

    const infoMid = infoY + infoBarH / 2;
    const infoFontSize = mm2px(3, dpi);
    ctx.font = `${infoFontSize}px "Arial", sans-serif`;
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // 3개 칸 나누기 (검사시작일 제거)
    const infoW = pageW - margin * 2;
    const col1W = infoW * 0.38;
    const col2W = infoW * 0.38;
    const col3W = infoW - col1W - col2W;

    const cols = [
      { label: '현  장', value: meta.siteLocation || '-', x: margin, w: col1W },
      { label: '항  목', value: meta.item || '-', x: margin + col1W, w: col2W },
      { label: '시험자', value: meta.userName || '-', x: margin + col1W + col2W, w: col3W },
    ];

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      // 라벨 배경 (아주 연한 회색 - 최소 잉크)
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(col.x, infoY, mm2px(14, dpi), infoBarH);
      // 수직 구분선
      if (ci > 0) {
        ctx.fillStyle = '#555555';
        ctx.fillRect(col.x, infoY, mm2px(0.3, dpi), infoBarH);
      }
      // 라벨
      ctx.font = `bold ${mm2px(2.8, dpi)}px "Arial", sans-serif`;
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'center';
      ctx.fillText(col.label, col.x + mm2px(7, dpi), infoMid);
      // 값
      ctx.font = `${mm2px(3, dpi)}px "Arial", sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      const textX = col.x + mm2px(15.5, dpi);
      const maxTextW = col.w - mm2px(16.5, dpi);
      ctx.fillText(col.value, textX, infoMid, maxTextW > 0 ? maxTextW : undefined);
    }

    ctx.textAlign = 'left';

    // ── 2×2 사진 그리드 ─────────────────────────────────
    const loaded = await Promise.all(
      group.map(g =>
        loadImageFromBase64(
          g.base64.startsWith('data:')
            ? g.base64
            : `data:${g.mimeType || 'image/jpeg'};base64,${g.base64}`
        )
      )
    );

    for (let i = 0; i < 4; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cellX = margin + col * (cellW + gutterX);
      const cellY = photoAreaY + row * (cellH + gutterY);

      // 사진 배경 (흰색)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cellX, cellY, cellW, photoH);

      const img = loaded[i];
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, cellY, cellW, photoH);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const r = Math.min(cellW / img.width, photoH / img.height);
        const dw = img.width * r;
        const dh = img.height * r;
        const dx = cellX + (cellW - dw) / 2;
        const dy = cellY + (photoH - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      } else {
        // 빈 슬롯 점선
        ctx.strokeStyle = '#aaaaaa';
        ctx.setLineDash([mm2px(3, dpi), mm2px(2, dpi)]);
        ctx.lineWidth = mm2px(0.3, dpi);
        ctx.strokeRect(cellX + mm2px(2, dpi), cellY + mm2px(2, dpi), cellW - mm2px(4, dpi), photoH - mm2px(4, dpi));
        ctx.setLineDash([]);
      }

      // 사진 테두리 (검정 실선)
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = mm2px(0.3, dpi);
      ctx.setLineDash([]);
      ctx.strokeRect(cellX, cellY, cellW, photoH);

      // ── 캡션 박스 (흰 배경 + 얇은 테두리) ─────────────
      const capY = cellY + photoH;
      ctx.fillStyle = '#f9f9f9';
      ctx.fillRect(cellX, capY, cellW, captionH);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = mm2px(0.3, dpi);
      ctx.strokeRect(cellX, capY, cellW, captionH);

      const photoNum = pageIdx * PHOTOS_PER_PAGE + i + 1;
      const capFont = mm2px(3.2, dpi);
      ctx.font = `bold ${capFont}px "Arial", sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`사진 ${photoNum}`, cellX + mm2px(2.5, dpi), capY + captionH * 0.5);

      const comment = group[i]?.comment || '';
      if (comment) {
        ctx.font = `${mm2px(2.8, dpi)}px "Arial", sans-serif`;
        ctx.fillStyle = '#333333';
        let displayComment = comment;
        const maxW = cellW - mm2px(22, dpi);
        while (ctx.measureText(displayComment).width > maxW && displayComment.length > 1) {
          displayComment = displayComment.slice(0, -1);
        }
        if (displayComment !== comment) displayComment += '…';
        ctx.fillText(displayComment, cellX + mm2px(14, dpi), capY + captionH * 0.5);
      }
    }

    // ── 푸터 구분선 ─────────────────────────────────────
    const footerLineY = pageH - margin - footerH - footerLineH;
    ctx.fillStyle = '#555555';
    ctx.fillRect(margin, footerLineY, pageW - margin * 2, footerLineH);

    // 푸터 텍스트
    const footFont = mm2px(2.8, dpi);
    ctx.font = `${footFont}px "Arial", sans-serif`;
    ctx.fillStyle = '#444444';
    ctx.textBaseline = 'middle';
    const footMid = footerLineY + footerLineH + footerH / 2;

    ctx.textAlign = 'left';
    ctx.fillText('claydox.ktl.re.kr', margin, footMid);
    ctx.textAlign = 'right';
    ctx.fillText(`${pageIdx + 1} / ${totalPages} 페이지`, pageW - margin, footMid);
    ctx.textAlign = 'left';

    pages.push(safeToDataURL(canvas, 'image/jpeg', quality));
  }

  return pages;
}

// ===== P1 구조 확인용 가로 A4 사진 기록지 (3×2, 흰 배경) =====
export async function generateA4LandscapeReportPages(
  imgs: A4Base64Image[],
  meta: ReportMeta,
  opts: { quality?: number; dpi?: number } = {}
): Promise<string[]> {
  assertBrowser('generateA4LandscapeReportPages');

  const dpi      = opts.dpi ?? 300;
  const quality  = opts.quality ?? 0.92;
  const COLS     = 3;
  const ROWS     = 2;
  const PER_PAGE = COLS * ROWS;

  // 가로 A4: 297×210mm
  const pageW  = mm2px(297, dpi);
  const pageH  = mm2px(210, dpi);
  const margin = mm2px(8, dpi);

  const headerH     = mm2px(16, dpi);
  const dividerH    = mm2px(0.4, dpi);
  const infoBarH    = mm2px(7, dpi);
  const gapH        = mm2px(2, dpi);
  const footerH     = mm2px(7, dpi);
  const footLineH   = mm2px(0.3, dpi);
  const captionH    = mm2px(7, dpi);

  const photoAreaY  = margin + headerH + dividerH + infoBarH + gapH;
  const photoAreaH  = pageH - photoAreaY - footerH - footLineH - margin;
  const photoAreaW  = pageW - margin * 2;

  const gutterX = mm2px(2.5, dpi);
  const gutterY = mm2px(2.5, dpi);

  const cellW  = Math.floor((photoAreaW - gutterX * (COLS - 1)) / COLS);
  const cellH  = Math.floor((photoAreaH - gutterY * (ROWS - 1)) / ROWS);
  const photoH = cellH - captionH;

  const groups: A4Base64Image[][] = [];
  for (let i = 0; i < imgs.length; i += PER_PAGE)
    groups.push(imgs.slice(i, i + PER_PAGE));
  if (groups.length === 0) groups.push([]);
  const totalPages = groups.length;

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

  const pages: string[] = [];

  for (let pageIdx = 0; pageIdx < groups.length; pageIdx++) {
    const group = groups[pageIdx];
    const canvas = document.createElement('canvas');
    canvas.width  = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d')!;

    // ── 흰색 배경 ────────────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);

    // ── 헤더 박스 ────────────────────────────────────────
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = mm2px(0.4, dpi);
    ctx.strokeRect(margin, margin, pageW - margin * 2, headerH);

    const hMid = margin + headerH / 2;

    // 기관명 (작은 글씨)
    ctx.font = `${mm2px(2.8, dpi)}px "Arial", sans-serif`;
    ctx.fillStyle = '#444444';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('한국산업기술시험원 (KTL)', pageW / 2, margin + headerH * 0.28);

    // 문서 제목 (굵게)
    ctx.font = `bold ${mm2px(5.5, dpi)}px "Arial", sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.fillText('체크리스트 확인 사진 기록지', pageW / 2, margin + headerH * 0.7);

    // 접수번호 (우상단)
    ctx.font = `${mm2px(2.6, dpi)}px "Arial", sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'right';
    ctx.fillText(`접수번호: ${meta.receiptNumber || '-'}`, pageW - margin - mm2px(3, dpi), margin + mm2px(3, dpi));
    ctx.textAlign = 'left';

    // ── 굵은 구분선 ──────────────────────────────────────
    ctx.fillStyle = '#000000';
    ctx.fillRect(margin, margin + headerH, pageW - margin * 2, dividerH);

    // ── 정보 행 (표 형식) ────────────────────────────────
    const infoY = margin + headerH + dividerH;
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = mm2px(0.25, dpi);
    ctx.strokeRect(margin, infoY, pageW - margin * 2, infoBarH);

    const infoMid = infoY + infoBarH / 2;
    const infoW   = pageW - margin * 2;
    const labelW  = mm2px(12, dpi);

    const infoCols = [
      { label: '현  장',   value: meta.siteLocation || '-',  xRatio: 0 },
      { label: '항  목',   value: meta.item || '-',           xRatio: 0.4 },
      { label: '시험자',   value: meta.userName || '-',       xRatio: 0.73 },
    ];

    for (let ci = 0; ci < infoCols.length; ci++) {
      const ic = infoCols[ci];
      const ix = margin + Math.round(infoW * ic.xRatio);
      // 라벨 배경
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(ix, infoY, labelW, infoBarH);
      // 수직 구분선
      if (ci > 0) {
        ctx.fillStyle = '#555555';
        ctx.fillRect(ix, infoY, mm2px(0.25, dpi), infoBarH);
      }
      // 라벨 (줄바꿈 지원)
      ctx.font = `bold ${mm2px(2.4, dpi)}px "Arial", sans-serif`;
      ctx.fillStyle = '#333333';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const labelLines = ic.label.split('\n');
      if (labelLines.length === 1) {
        ctx.fillText(ic.label, ix + labelW / 2, infoMid);
      } else {
        const lineH = mm2px(3, dpi);
        const totalH = lineH * labelLines.length;
        labelLines.forEach((line, li) => {
          ctx.fillText(line, ix + labelW / 2, infoMid - totalH / 2 + lineH * li + lineH / 2);
        });
      }
      // 값
      ctx.font = `${mm2px(2.6, dpi)}px "Arial", sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      const nextRatio = ci + 1 < infoCols.length ? infoCols[ci + 1].xRatio : 1;
      const colW = Math.round(infoW * nextRatio) - Math.round(infoW * ic.xRatio);
      const maxValW = colW - labelW - mm2px(2, dpi);
      ctx.fillText(ic.value, ix + labelW + mm2px(1.5, dpi), infoMid, maxValW > 0 ? maxValW : undefined);
    }
    ctx.textAlign = 'left';

    // ── 3×2 사진 그리드 ──────────────────────────────────
    const loaded = await Promise.all(
      group.map(g =>
        loadImageFromBase64(
          g.base64.startsWith('data:')
            ? g.base64
            : `data:${g.mimeType || 'image/jpeg'};base64,${g.base64}`
        )
      )
    );

    for (let i = 0; i < PER_PAGE; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = margin + col * (cellW + gutterX);
      const cellY = photoAreaY + row * (cellH + gutterY);

      // 사진 배경 (흰색)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cellX, cellY, cellW, photoH);

      const img = loaded[i];
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, cellY, cellW, photoH);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const r = Math.min(cellW / img.width, photoH / img.height);
        const dw = img.width * r;
        const dh = img.height * r;
        ctx.drawImage(img, cellX + (cellW - dw) / 2, cellY + (photoH - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        // 빈 슬롯
        ctx.strokeStyle = '#bbbbbb';
        ctx.setLineDash([mm2px(2.5, dpi), mm2px(1.5, dpi)]);
        ctx.lineWidth = mm2px(0.25, dpi);
        ctx.strokeRect(cellX + mm2px(1.5, dpi), cellY + mm2px(1.5, dpi), cellW - mm2px(3, dpi), photoH - mm2px(3, dpi));
        ctx.setLineDash([]);
      }

      // 사진 테두리
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = mm2px(0.25, dpi);
      ctx.setLineDash([]);
      ctx.strokeRect(cellX, cellY, cellW, photoH);

      // ── 캡션 박스 ──────────────────────────────────────
      const capY = cellY + photoH;
      ctx.fillStyle = '#f9f9f9';
      ctx.fillRect(cellX, capY, cellW, captionH);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = mm2px(0.25, dpi);
      ctx.strokeRect(cellX, capY, cellW, captionH);

      const photoNum = pageIdx * PER_PAGE + i + 1;
      ctx.font = `bold ${mm2px(2.8, dpi)}px "Arial", sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(`사진 ${photoNum}`, cellX + mm2px(1.5, dpi), capY + captionH * 0.5);

      const comment = group[i]?.comment || '';
      if (comment) {
        ctx.font = `${mm2px(2.5, dpi)}px "Arial", sans-serif`;
        ctx.fillStyle = '#333333';
        let txt = comment;
        const maxTxtW = cellW - mm2px(14, dpi);
        while (ctx.measureText(txt).width > maxTxtW && txt.length > 1)
          txt = txt.slice(0, -1);
        if (txt !== comment) txt += '…';
        ctx.fillText(txt, cellX + mm2px(11, dpi), capY + captionH * 0.5);
      }
    }

    // ── 푸터 ─────────────────────────────────────────────
    const footLineY = pageH - margin - footerH - footLineH;
    ctx.fillStyle = '#555555';
    ctx.fillRect(margin, footLineY, pageW - margin * 2, footLineH);

    ctx.font = `${mm2px(2.4, dpi)}px "Arial", sans-serif`;
    ctx.fillStyle = '#444444';
    ctx.textBaseline = 'middle';
    const footMid = footLineY + footLineH + footerH / 2;

    ctx.textAlign = 'left';
    ctx.fillText(`claydox.ktl.re.kr`, margin, footMid);
    ctx.textAlign = 'right';
    ctx.fillText(`${pageIdx + 1} / ${totalPages} 페이지`, pageW - margin, footMid);
    ctx.textAlign = 'left';

    pages.push(safeToDataURL(canvas, 'image/jpeg', quality));
  }

  return pages;
}

export const compressImage = (base64: string, mimeType: string, maxWidth = 2048, maxHeight = 2048, quality = 0.92): Promise<string> => {
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

// ─── 추가 사진자료 전용 A4 3×3 생성 ──────────────────────────────────────────
// 기존 generateA4CompositeJPEGPages()와 완전히 별도 함수.
// 기존 함수의 인터페이스·기본값·출력 결과에 영향 없음.

export interface ExtraPhotoForA4 {
  file: File;
  photoType: string;
  comment: string;
}

/** File 객체에서 HTMLImageElement 로드 (Object URL 사용, 로드 후 즉시 revoke) */
async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`이미지 로드 실패: ${file.name}`)); };
    img.src = url;
  });
}

/** 이미지를 셀에 cover 방식으로 그리는 헬퍼 */
function drawImageCoverInCell(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number, cy: number, cw: number, ch: number
) {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const cellAspect = cw / ch;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgAspect > cellAspect) {
    sw = img.naturalHeight * cellAspect;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / cellAspect;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, cx, cy, cw, ch);
}

/**
 * 추가 사진자료 A4 3×3 JPEG 페이지 생성
 * - 기존 generateA4CompositeJPEGPages 와 완전히 독립된 함수
 * - 기존 P1~P5 출력 결과에 영향 없음
 * - 반환: JPEG data URL 배열 (페이지 수만큼)
 */
export async function generateExtraPhotoA4Pages(
  photos: ExtraPhotoForA4[],
  meta: { receiptNumber: string; itemName: string }
): Promise<string[]> {
  assertBrowser('generateExtraPhotoA4Pages');

  const COLS = 3;
  const ROWS = 2;
  const PER_PAGE = COLS * ROWS;   // 6장 / 페이지

  // A4 가로(landscape) ~150dpi (1754×1240px)
  const PAGE_W = 1754;
  const PAGE_H = 1240;

  const MARGIN = 40;
  const GUTTER = 12;
  const HEADER_H = 72;     // 상단 헤더 높이
  const CAPTION_H = 48;    // 셀 하단 캡션 높이


  const innerW = PAGE_W - MARGIN * 2;
  const innerH = PAGE_H - MARGIN * 2 - HEADER_H;

  const CELL_W = Math.floor((innerW - GUTTER * (COLS - 1)) / COLS);
  const CELL_H = Math.floor((innerH - GUTTER * (ROWS - 1)) / ROWS);
  const IMG_AREA_H = CELL_H - CAPTION_H;

  // 색상 팔레트 (흰 배경 공공문서용)
  const C_BG         = '#ffffff';     // 페이지 배경
  const C_HEADER_BG  = '#f4f6f8';     // 헤더 영역 배경 (연회색)
  const C_HEADER_BD  = '#cccccc';     // 헤더 하단 경계선
  const C_TITLE      = '#1a1a2e';     // 제목 텍스트 (진한 남색)
  const C_META       = '#555555';     // 부제 텍스트
  const C_CELL_BG    = '#f9f9f9';     // 빈 셀 배경
  const C_CELL_BD    = '#bbbbbb';     // 셀 테두리
  const C_CAP_BG     = '#f0f2f5';     // 캡션 배경 (연회색)
  const C_CAP_BD     = '#cccccc';     // 캡션 상단 경계선
  const C_CAP_LABEL  = '#1a56a8';     // 유형 레이블 (파란색)
  const C_CAP_TEXT   = '#333333';     // 코멘트 텍스트
  const C_NUM_BG     = 'rgba(0,0,0,0.12)'; // 셀 번호 배경
  const C_NUM_TEXT   = '#222222';     // 셀 번호 텍스트
  const C_ERR_BG     = '#f5f5f5';     // 이미지 오류 배경
  const C_ERR_TEXT   = '#888888';     // 이미지 오류 텍스트

  const pages: string[] = [];
  const groups: ExtraPhotoForA4[][] = [];
  for (let i = 0; i < photos.length; i += PER_PAGE) groups.push(photos.slice(i, i + PER_PAGE));
  if (groups.length === 0) groups.push([]);

  for (let pageIdx = 0; pageIdx < groups.length; pageIdx++) {
    const group = groups[pageIdx];
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;

    // ── 페이지 배경 (흰색)
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // ── 상단 헤더 (연회색 배경 + 하단 구분선)
    const headerY = MARGIN;
    const headerH = HEADER_H - 12;
    ctx.fillStyle = C_HEADER_BG;
    ctx.fillRect(MARGIN, headerY, innerW, headerH);
    ctx.strokeStyle = C_HEADER_BD;
    ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN + 0.5, headerY + 0.5, innerW - 1, headerH - 1);

    // 제목
    ctx.fillStyle = C_TITLE;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('추가 사진자료', MARGIN + 16, headerY + headerH * 0.35);

    // 접수번호 / 항목
    ctx.fillStyle = C_META;
    ctx.font = '13px sans-serif';
    ctx.fillText(
      `접수번호: ${meta.receiptNumber}  |  항목: ${meta.itemName || '-'}`,
      MARGIN + 16,
      headerY + headerH * 0.72
    );

    // 페이지 번호 (우측)
    if (groups.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = C_META;
      ctx.font = '12px sans-serif';
      ctx.fillText(`${pageIdx + 1} / ${groups.length}`, MARGIN + innerW - 12, headerY + headerH * 0.5);
    }

    // ── 2×2 그리드
    const gridOriginY = MARGIN + HEADER_H;
    const originX = MARGIN;

    for (let i = 0; i < PER_PAGE; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = originX + col * (CELL_W + GUTTER);
      const cellY = gridOriginY + row * (CELL_H + GUTTER);

      // 셀 배경 + 외곽 테두리
      ctx.fillStyle = C_CELL_BG;
      ctx.fillRect(cellX, cellY, CELL_W, CELL_H);
      ctx.strokeStyle = C_CELL_BD;
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX + 0.5, cellY + 0.5, CELL_W - 1, CELL_H - 1);

      const item = group[i];
      if (item) {
        // ── 이미지 영역 (cover 방식)
        try {
          const img = await loadImageFromFile(item.file);
          ctx.save();
          ctx.beginPath();
          ctx.rect(cellX, cellY, CELL_W, IMG_AREA_H);
          ctx.clip();
          drawImageCoverInCell(ctx, img, cellX, cellY, CELL_W, IMG_AREA_H);
          ctx.restore();
        } catch {
          ctx.fillStyle = C_ERR_BG;
          ctx.fillRect(cellX, cellY, CELL_W, IMG_AREA_H);
          ctx.fillStyle = C_ERR_TEXT;
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('이미지 로드 실패', cellX + CELL_W / 2, cellY + IMG_AREA_H / 2);
        }

        // ── 캡션: comment 텍스트 (최대 2줄)
        const capY = cellY + IMG_AREA_H;
        ctx.fillStyle = C_CAP_BG;
        ctx.fillRect(cellX, capY, CELL_W, CAPTION_H);
        ctx.strokeStyle = C_CAP_BD;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cellX, capY + 0.5);
        ctx.lineTo(cellX + CELL_W, capY + 0.5);
        ctx.stroke();
        const dispText = (item.comment || '').trim();
        if (dispText) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = C_CAP_TEXT;
          ctx.font = '14px sans-serif';
          const maxW = CELL_W - 20;
          // 1줄
          let line1 = '';
          for (const ch of dispText) {
            if (ctx.measureText(line1 + ch).width <= maxW) line1 += ch;
            else break;
          }
          // 2줄 (나머지)
          let rem = dispText.slice(line1.length);
          let line2 = '';
          if (rem.length > 0) {
            for (const ch of rem) {
              if (ctx.measureText(line2 + ch + '…').width <= maxW) line2 += ch;
              else { line2 += '…'; break; }
            }
          }
          ctx.fillText(line1, cellX + 10, capY + 24);
          if (line2) ctx.fillText(line2, cellX + 10, capY + 46);
        }

      } else {
        // 빈 셀: 이미 배경/테두리 그렸으므로 추가 처리 없음
      }

      // ── 셀 번호 (우상단, 연한 배경 + 어두운 텍스트)
      const numW = 26, numH = 20;
      ctx.fillStyle = C_NUM_BG;
      ctx.fillRect(cellX + CELL_W - numW, cellY, numW, numH);
      ctx.fillStyle = C_NUM_TEXT;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pageIdx * PER_PAGE + i + 1), cellX + CELL_W - numW / 2, cellY + numH / 2);
    }

    // ── 하단 테두리 선
    ctx.strokeStyle = C_HEADER_BD;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(MARGIN, PAGE_H - MARGIN + 4);
    ctx.lineTo(MARGIN + innerW, PAGE_H - MARGIN + 4);
    ctx.stroke();

    pages.push(canvas.toDataURL('image/jpeg', 0.92));
  }

  return pages;
}

