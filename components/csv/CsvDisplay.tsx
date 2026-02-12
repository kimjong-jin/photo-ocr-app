import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';
import type {
  CsvGraphJob,
  AiAnalysisPoint,
  AiAnalysisResult,
  AnalysisResult as JobAnalysisResult,
  SensorType,
} from '../../types/csvGraph';

// ===== 타입 정의 =====
interface ChannelInfo {
  id: string;
  name: string;
  unit: string;
}

interface DataPoint {
  timestamp: Date;
  values: (number | null)[];
}

interface RangeSelection {
  start: { timestamp: Date; value: number } | null;
  end: { timestamp: Date; value: number } | null;
}

type AnalysisResult = JobAnalysisResult;

// ===== 아이콘 컴포넌트 =====
const EnterFullScreenIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
  </svg>
);

const ExitFullScreenIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9V4.5M15 9h4.5M15 9l5.25-5.25M15 15v4.5M15 15h4.5M15 15l5.25 5.25" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const CameraIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
  </svg>
);

const SendIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

// ===== ResizeObserver Hook =====
const useResizeObserver = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = resizeRef.current;
    if (!element) return;
    const resizeObserver = new (window as any).ResizeObserver((entries: any[]) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    resizeObserver.observe(element);
    return () => resizeObserver.unobserve(element);
  }, []);
  return { ref: resizeRef, ...size };
};

// --- MiniMap Component ---
interface MiniMapProps {
  fullData: DataPoint[];
  channelIndex: number;
  viewEndTimestamp: number | null;
  timeRangeInMs: 'all' | number;
  fullTimeRange: { min: number; max: number };
  onNavigate: (newEndTs: number) => void;
  onRangeChange: (newRangeMs: number, newEndTs: number) => void;
}

const MiniMap: React.FC<MiniMapProps> = ({ fullData, channelIndex, viewEndTimestamp, timeRangeInMs, fullTimeRange, onNavigate, onRangeChange }) => {
  const { ref, width, height } = useResizeObserver();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState<'none' | 'move' | 'left' | 'right'>('none');
  const dragData = useRef({ startX: 0, startRange: 0, startEndTs: 0 });

  const effectiveRange = timeRangeInMs === 'all' ? (fullTimeRange.max - fullTimeRange.min) : timeRangeInMs;
  const effectiveEnd = viewEndTimestamp || fullTimeRange.max;
  const effectiveStart = effectiveEnd - effectiveRange;

  const mapX = useCallback((ts: number) => ((ts - fullTimeRange.min) / (fullTimeRange.max - fullTimeRange.min)) * width, [width, fullTimeRange]);
  const unmapX = useCallback((x: number) => fullTimeRange.min + (x / width) * (fullTimeRange.max - fullTimeRange.min), [width, fullTimeRange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const channelData = fullData.map(d => ({ ts: d.timestamp.getTime(), v: d.values[channelIndex] })).filter(d => d.v !== null);
    if (channelData.length < 2) return;

    const yMin = Math.min(...channelData.map(d => d.v!));
    const yMax = Math.max(...channelData.map(d => d.v!));
    const yRange = (yMax - yMin) || 1;
    const mapY = (v: number) => height - ((v - yMin) / yRange) * height;

    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.beginPath();
    channelData.forEach((d, i) => {
      const x = mapX(d.ts); const y = mapY(d.v!);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const vEndX = mapX(effectiveEnd);
    const vStartX = mapX(effectiveStart);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.fillRect(vStartX, 0, vEndX - vStartX, height);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
    ctx.strokeRect(vStartX, 0, vEndX - vStartX, height);
  }, [fullData, channelIndex, effectiveEnd, effectiveStart, fullTimeRange, width, height, mapX]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const vStartX = mapX(effectiveStart);
    const vEndX = mapX(effectiveEnd);
    const selWidth = vEndX - vStartX;

    dragData.current = { startX: e.clientX, startRange: effectiveRange, startEndTs: effectiveEnd };
    const handleW = Math.min(12, selWidth * 0.2);

    if (x >= vStartX + handleW && x <= vEndX - handleW) setIsDragging('move');
    else if (Math.abs(x - vStartX) < 20 && x < vStartX + handleW) setIsDragging('left');
    else if (Math.abs(x - vEndX) < 20 && x > vEndX - handleW) setIsDragging('right');
    else if (x >= vStartX && x <= vEndX) setIsDragging('move');
    else onNavigate(unmapX(x));

    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging === 'none') return;
    if (width <= 0) return;
    const deltaX = e.clientX - dragData.current.startX;
    const deltaTs = (deltaX / width) * (fullTimeRange.max - fullTimeRange.min);

    if (isDragging === 'move') {
      const nextEnd = Math.min(fullTimeRange.max, Math.max(fullTimeRange.min + dragData.current.startRange, dragData.current.startEndTs + deltaTs));
      onNavigate(nextEnd);
    } else if (isDragging === 'left') {
      const nextStart = Math.max(fullTimeRange.min, (dragData.current.startEndTs - dragData.current.startRange) + deltaTs);
      const nextRange = Math.max(1000, dragData.current.startEndTs - nextStart);
      onRangeChange(nextRange, dragData.current.startEndTs);
    } else if (isDragging === 'right') {
      const nextEnd = Math.min(fullTimeRange.max, dragData.current.startEndTs + deltaTs);
      const nextRange = Math.max(1000, nextEnd - (dragData.current.startEndTs - dragData.current.startRange));
      onRangeChange(nextRange, nextEnd);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging('none');
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
  };

  return (
    <div ref={ref} className="h-16 bg-slate-900/80 rounded-md border border-slate-700 overflow-hidden mb-2 touch-none">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: isDragging !== 'none' ? 'grabbing' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
};

// --- Main Graph Component ---
interface GraphCanvasProps {
  data: DataPoint[];
  fullData: DataPoint[];
  channelIndex: number;
  channelInfo: ChannelInfo;
  width: number;
  height: number;
  viewEndTimestamp: number | null;
  timeRangeInMs: 'all' | number;
  fullTimeRange: { min: number; max: number };
  onFinePan: (direction: number) => void;
  onPanByAmount: (ms: number) => void;
  onZoom: (zoomFactor: number, centerTs: number) => void;
  showMajorTicks: boolean;
  yMinMaxOverall: { yMin: number; yMax: number } | null;
  isAnalyzing: boolean;
  isMaxMinMode: boolean;
  onPointSelect: (point: { timestamp: Date; value: number }) => void;
  selection: RangeSelection | null;
  analysisResults: AnalysisResult[];
  aiAnalysisResult: AiAnalysisResult | null;
  placingAiPointLabel: string | null;
  onManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
  setPlacingAiPointLabel: (label: string | null) => void;
  isRangeSelecting: boolean;
  rangeSelection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; } | null;
  onRangeSelectComplete: (selection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; }) => void;
  sequentialPlacementState: { isActive: boolean; currentIndex: number; };
  onSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
  sensorType: SensorType;
  SEQUENTIAL_POINT_ORDER: string[];
  receiptNumber: string;
  graphRef?: React.RefObject<HTMLDivElement>;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({
  data, fullData, channelIndex, channelInfo, width, height, viewEndTimestamp, timeRangeInMs, fullTimeRange,
  onFinePan, onPanByAmount, onZoom, showMajorTicks, yMinMaxOverall,
  isAnalyzing, isMaxMinMode, onPointSelect, selection, analysisResults, aiAnalysisResult,
  placingAiPointLabel, onManualAiPointPlacement,
  setPlacingAiPointLabel, isRangeSelecting, rangeSelection, onRangeSelectComplete,
  sequentialPlacementState, onSequentialPointPlacement, sensorType, SEQUENTIAL_POINT_ORDER, receiptNumber, graphRef
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padding = { top: 40, right: 60, bottom: 40, left: 60 };

  const [fixedGuidelineX, setFixedGuidelineX] = useState<number>(0);
  const [currentGuideData, setCurrentGuideData] = useState<DataPoint | null>(null);
  const [isOverReadout, setIsOverReadout] = useState<boolean>(false);
  const [draggedMarkerKey, setDraggedMarkerKey] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);

  // ✅ 스크럽(기준선 이동)은 readout/포인트/마커 잡았을 때만
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const POINT_GRAB_R = 10;
  const CLICK_THRESHOLD = 15; // 모바일 클릭 허용 오차 (픽셀)

  // 터치 상태 관리 (이동 여부 판정용)
  const touchState = useRef({ isPanning: false, startX: 0, startY: 0, lastX: 0, initialDistance: 0, isZooming: false, hasMoved: false });

  useEffect(() => {
    if (width && fixedGuidelineX === 0) {
      setFixedGuidelineX(padding.left + (width - padding.left - padding.right) / 2);
    }
  }, [width, fixedGuidelineX]);

  const viewportMax = useMemo(() => viewEndTimestamp || fullTimeRange.max, [viewEndTimestamp, fullTimeRange.max]);
  const viewportMin = useMemo(() => {
    const range = timeRangeInMs === 'all' ? (fullTimeRange.max - fullTimeRange.min) : timeRangeInMs;
    return viewportMax - range;
  }, [viewportMax, timeRangeInMs, fullTimeRange]);

  const getChannelData = useMemo(() => {
    return fullData
      .map(d => ({ ...d, value: d.values[channelIndex] }))
      .filter(d => d.value !== null && typeof d.value === 'number') as (DataPoint & { value: number })[];
  }, [fullData, channelIndex]);

  const getYBounds = useMemo(() => {
    if (yMinMaxOverall) return yMinMaxOverall;
    const values = data.map(d => d.values[channelIndex]).filter(v => v !== null) as number[];
    if (values.length === 0) return { yMin: 0, yMax: 100 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;
    return { yMin: min - range * 0.1, yMax: max + range * 0.1 };
  }, [data, channelIndex, yMinMaxOverall]);

  const mapX = useCallback((ts: number) => {
    const graphWidth = width - padding.left - padding.right;
    return padding.left + ((ts - viewportMin) / (viewportMax - viewportMin)) * graphWidth;
  }, [width, viewportMin, viewportMax, padding.left, padding.right]);

  const mapY = useCallback((val: number) => {
    const graphHeight = height - padding.top - padding.bottom;
    return padding.top + graphHeight - ((val - getYBounds.yMin) / (getYBounds.yMax - getYBounds.yMin)) * graphHeight;
  }, [height, getYBounds, padding.top, padding.bottom]);

  const clampGuidelineX = useCallback((x: number) => {
    return Math.max(padding.left, Math.min(x, width - padding.right));
  }, [padding.left, padding.right, width]);

  const updateGuideData = useCallback(() => {
    if (width === 0 || getChannelData.length === 0) return;
    const graphWidth = width - padding.left - padding.right;
    if (graphWidth <= 0) return;

    const timeAtLine = viewportMin + ((fixedGuidelineX - padding.left) / graphWidth) * (viewportMax - viewportMin);

    let minDistance = Infinity;
    let closest = getChannelData[0];
    getChannelData.forEach(d => {
      const dist = Math.abs(d.timestamp.getTime() - timeAtLine);
      if (dist < minDistance) { minDistance = dist; closest = d; }
    });
    setCurrentGuideData(closest);
  }, [fixedGuidelineX, width, viewportMin, viewportMax, getChannelData, padding.left, padding.right]);

  useEffect(() => { updateGuideData(); }, [updateGuideData]);

  const getSnappedPoint = useCallback((label: string, basePoint: { timestamp: Date; value: number }) => {
    const upperLabel = label.toUpperCase();

    if (upperLabel === 'EN') {
      const stPoint = (aiAnalysisResult as any)?.st;
      const stTime = stPoint ? new Date(stPoint.timestamp).getTime() : 0;

      let targetValue: number | null = null;
      if (sensorType === 'PH') targetValue = basePoint.value > 7 ? 9.7 : 4.3;
      else if (sensorType === 'DO') targetValue = 1.0;
      else if (sensorType === 'TU' || sensorType === 'Cl') {
        const s1Point = (aiAnalysisResult as any)?.s1;
        if (s1Point) targetValue = s1Point.value * 0.9;
      }

      if (targetValue !== null) {
        let interpPoint = null;
        let minTimeDiff = Infinity;
        for (let i = 0; i < getChannelData.length - 1; i++) {
          const d1 = getChannelData[i];
          const d2 = getChannelData[i + 1];
          if (d1.timestamp.getTime() <= stTime) continue;

          let crossed = false;
          if (sensorType === 'PH') {
            if (targetValue === 9.7) crossed = (d1.value < 9.7 && d2.value >= 9.7) || (d1.value >= 9.7 && d2.value < 9.7);
            else crossed = (d1.value > 4.3 && d2.value <= 4.3) || (d1.value <= 4.3 && d2.value > 4.3);
          } else if (sensorType === 'DO' || sensorType === 'TU' || sensorType === 'Cl') {
            crossed = (d1.value > targetValue && d2.value <= targetValue) || (d1.value <= targetValue && d2.value > targetValue);
          }

          if (crossed) {
            // ✅ "쌓이는게 10초단위" 조건 충족을 위해 보간(Interpolation) 제거.
            // threshold를 넘은 실제 샘플링 지점(d2)의 타임스탬프를 그대로 사용함.
            const snapTs = d2.timestamp.getTime();
            const timeDiff = Math.abs(snapTs - basePoint.timestamp.getTime());
            if (timeDiff < minTimeDiff) {
              minTimeDiff = timeDiff;
              interpPoint = { timestamp: d2.timestamp, value: d2.value };
            }
          }
        }
        return interpPoint || basePoint;
      }
    }
    return basePoint;
  }, [sensorType, aiAnalysisResult, getChannelData]);

  const confirmPoint = useCallback((point: { timestamp: Date; value: number }) => {
    if (isMaxMinMode) {
      onPointSelect(point);
    } else if (placingAiPointLabel) {
      const snapped = getSnappedPoint(placingAiPointLabel, point);
      onManualAiPointPlacement(placingAiPointLabel, snapped);
    } else if (sequentialPlacementState.isActive) {
      const label = SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex];
      if (label) {
        const snapped = getSnappedPoint(label, point);
        onSequentialPointPlacement(snapped);
      }
    }
  }, [isMaxMinMode, onPointSelect, placingAiPointLabel, getSnappedPoint, onManualAiPointPlacement, sequentialPlacementState, onSequentialPointPlacement, SEQUENTIAL_POINT_ORDER]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1) AI 마커 드래그 감지(기존)
    if (aiAnalysisResult) {
      for (const [key, pt] of Object.entries(aiAnalysisResult)) {
        if (pt && typeof pt === 'object' && (pt as any).timestamp) {
          const px = mapX(new Date((pt as any).timestamp).getTime());
          const py = mapY((pt as any).value);
          const dist = Math.hypot(x - px, y - py);
          if (dist < 20) {
            setDraggedMarkerKey(key);
            setIsScrubbing(false);
            touchState.current.hasMoved = true;
            touchState.current.isPanning = false;
            (e.target as Element).setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }

    // 터치 시점에 네모 박스 위에 있는지 즉시 판정
    let isCurrentlyOverReadout = false;
    if (currentGuideData) {
      const tw = 180;
      const rx = fixedGuidelineX - (tw + 40) / 2;
      const ry = padding.top - 50;
      isCurrentlyOverReadout = x >= rx && x <= rx + tw + 40 && y >= ry && y <= ry + 40;
      setIsOverReadout(isCurrentlyOverReadout);
    }

    // 2) 기준선 스크럽 시작 조건: readout 박스 OR 가이드 포인트 원만
    let shouldScrub = false;

    if (isCurrentlyOverReadout && currentGuideData) {
      shouldScrub = true;
    } else if (currentGuideData) {
      const px = fixedGuidelineX;
      const py = mapY((currentGuideData as any).value);
      if (Math.hypot(x - px, y - py) <= POINT_GRAB_R) {
        shouldScrub = true;
      }
    }

    setIsScrubbing(shouldScrub);

    // 3) 드래그 상태 초기화
    touchState.current.hasMoved = false;
    touchState.current.startX = e.clientX;
    touchState.current.startY = e.clientY;
    touchState.current.lastX = e.clientX;

    // ✅ 핵심: 스크럽이 아니면 무조건 패닝
    touchState.current.isPanning = !shouldScrub;

    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const totalDx = e.clientX - touchState.current.startX;
    const totalDy = e.clientY - touchState.current.startY;
    const movedDistance = Math.hypot(totalDx, totalDy);

    // Readout Hover 판정
    if (currentGuideData) {
      const tw = 180;
      const rx = fixedGuidelineX - (tw + 40) / 2;
      const ry = padding.top - 50;
      const isOver = x >= rx && x <= rx + tw + 40 && y >= ry && y <= ry + 40;
      setIsOverReadout(isOver);
    }

    // 1) 마커 드래그 중이면 기준선 이동
    if (draggedMarkerKey) {
      setFixedGuidelineX(clampGuidelineX(x));
      if (movedDistance > CLICK_THRESHOLD) touchState.current.hasMoved = true;
      return;
    }

    // 2) 스크럽이면 기준선만 이동 (그래프는 안 움직임)
    if (isScrubbing && !touchState.current.isZooming) {
      setFixedGuidelineX(clampGuidelineX(x));
      if (movedDistance > CLICK_THRESHOLD) touchState.current.hasMoved = true;
      return;
    }

    // 3) 패닝
    if (touchState.current.isPanning) {
      const dx = e.clientX - touchState.current.lastX;
      
      if (movedDistance > CLICK_THRESHOLD) touchState.current.hasMoved = true;

      const graphWidth = width - padding.left - padding.right;
      const timeDelta = -(dx / graphWidth) * (viewportMax - viewportMin);
      onPanByAmount(timeDelta);

      touchState.current.lastX = e.clientX;
      return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      setDraggedMarkerKey(null);
      setIsScrubbing(false);
      touchState.current.isPanning = false;
      return;
    }

    // 클릭 판정 (이동이 CLICK_THRESHOLD 이하였을 때)
    if (!touchState.current.hasMoved && !draggedMarkerKey) {
      if (isOverReadout && currentGuideData) {
        confirmPoint({ timestamp: currentGuideData.timestamp, value: (currentGuideData as any).value });
      } else {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (x >= padding.left && x <= width - padding.right) {
          const currentLabel = placingAiPointLabel || (sequentialPlacementState.isActive ? SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex] : null);
          if ((currentLabel || isMaxMinMode) && currentGuideData) {
            const py = mapY((currentGuideData as any).value);
            const distY = Math.abs(y - py);
            if (distY < 40) {
              confirmPoint({ timestamp: currentGuideData.timestamp, value: (currentGuideData as any).value });
            }
          }
        }
      }
    }

    if (draggedMarkerKey && currentGuideData && touchState.current.hasMoved) {
      const finalPoint = getSnappedPoint(draggedMarkerKey, { timestamp: currentGuideData.timestamp, value: (currentGuideData as any).value });
      onManualAiPointPlacement(draggedMarkerKey.toUpperCase(), finalPoint);
    }

    setDraggedMarkerKey(null);
    setIsScrubbing(false);
    touchState.current.isPanning = false;

    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
  };

  const handleClick = (e: React.MouseEvent) => {
    if (touchState.current.hasMoved || draggedMarkerKey) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      touchState.current.initialDistance = dist;
      touchState.current.isZooming = true;
      touchState.current.hasMoved = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchState.current.isZooming && e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
      const factor = dist / touchState.current.initialDistance;
      if (Math.abs(factor - 1) > 0.02) {
        onZoom(factor > 1 ? 1.05 : 0.95, viewportMin + (viewportMax - viewportMin) / 2);
        touchState.current.initialDistance = dist;
      }
    }
  };

  const handleTouchEnd = () => { touchState.current.isZooming = false; };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    // 0. 접수번호 표시 (상단 좌측 - 작고 눈에 띄게 조절)
    ctx.save();
    ctx.fillStyle = 'rgba(203, 213, 225, 0.9)'; // slate-300
    ctx.font = '11px Inter'; // 작지만 가독성 있는 크기
    ctx.textAlign = 'left';
    ctx.fillText(receiptNumber, padding.left + 6, padding.top + 14);
    ctx.restore();

    // 1. 그리드 및 Y축 라벨
    ctx.strokeStyle = '#334155'; ctx.fillStyle = '#94a3b8'; ctx.font = '10px Inter';
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * graphHeight;
      const val = getYBounds.yMax - (i / 5) * (getYBounds.yMax - getYBounds.yMin); // ✅ getYBounds.yMin 유지
      ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + graphWidth, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(val.toFixed(2), padding.left - 8, y + 3);
    }

    // 2. 타겟 기준선 로직 (PH/DO/TU/Cl)
    const drawTargetLine = (val: number, label: string) => {
      const py = mapY(val);
      if (py >= padding.top && py <= padding.top + graphHeight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
        ctx.setLineDash([8, 4]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(padding.left, py); ctx.lineTo(padding.left + graphWidth, py); ctx.stroke();
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 11px Inter'; ctx.textAlign = 'left';
        ctx.fillText(label, padding.left + 5, py - 5); ctx.restore();
      }
    };
    if (sensorType === 'PH') {
      drawTargetLine(4.3, 'TARGET 4.3');
      drawTargetLine(9.7, 'TARGET 9.7');
    } else if (sensorType === 'DO') {
      drawTargetLine(1.0, 'TARGET 1.0');
    } else if (sensorType === 'TU' || sensorType === 'Cl') {
      const s1 = (aiAnalysisResult as any)?.s1;
      if (s1) {
        const targetVal = s1.value * 0.9;
        drawTargetLine(targetVal, `TARGET (S1 90%: ${targetVal.toFixed(3)})`);
      }
    }

    // 3. AI 분석 페이즈 배경 (ST-EN)
    if (aiAnalysisResult) {
      const st = (aiAnalysisResult as any)?.st;
      const en = (aiAnalysisResult as any)?.en;
      if (st?.timestamp && en?.timestamp) {
        const sx = mapX(new Date(st.timestamp).getTime());
        const ex = mapX(new Date(en.timestamp).getTime());
        const xStart = Math.max(Math.min(sx, ex), padding.left);
        const xEnd = Math.min(Math.max(sx, ex), width - padding.right);
        if (xEnd > xStart) {
          ctx.save();
          const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + graphHeight);
          grad.addColorStop(0, 'rgba(251, 191, 36, 0.25)'); grad.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
          ctx.fillStyle = grad; ctx.fillRect(xStart, padding.top, xEnd - xStart, graphHeight);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(xStart, padding.top); ctx.lineTo(xEnd, padding.top); ctx.stroke(); ctx.restore();
        }
      }
    }

    // 3.5 기존 수동 분석 결과 구간 표시
    analysisResults.forEach((res, idx) => {
      const sx = mapX(res.startTime.getTime());
      const ex = mapX(res.endTime.getTime());
      const xStart = Math.max(Math.min(sx, ex), padding.left);
      const xEnd = Math.min(Math.max(sx, ex), width - padding.right);
      if (xEnd > xStart) {
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'; 
        ctx.fillRect(xStart, padding.top, xEnd - xStart, graphHeight);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(xStart, padding.top, xEnd - xStart, graphHeight);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`구간 ${idx + 1}`, (xStart + xEnd) / 2, padding.top - 5);
        ctx.restore();
      }
    });

    // 4. 메인 데이터 라인 (단일 패스 연결)
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5; ctx.beginPath();
    getChannelData.forEach((d, i) => {
      const px = mapX(d.timestamp.getTime()); const py = mapY(d.value);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 5. 가이드라인 및 범위 지정 프리뷰
    if (!isCapturing && fixedGuidelineX >= padding.left && fixedGuidelineX <= width - padding.right) {
      ctx.save();
      
      // ✅ 최대/최소 범위 지정 중일 때의 프리뷰
      if (isMaxMinMode && selection?.start) {
        const sx = mapX(selection.start.timestamp.getTime());
        if (sx >= padding.left && sx <= width - padding.right) {
          const xStart = Math.min(sx, fixedGuidelineX);
          const xEnd = Math.max(sx, fixedGuidelineX);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
          ctx.fillRect(xStart, padding.top, xEnd - xStart, graphHeight);
          ctx.strokeStyle = '#f59e0b';
          ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.moveTo(sx, padding.top); ctx.lineTo(sx, padding.top + graphHeight); ctx.stroke();
          // 시작점 표시
          ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(sx, mapY(selection.start.value), 6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
      ctx.setLineDash([5, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(fixedGuidelineX, padding.top - 10); ctx.lineTo(fixedGuidelineX, padding.top + graphHeight); ctx.stroke();

      if (currentGuideData) {
        ctx.setLineDash([]);
        ctx.fillStyle = isOverReadout ? 'rgba(203, 213, 225, 1.0)' : 'rgba(226, 232, 240, 0.95)';
        ctx.font = 'bold 12px Inter';
        const displayTime = currentGuideData.timestamp.toLocaleTimeString();
        const txt = `${displayTime} | ${(currentGuideData as any).value.toFixed(3)}`;
        const tw = ctx.measureText(txt).width;
        const rectW = tw + 20; const rectH = 24;
        const rx = fixedGuidelineX - rectW / 2; const ry = padding.top - 35;

        ctx.beginPath();
        if ((ctx as any).roundRect) (ctx as any).roundRect(rx, ry, rectW, rectH, 4);
        else ctx.rect(rx, ry, rectW, rectH);
        ctx.fill();

        ctx.strokeStyle = isOverReadout ? '#38bdf8' : 'rgba(71, 85, 105, 0.3)';
        ctx.lineWidth = 1.5; ctx.stroke();

        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center'; ctx.fillText(txt, fixedGuidelineX, padding.top - 18);

        // 포인트 원
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(fixedGuidelineX, mapY((currentGuideData as any).value), 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
    }

    // 6. 마커 렌더링
    if (aiAnalysisResult) {
      Object.entries(aiAnalysisResult).forEach(([key, pt]) => {
        if (pt && typeof pt === 'object' && (pt as any).timestamp) {
          const px = mapX(new Date((pt as any).timestamp).getTime());
          const py = mapY((pt as any).value);
          const label = key.toUpperCase();
          if (px < padding.left || px > width - padding.right) return;
          ctx.save();
          ctx.fillStyle = (label === 'ST' ? '#fbbf24' : label === 'EN' ? '#ef4444' : '#38bdf8');

          if (draggedMarkerKey === key) {
            ctx.shadowBlur = 10; ctx.shadowColor = '#fff';
          }

          ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 9px Inter'; ctx.textAlign = 'center';
          ctx.fillText(label, px, py - 12); ctx.restore();
        }
      });
    }

    // ✅ 캡처 처리 유지
    if (isCapturing) {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${receiptNumber}_graph.png`;
      link.href = dataUrl;
      link.click();
      setIsCapturing(false);
    }

  }, [
    getChannelData, width, height, getYBounds, mapX, mapY, aiAnalysisResult, selection, analysisResults,
    fixedGuidelineX, currentGuideData, sensorType, isMaxMinMode, placingAiPointLabel,
    sequentialPlacementState.isActive, viewportMin, viewportMax, isOverReadout, draggedMarkerKey, receiptNumber, isCapturing, channelInfo.name
  ]);

  return (
    <div ref={graphRef} className="w-full h-full relative">
      <div className="absolute top-2 right-12 z-20 flex gap-2 no-capture">
         <button 
          onClick={() => setIsCapturing(true)} 
          className="p-2 text-slate-400 hover:text-white bg-slate-800/80 rounded-full transition-colors shadow-lg"
          title="그래프 캡처 (기준선 제외)"
        >
          <CameraIcon />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          cursor: draggedMarkerKey ? 'grabbing' : (isScrubbing ? 'ew-resize' : 'grab'),
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={(e) => { e.preventDefault(); onZoom(e.deltaY > 0 ? 0.9 : 1.1, viewportMin + (viewportMax - viewportMin) / 2); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      />
    </div>
  );
};

// --- Graph Wrapper ---
interface GraphProps {
  className?: string;
  data: DataPoint[];
  fullData: DataPoint[];
  channelIndex: number;
  channelInfo: ChannelInfo;
  viewEndTimestamp: number | null;
  timeRangeInMs: 'all' | number;
  fullTimeRange: { min: number; max: number };
  onFinePan: (direction: number) => void;
  onPanByAmount: (ms: number) => void;
  onZoom: (zoomFactor: number, centerTs: number) => void;
  showMajorTicks: boolean;
  yMinMaxOverall: { yMin: number; yMax: number } | null;
  isAnalyzing: boolean;
  isMaxMinMode: boolean;
  onPointSelect: (point: { timestamp: Date; value: number }) => void;
  selection: RangeSelection | null;
  analysisResults: AnalysisResult[];
  aiAnalysisResult: AiAnalysisResult | null;
  placingAiPointLabel: string | null;
  onManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
  setPlacingAiPointLabel: (label: string | null) => void;
  isRangeSelecting: boolean;
  rangeSelection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; } | null;
  onRangeSelectComplete: (selection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; }) => void;
  sequentialPlacementState: { isActive: boolean; currentIndex: number; };
  onSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
  sensorType: SensorType;
  SEQUENTIAL_POINT_ORDER: string[];
  receiptNumber: string;
  graphRef?: React.RefObject<HTMLDivElement>;
}

const Graph: React.FC<GraphProps> = (props) => {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} className={`w-full relative ${props.className || 'h-80 lg:h-96'}`}>
      <GraphCanvas {...props} width={width} height={height} />
    </div>
  );
};

// --- CsvDisplay Main Component ---
interface CsvDisplayProps {
  activeJob: CsvGraphJob;
  yMinMaxPerChannel: ({ yMin: number; yMax: number; } | null)[];
  viewMemo: { filteredData: DataPoint[]; currentWindowDisplay: string; };
  fullTimeRange: { min: number; max: number; } | null;
  isAtStart: boolean;
  isAtEnd: boolean;
  selectedChannel: ChannelInfo | null;
  selectedChannelIndex: number;
  updateActiveJob: (updater: (job: CsvGraphJob) => CsvGraphJob) => void;
  handleTimeRangeChange: (newTimeRange: "all" | number) => void;
  handleFinePan: (direction: number) => void;
  handlePan: (ms: number) => void;
  handleZoom: (zoomFactor: number, centerTs: number) => void;
  handleNavigate: (newEndTimestamp: number) => void;
  toggleAnalysisMode: (channelId: string) => void;
  toggleMaxMinMode: () => void;
  handleUndoLastResult: (channelId: string) => void;
  handleDeleteManualResult: (channelId: string, resultId: string) => void;
  handleResetAnalysis: () => void;
  handleCancelSelection: (channelId: string) => void;
  handlePointSelect: (channelId: string, point: { timestamp: Date; value: number; }) => void;
  handlePhaseTimeChange: (index: number, field: 'startTime' | 'endTime', newTime: Date) => void;
  placingAiPointLabel: string | null;
  setPlacingAiPointLabel: (label: string | null) => void;
  handleManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
  handleAutoMinMaxResultChange: () => void;
  handleManualAnalysisResultChange: () => void;
  isPhaseAnalysisModified: boolean;
  handleReapplyAnalysis: () => Promise<void>;
  isFullScreenGraph: boolean;
  setIsFullScreenGraph: (isFull: boolean) => void;
  sequentialPlacementState: { isActive: boolean; currentIndex: number; };
  handleToggleSequentialPlacement: () => void;
  handleUndoSequentialPlacement: () => void;
  handleSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
  sensorType: SensorType;
  SEQUENTIAL_POINT_ORDER: string[];
  onSendToKtl?: (graphBlob: Blob, tableBlob: Blob, results: any[]) => Promise<void>;
}

export const CsvDisplay: React.FC<CsvDisplayProps> = (props) => {
  const {
    activeJob, yMinMaxPerChannel, viewMemo, fullTimeRange,
    selectedChannel, selectedChannelIndex,
    updateActiveJob, handleTimeRangeChange, handleFinePan, handlePan, handleZoom, handleNavigate,
    toggleAnalysisMode, toggleMaxMinMode, handleDeleteManualResult, handleResetAnalysis, handlePointSelect,
    placingAiPointLabel, setPlacingAiPointLabel, handleManualAiPointPlacement,
    isFullScreenGraph, setIsFullScreenGraph,
    sequentialPlacementState, handleToggleSequentialPlacement, handleUndoSequentialPlacement,
    handleSequentialPointPlacement, SEQUENTIAL_POINT_ORDER, onSendToKtl
  } = props;

  const [unifiedResults, setUnifiedResults] = useState<any[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const results: any[] = [];
    if (activeJob.aiAnalysisResult) {
      const st = (activeJob.aiAnalysisResult as any)?.st;
      const en = (activeJob.aiAnalysisResult as any)?.en;
      if (st && en) {
        // ✅ 10초 단위 정수 무결성을 위해 Math.round 적용
        const diffSec = Math.round((new Date(en.timestamp).getTime() - new Date(st.timestamp).getTime()) / 1000);
        results.push({ id: `pt-response-time`, type: '응답', name: 'ST → EN', startTime: new Date(st.timestamp), endTime: new Date(en.timestamp), diff: diffSec });
      }

      Object.entries(activeJob.aiAnalysisResult).forEach(([key, point]) => {
        if (key === 'isReagent') return;
        if (point && typeof point === 'object' && (point as any).timestamp) {
          results.push({ id: `pt-${key}`, type: '지정 포인트', name: key.toUpperCase(), startTime: new Date((point as any).timestamp), value: (point as any).value });
        }
      });
    }
    if (selectedChannel) {
      (activeJob.channelAnalysis[selectedChannel.id]?.results || []).forEach((res, idx) => {
        results.push({ id: res.id, type: '수동 분석', channelId: selectedChannel.id, name: `구간 ${idx + 1}`, startTime: res.startTime, endTime: res.endTime, max: res.max, min: res.min, diff: res.diff });
      });
    }
    setUnifiedResults(results.sort((a, b) => {
      if (a.type === '응답') return -1;
      if (b.type === '응답') return 1;
      return a.startTime.getTime() - b.startTime.getTime();
    }));
  }, [activeJob.channelAnalysis, activeJob.aiAnalysisResult, selectedChannel]);

  const handleTableCapture = async () => {
    if (!tableRef.current) return;
    try {
      const canvas = await html2canvas(tableRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el.classList.contains('no-capture')
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${activeJob.receiptNumber}_table.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Table capture failed:', err);
    }
  };

  const handleKtlTransfer = async () => {
    if (!onSendToKtl || !tableRef.current || !graphRef.current) return;
    
    try {
      updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: '그래프/테이블 캡처 중...' }));
      
      const graphCanvas = await html2canvas(graphRef.current, {
        backgroundColor: '#0f172a',
        scale: 1.5,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el.classList.contains('no-capture')
      });
      
      const tableCanvas = await html2canvas(tableRef.current, {
        backgroundColor: '#0f172a',
        scale: 1.5,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el.classList.contains('no-capture')
      });

      const graphBlob = await new Promise<Blob>((resolve) => graphCanvas.toBlob(b => resolve(b!), 'image/png'));
      const tableBlob = await new Promise<Blob>((resolve) => tableCanvas.toBlob(b => resolve(b!), 'image/png'));

      await onSendToKtl(graphBlob, tableBlob, unifiedResults);
      
    } catch (err: any) {
      console.error('KTL transfer capture failed:', err);
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `캡처 실패: ${err.message}` }));
    }
  };

  const getSensorPoints = (type: SensorType) => {
    const isReagent = !!(activeJob.aiAnalysisResult as any)?.isReagent;
    switch (type) {
      case 'SS': return ['M1', 'M2', 'M3', 'Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'Z6', 'S6', 'Z7', 'S7', '현장1', '현장2'];
      case 'PH': return ['(A)_4_1', '(A)_4_2', '(A)_4_3', '(A)_7_1', '(A)_7_2', '(A)_7_3', '(A)_10_1', '(A)_10_2', '(A)_10_3', '(B)_7_1', '(B)_4_1', '(B)_7_2', '(B)_4_2', '(B)_7_3', '(B)_4_3', '(C)_4_1', '(C)_4_2', '(C)_4_3', '(C)_7_1', '(C)_7_2', '(C)_7_3', '(C)_4_4', '(C)_4_5', '(C)_4_6', '(C)_7_4', '(C)_7_5', '(C)_7_6', '4_10', '4_15', '4_20', '4_25', '4_30', 'ST', 'EN', '현장1', '현장2'];
      case 'DO': return ['(A)_S1', '(A)_S2', '(A)_S3', 'S_1', 'S_2', 'S_3', 'Z_1', 'Z_2', 'Z_3', 'Z_4', 'Z_5', 'Z_6', 'S_4', 'S_5', 'S_6', '20_S_1', '20_S_2', '20_S_3', '30_S_1', '30_S_2', '30_S_3', 'ST', 'EN'];
      case 'Cl': {
        const baseCl = ['Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S1', 'S2', 'S3', 'S4', 'Z5', 'S5', 'M1'];
        return isReagent ? baseCl : [...baseCl, 'ST', 'EN'];
      }
      case 'TU':
        return ['Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'M1', 'ST', 'EN'];
      default:
        return ['Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'M1', 'ST', 'EN'];
    }
  };

  const isManualActive = !!(selectedChannel && activeJob.channelAnalysis[selectedChannel.id]?.isAnalyzing);

  const commonGraphProps = {
    data: viewMemo.filteredData,
    fullData: activeJob.parsedData!.data,
    channelIndex: selectedChannelIndex,
    channelInfo: selectedChannel!,
    viewEndTimestamp: activeJob.viewEndTimestamp,
    timeRangeInMs: activeJob.timeRangeInMs,
    fullTimeRange: fullTimeRange!,
    onFinePan: handleFinePan,
    onPanByAmount: handlePan,
    onZoom: handleZoom,
    showMajorTicks: true,
    yMinMaxOverall: yMinMaxPerChannel[selectedChannelIndex],
    isAnalyzing: isManualActive,
    isMaxMinMode: activeJob.isMaxMinMode || false,
    onPointSelect: (pt: { timestamp: Date; value: number }) => selectedChannel && handlePointSelect(selectedChannel.id, pt),
    selection: selectedChannel ? activeJob.channelAnalysis[selectedChannel.id]?.selection || null : null,
    analysisResults: selectedChannel ? activeJob.channelAnalysis[selectedChannel.id]?.results || [] : [],
    aiAnalysisResult: activeJob.aiAnalysisResult || null,
    placingAiPointLabel: placingAiPointLabel,
    onManualAiPointPlacement: handleManualAiPointPlacement,
    setPlacingAiPointLabel: setPlacingAiPointLabel,
    isRangeSelecting: activeJob.isRangeSelecting || false,
    rangeSelection: activeJob.rangeSelection || null,
    onRangeSelectComplete: (sel: any) => updateActiveJob(j => ({ ...j, rangeSelection: sel })),
    sequentialPlacementState: sequentialPlacementState,
    onSequentialPointPlacement: handleSequentialPointPlacement,
    sensorType: activeJob.sensorType,
    SEQUENTIAL_POINT_ORDER,
    receiptNumber: activeJob.receiptNumber,
    graphRef
  };

  const handleToggleReagent = () => {
    updateActiveJob(job => {
      const currentIsReagent = !!(job.aiAnalysisResult as any)?.isReagent;
      const newIsReagent = !currentIsReagent;
      const newAiResult = { ...(job.aiAnalysisResult || {}), isReagent: newIsReagent };
      if (newIsReagent) {
        delete (newAiResult as any).st;
        delete (newAiResult as any).en;
      }
      return { ...job, aiAnalysisResult: newAiResult };
    });
  };

  if (isFullScreenGraph) return (
    <div className="fixed inset-0 z-50 bg-slate-800 p-4 flex flex-col gap-4">
      <div className="flex-1 min-w-0 space-y-6 flex flex-col relative h-full">
        <button onClick={() => setIsFullScreenGraph(false)} className="absolute top-0 right-0 z-20 p-2 text-slate-400 hover:text-white">
          <ExitFullScreenIcon />
        </button>
        {selectedChannel && selectedChannelIndex !== -1 && <Graph {...commonGraphProps} className='flex-grow min-h-0' />}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-4 lg:w-1/3">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-100">분석 제어</h3>
            
            {/* TU/Cl 일 때 상세 현장 입력 UI 추가 */}
            {(activeJob.sensorType === 'TU' || activeJob.sensorType === 'Cl') && (
              <div className="pb-2 border-b border-slate-700">
                <label htmlFor="csv-job-details" className="block text-xs font-medium text-slate-300 mb-1">
                  현장_상세 (편집 가능)
                </label>
                <input
                  id="csv-job-details"
                  value={activeJob.details || ''}
                  onChange={(e) => updateActiveJob(j => ({ ...j, details: e.target.value }))}
                  className="block w-full p-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:ring-sky-500 focus:border-sky-500"
                  placeholder="현장_상세 (예: 강남배수지)"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => selectedChannel && toggleAnalysisMode(selectedChannel.id)}
                disabled={!selectedChannel}
                className={`py-3 rounded-md text-white text-sm transition-colors ${isManualActive ? 'bg-sky-600 ring-2' : 'bg-slate-700 hover:bg-slate-600'}`}
              >
                1. 수동 분석
              </button>
              <button onClick={handleResetAnalysis} className="py-3 bg-red-600 hover:bg-red-700 rounded-md text-white text-sm transition-colors">
                2. 초기화
              </button>
            </div>
            <button
              onClick={toggleMaxMinMode}
              className={`w-full py-2.5 rounded-md text-white text-sm transition-colors ${activeJob.isMaxMinMode ? 'bg-amber-600 ring-2' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              최대/최소 (범위 지정)
            </button>

            {isManualActive && (
              <div className="pt-2 border-t border-slate-700 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {['SS', 'PH', 'TU', 'Cl', 'DO'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => updateActiveJob(j => ({ ...j, sensorType: opt as SensorType }))}
                      className={`px-2 py-1 rounded text-[10px] transition-colors ${activeJob.sensorType === opt ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {activeJob.sensorType === 'Cl' && (
                  <button
                    onClick={handleToggleReagent}
                    className={`w-full py-2 rounded text-xs font-bold transition-all border-2 ${!!(activeJob.aiAnalysisResult as any)?.isReagent
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-900/50'
                      : 'bg-slate-800 border-slate-600 text-slate-400'
                      }`}
                  >
                    {!!(activeJob.aiAnalysisResult as any)?.isReagent ? '✓ 시약식 모드 활성 (ST/EN 제외)' : '시약식 여부 (클릭 시 ST/EN 삭제)'}
                  </button>
                )}

                <h4 className="text-sm font-semibold text-slate-200">포인트 지정 ({activeJob.sensorType})</h4>
                
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => {
                      if (!selectedChannel) return;
                      updateActiveJob(job => ({
                        ...job,
                        aiAnalysisResult: null,
                        channelAnalysis: {
                          ...job.channelAnalysis,
                          [selectedChannel.id]: {
                            ...job.channelAnalysis[selectedChannel.id],
                            results: []
                          }
                        }
                      }));
                    }}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-700 rounded-md text-white text-xs font-bold transition-colors shadow-sm"
                  >
                    수동 분석 리셋 (포인트/구간)
                  </button>
                </div>

                <div className="flex gap-2">
                  <ActionButton
                    onClick={handleToggleSequentialPlacement}
                    fullWidth
                    variant={sequentialPlacementState.isActive ? 'danger' : 'primary'}
                    className="!text-[10px] py-1"
                  >
                    {sequentialPlacementState.isActive ? '중단' : '순차 지정 시작'}
                  </ActionButton>
                  {sequentialPlacementState.isActive && (
                    <ActionButton
                      onClick={handleUndoSequentialPlacement}
                      fullWidth
                      variant="secondary"
                      className="!text-[10px] py-1"
                    >
                      이전 되돌리기
                    </ActionButton>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1.5 max-h-[320px] overflow-y-auto pr-1">
                  {getSensorPoints(activeJob.sensorType).map((p) => (
                    <button
                      key={p}
                      id={`point-btn-${p}`}
                      onClick={() => setPlacingAiPointLabel(p)}
                      className={`text-[10px] font-bold rounded px-1 py-2 transition-colors truncate ${placingAiPointLabel === p
                        ? 'bg-sky-500 text-white ring-2 ring-sky-300'
                        : !!(activeJob.aiAnalysisResult as any)?.[p.toLowerCase()]
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      title={p}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:w-2/3 flex flex-col">
          {fullTimeRange && selectedChannelIndex !== -1 && (
            <MiniMap
              fullData={activeJob.parsedData!.data}
              channelIndex={selectedChannelIndex}
              viewEndTimestamp={activeJob.viewEndTimestamp}
              timeRangeInMs={activeJob.timeRangeInMs}
              fullTimeRange={fullTimeRange}
              onNavigate={handleNavigate}
              onRangeChange={(newRangeMs, newEndTs) => updateActiveJob(j => ({ ...j, timeRangeInMs: newRangeMs, viewEndTimestamp: newEndTs }))}
            />
          )}

          <div className="flex justify-between items-center bg-slate-900/50 p-4 rounded-lg border border-slate-700">
            <div className="flex flex-wrap gap-2">
              {activeJob.parsedData!.channels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => updateActiveJob(j => ({ ...j, selectedChannelId: ch.id }))}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeJob.selectedChannelId === ch.id ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  {ch.name}
                </button>
              ))}
            </div>
            <div className="flex items-center bg-slate-700/50 p-1 rounded-lg">
              {[10, 30, 60, 180, 'all'].map(m => (
                <button
                  key={String(m)}
                  onClick={() => handleTimeRangeChange(m === 'all' ? 'all' : Number(m) * 60 * 1000)}
                  className={`px-2 py-1 rounded text-[10px] ${activeJob.timeRangeInMs === (m === 'all' ? 'all' : Number(m) * 60 * 1000) ? 'bg-sky-500' : ''}`}
                >
                  {m === 'all' ? '전체' : `${m}분`}
                </button>
              ))}
            </div>
          </div>

          <div className="relative bg-slate-900 rounded-xl overflow-hidden border border-slate-700 h-[400px]">
            <button onClick={() => setIsFullScreenGraph(true)} className="absolute top-2 right-2 z-20 p-2 text-slate-400 hover:text-white bg-slate-800/80 rounded-full no-capture">
              <EnterFullScreenIcon />
            </button>
            <div className="w-full h-full">
              {selectedChannel && selectedChannelIndex !== -1 && <Graph {...commonGraphProps} className="h-full" />}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 mb-2 flex justify-between items-center px-1">
        <h3 className="text-lg font-semibold text-slate-100">분석 결과 테이블</h3>
        <div className="flex gap-2">
          <button 
            onClick={handleTableCapture}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/80 rounded-full transition-colors shadow-lg"
            title="테이블 캡처"
          >
            <CameraIcon />
          </button>
          {onSendToKtl && (
            <button 
              onClick={handleKtlTransfer}
              disabled={activeJob.submissionStatus === 'sending'}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 text-white text-xs font-bold rounded-full transition-all flex items-center gap-2 shadow-lg"
              title="KTL API로 분석 결과 및 사진 전송"
            >
              {activeJob.submissionStatus === 'sending' ? <Spinner size="sm" /> : <SendIcon />}
              <span>KTL 전송</span>
            </button>
          )}
        </div>
      </div>

      <div ref={tableRef} className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden relative">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-700/50 text-slate-400 uppercase">
            <tr>
              <th className="px-3 py-2 text-left w-16">유형</th>
              <th className="px-3 py-2 text-left">항목</th>
              <th className="px-3 py-2 text-left">시간/구간</th>
              <th className="px-3 py-2 text-left w-24">날짜</th>
              <th className="px-3 py-2 text-right w-24">값</th>
              <th className="px-3 py-2 text-right w-24">최대</th>
              <th className="px-3 py-2 text-right w-24">최소</th>
              <th className="px-3 py-2 text-center w-12 no-capture" data-html2canvas-ignore>관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {unifiedResults.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-slate-500 italic">표시할 분석 결과가 없습니다.</td>
              </tr>
            ) : unifiedResults.map(item => (
              <tr key={item.id} className={`hover:bg-slate-700/30 text-slate-300 ${item.type === '응답' ? 'bg-amber-900/20' : ''}`}>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${item.type === '응답'
                    ? 'bg-amber-500/20 text-amber-400'
                    : item.type === '지정 포인트'
                      ? 'bg-sky-500/20 text-sky-400'
                      : 'bg-slate-500/20 text-slate-400'
                    }`}>
                    {item.type}
                  </span>
                </td>
                <td className={`px-3 py-2 font-bold ${item.type === '응답' ? 'text-amber-400' : 'text-sky-400'}`}>{item.name}</td>
                <td className="px-3 py-2">
                  {item.endTime ? `${item.startTime.toLocaleTimeString()} ~ ${item.endTime.toLocaleTimeString()}` : item.startTime.toLocaleTimeString()}
                </td>
                <td className="px-3 py-2">{item.startTime.toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {item.type === '응답' ? (
                    <span className="font-bold text-amber-400">{item.diff}s</span>
                  ) : item.type === '수동 분석' ? (
                    <span className="text-amber-400">{item.diff?.toFixed(3)}</span>
                  ) : (
                    item.value?.toFixed(3) || '-'
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-400 font-mono">{item.max?.toFixed(3) || '-'}</td>
                <td className="px-3 py-2 text-right text-slate-400 font-mono">{item.min?.toFixed(3) || '-'}</td>
                <td className="px-3 py-2 text-center no-capture" data-html2canvas-ignore>
                  {item.type === '수동 분석' && (
                    <button
                      onClick={() => handleDeleteManualResult(item.channelId, item.id)}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                      title="삭제"
                    >
                      <TrashIcon />
                    </button>
                  )}
                  {item.type === '지정 포인트' && (
                    <span className="text-[10px] text-slate-500">M</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {activeJob.submissionStatus !== 'idle' && activeJob.submissionMessage && (
          <div className="p-2 bg-slate-900/90 text-center border-t border-slate-700 no-capture">
             <span className={`text-sm ${activeJob.submissionStatus === 'success' ? 'text-green-400' : activeJob.submissionStatus === 'error' ? 'text-red-400' : 'text-sky-400'}`}>
                {activeJob.submissionStatus === 'success' ? '✅' : activeJob.submissionStatus === 'error' ? '❌' : '⏳'} {activeJob.submissionMessage}
             </span>
          </div>
        )}
      </div>
    </div>
  );
};
