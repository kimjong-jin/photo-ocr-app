
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';
import type {
  CsvGraphJob,
  AnalysisResult as JobAnalysisResult,
  SensorType,
} from '../../types/csvGraph';

// ===== 타입 =====
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

// ===== 아이콘 =====
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

// ===== ResizeObserver =====
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
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);

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
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={ref} className="h-16 bg-slate-900/80 rounded-md border border-slate-700 overflow-hidden mb-2 touch-none">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', cursor: isDragging !== 'none' ? 'grabbing' : 'crosshair' }} 
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
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
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({ 
    data, fullData, channelIndex, channelInfo, width, height, viewEndTimestamp, timeRangeInMs, fullTimeRange,
    onFinePan, onPanByAmount, onZoom, showMajorTicks, yMinMaxOverall,
    isAnalyzing, isMaxMinMode, onPointSelect, selection, analysisResults,
    placingAiPointLabel, onManualAiPointPlacement,
    setPlacingAiPointLabel, isRangeSelecting, rangeSelection, onRangeSelectComplete,
    sequentialPlacementState, onSequentialPointPlacement, sensorType, SEQUENTIAL_POINT_ORDER
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padding = { top: 40, right: 60, bottom: 40, left: 60 };

  // ✅ [중요] 화면 고정 가이드라인의 X 좌표 (픽셀 단위)
  const [fixedGuidelineX, setFixedGuidelineX] = useState<number>(0);
  const [currentGuideData, setCurrentGuideData] = useState<{ timestamp: Date; value: number } | null>(null);
  
  // ✅ 마우스가 상단 데이터 리드아웃 박스 위에 있는지 여부
  const [isOverReadout, setIsOverReadout] = useState<boolean>(false);
  
  const touchState = useRef({ isPanning: false, lastX: 0, initialDistance: 0, isZooming: false, hasMoved: false });

  // 초기 기준선 위치를 화면 중앙으로 설정
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
      .map(d => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
      .filter(d => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
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

  // ✅ 현재 고정 기준선(X)이 가리키는 시간과 값 계산
  const updateGuideData = useCallback(() => {
      if (width === 0 || getChannelData.length === 0) return;
      const graphWidth = width - padding.left - padding.right;
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

  const handlePointerDown = (e: React.PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      touchState.current.hasMoved = false;
      touchState.current.lastX = e.clientX;
      touchState.current.isPanning = true;
      (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // ✅ 데이터 리드아웃 박스(말풍선) 영역 감지
    if (currentGuideData) {
        const tw = 180; // 근사치 (텍스트 길이에 따라 다름)
        const rx = fixedGuidelineX - (tw + 20) / 2;
        const ry = padding.top - 35;
        const isOver = x >= rx && x <= rx + tw + 20 && y >= ry && y <= ry + 24;
        setIsOverReadout(isOver);
    }

    if (touchState.current.isPanning) {
        const dx = e.clientX - touchState.current.lastX;
        if (Math.abs(dx) > 3) touchState.current.hasMoved = true;
        const graphWidth = width - padding.left - padding.right;
        const timeDelta = -(dx / graphWidth) * (viewportMax - viewportMin);
        onPanByAmount(timeDelta);
        touchState.current.lastX = e.clientX;
        return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      touchState.current.isPanning = false;
      (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (touchState.current.hasMoved) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // ✅ 1. 상단 데이터 박스(리드아웃)를 클릭했다면 해당 데이터로 포인트 확정
    if (isOverReadout && currentGuideData) {
        confirmPoint(currentGuideData);
        return;
    }

    // ✅ 2. 일반 그래프 영역 클릭 처리
    if (x >= padding.left && x <= width - padding.right) {
        // 기준선 이동을 위한 클릭 위치의 데이터 찾기
        const graphWidth = width - padding.left - padding.right;
        const timeAtLine = viewportMin + ((x - padding.left) / graphWidth) * (viewportMax - viewportMin);
        let minDistance = Infinity;
        let closest = getChannelData[0];
        getChannelData.forEach(d => {
            const dist = Math.abs(d.timestamp.getTime() - timeAtLine);
            if (dist < minDistance) { minDistance = dist; closest = d; }
        });

        // 일단 기준선은 어디를 클릭하든 이동시킴
        setFixedGuidelineX(x);

        // ✅ 3. 빈 공간 클릭 방지 로직: 데이터 곡선(파란색 선) 근처를 클릭했는지 확인
        const currentLabel = placingAiPointLabel || (sequentialPlacementState.isActive ? SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex] : null);
        if (currentLabel || isMaxMinMode) {
            const py = mapY(closest.value);
            const distY = Math.abs(y - py);
            
            // Y축 기준으로 데이터 선과 클릭 지점이 30px 이내로 가까울 때만 '그래프 클릭'으로 간주하여 데이터 취함
            if (distY < 30) {
                confirmPoint(closest);
            }
        }
    }
  };

  const confirmPoint = (point: { timestamp: Date; value: number }) => {
    if (sequentialPlacementState.isActive) onSequentialPointPlacement(point);
    else if (placingAiPointLabel) onManualAiPointPlacement(placingAiPointLabel, point);
    else if (isMaxMinMode) onPointSelect(point);
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
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);

    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    // 1. 그리드 및 Y축 라벨
    ctx.strokeStyle = '#334155'; ctx.fillStyle = '#94a3b8'; ctx.font = '10px Inter';
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * graphHeight;
      const val = getYBounds.yMax - (i / 5) * (getYBounds.yMax - getYBounds.yMin);
      ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + graphWidth, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(val.toFixed(2), padding.left - 8, y + 3);
    }

    // 2. PH / DO 타겟 기준선
    const drawTargetLine = (val: number) => {
        const py = mapY(val);
        if (py >= padding.top && py <= padding.top + graphHeight) {
            ctx.save(); 
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)'; 
            ctx.setLineDash([8, 4]); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(padding.left, py); ctx.lineTo(padding.left + graphWidth, py); ctx.stroke();
            ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 11px Inter'; ctx.textAlign = 'left';
            ctx.fillText(`TARGET ${val.toFixed(1)}`, padding.left + 5, py - 5); ctx.restore();
        }
    };
    if (sensorType === 'PH') [4.3, 9.7].forEach(drawTargetLine);
    else if (sensorType === 'DO') drawTargetLine(1.0);

    // 3. 메인 데이터 라인
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5; ctx.beginPath();
    getChannelData.forEach((d, i) => {
      const px = mapX(d.timestamp.getTime()); const py = mapY(d.value);
      if (px < padding.left - 10 || px > width - padding.right + 10) {
          if (i > 0) ctx.moveTo(px, py);
          return;
      }
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // 4. ✅ [핵심] 고정 가이드라인 (찐한 회색 스타일)
    if (fixedGuidelineX >= padding.left && fixedGuidelineX <= width - padding.right) {
        ctx.save();
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.9)'; // Slate-600 기반
        ctx.setLineDash([5, 3]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fixedGuidelineX, padding.top - 10); ctx.lineTo(fixedGuidelineX, padding.top + graphHeight); ctx.stroke();
        
        if (currentGuideData) {
            ctx.setLineDash([]);
            // 말풍선 배경 (연한 회색)
            ctx.fillStyle = isOverReadout ? 'rgba(203, 213, 225, 1.0)' : 'rgba(226, 232, 240, 0.95)';
            ctx.font = 'bold 12px Inter';
            const txt = `${currentGuideData.timestamp.toLocaleTimeString()} | ${currentGuideData.value.toFixed(3)}`;
            const tw = ctx.measureText(txt).width;
            ctx.beginPath();
            const rectW = tw + 20; const rectH = 24;
            const rx = fixedGuidelineX - rectW / 2; const ry = padding.top - 35;
            ctx.roundRect(rx, ry, rectW, rectH, 4); ctx.fill();
            
            // 강조 테두리 (클릭 가능함 표시)
            ctx.strokeStyle = isOverReadout ? '#38bdf8' : 'rgba(71, 85, 105, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // 텍스트 (찐한 회색)
            ctx.fillStyle = '#1e293b'; // Slate-900 (찐한 회색)
            ctx.textAlign = 'center'; ctx.fillText(txt, fixedGuidelineX, padding.top - 18);

            // 데이터 곡선과의 접점 (회색 포인트)
            ctx.fillStyle = '#475569'; // Slate-600
            ctx.beginPath(); ctx.arc(fixedGuidelineX, mapY(currentGuideData.value), 5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.restore();
    }
  }, [getChannelData, width, height, getYBounds, mapX, mapY, fixedGuidelineX, currentGuideData, sensorType, isMaxMinMode, placingAiPointLabel, sequentialPlacementState.isActive, viewportMin, viewportMax, isOverReadout]);

  return (
    <canvas ref={canvasRef} 
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: isOverReadout ? 'pointer' : 'crosshair' }} 
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
      onWheel={(e) => { e.preventDefault(); onZoom(e.deltaY > 0 ? 0.9 : 1.1, viewportMin + (viewportMax - viewportMin) / 2); }}
      onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    />
  );
};

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
}

const Graph: React.FC<GraphProps> = (props) => {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} className={`w-full relative ${props.className || 'h-80 lg:h-96'}`}>
      <GraphCanvas {...props} width={width} height={height} />
    </div>
  );
};

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
    handleSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
    sensorType: SensorType;
    SEQUENTIAL_POINT_ORDER: string[];
}

export const CsvDisplay: React.FC<CsvDisplayProps> = (props) => {
    const {
        activeJob, yMinMaxPerChannel, viewMemo, fullTimeRange,
        selectedChannel, selectedChannelIndex,
        updateActiveJob, handleTimeRangeChange, handleFinePan, handlePan, handleZoom, handleNavigate, 
        toggleAnalysisMode, toggleMaxMinMode, handleDeleteManualResult, handleResetAnalysis, handlePointSelect,
        placingAiPointLabel, setPlacingAiPointLabel, handleManualAiPointPlacement,
        isFullScreenGraph, setIsFullScreenGraph,
        sequentialPlacementState, handleToggleSequentialPlacement,
        handleSequentialPointPlacement, SEQUENTIAL_POINT_ORDER
    } = props;

    const [unifiedResults, setUnifiedResults] = useState<any[]>([]);

    useEffect(() => {
        const results: any[] = [];
        if (selectedChannel) {
            (activeJob.channelAnalysis[selectedChannel.id]?.results || []).forEach((res, idx) => {
                 results.push({ id: res.id, type: '수동 분석', channelId: selectedChannel.id, name: `구간 ${idx + 1}`, startTime: res.startTime, endTime: res.endTime, max: res.max, min: res.min, diff: res.diff });
            });
        }
        setUnifiedResults(results.sort((a,b) => a.startTime.getTime() - b.startTime.getTime()));
    }, [activeJob.channelAnalysis, selectedChannel]);

    const getSensorPoints = (type: SensorType) => {
        switch (type) {
            case 'SS': return ['M1', 'M2', 'M3', 'Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'Z6', 'S6', 'Z7', 'S7', '현장1', '현장2'];
            case 'PH': return ['(A)_4_1', '(A)_4_2', '(A)_4_3', '(A)_7_1', '(A)_7_2', '(A)_7_3', '(A)_10_1', '(A)_10_2', '(A)_10_3', '(B)_7_1', '(B)_4_1', '(B)_7_2', '(B)_4_2', '(B)_7_3', '(B)_4_3', '(C)_4_1', '(C)_4_2', '(C)_4_3', '(C)_7_1', '(C)_7_2', '(C)_7_3', '(C)_4_4', '(C)_4_5', '(C)_4_6', '(C)_7_4', '(C)_7_5', '(C)_7_6', '4_10', '4_15', '4_20', '4_25', '4_30', 'ST', 'EN', '현장1', '현장2'];
            case 'DO': return ['(A)_S1', '(A)_S2', '(A)_S3', 'S_1', 'S_2', 'S_3', 'Z_1', 'Z_2', 'Z_3', 'Z_4', 'Z_5', 'Z_6', 'S_4', 'S_5', 'S_6', '20_S_1', '20_S_2', '20_S_3', '30_S_1', '30_S_2', '30_S_3', 'ST', 'EN'];
            default: return ['Z1', 'Z2', 'S1', 'S2', 'Z3', 'Z4', 'S3', 'S4', 'Z5', 'S5', 'M1', 'ST', 'EN'];
        }
    };

    const isManualActive = !!(selectedChannel && activeJob.channelAnalysis[selectedChannel.id]?.isAnalyzing);
    const commonGraphProps = {
        data: viewMemo.filteredData, fullData: activeJob.parsedData!.data, channelIndex: selectedChannelIndex, channelInfo: selectedChannel!,
        viewEndTimestamp: activeJob.viewEndTimestamp, timeRangeInMs: activeJob.timeRangeInMs, fullTimeRange: fullTimeRange!,
        onFinePan: handleFinePan, onPanByAmount: handlePan, onZoom: handleZoom, showMajorTicks: true,
        yMinMaxOverall: yMinMaxPerChannel[selectedChannelIndex], isAnalyzing: isManualActive, isMaxMinMode: activeJob.isMaxMinMode || false,
        onPointSelect: (pt: { timestamp: Date; value: number }) => selectedChannel && handlePointSelect(selectedChannel.id, pt),
        selection: selectedChannel ? activeJob.channelAnalysis[selectedChannel.id]?.selection || null : null,
        analysisResults: selectedChannel ? activeJob.channelAnalysis[selectedChannel.id]?.results || [] : [],
        placingAiPointLabel: placingAiPointLabel, onManualAiPointPlacement: handleManualAiPointPlacement,
        setPlacingAiPointLabel: setPlacingAiPointLabel, isRangeSelecting: activeJob.isRangeSelecting || false,
        rangeSelection: activeJob.rangeSelection || null, onRangeSelectComplete: (sel: any) => updateActiveJob(j => ({ ...j, rangeSelection: sel })),
        sequentialPlacementState: sequentialPlacementState, onSequentialPointPlacement: handleSequentialPointPlacement, sensorType: activeJob.sensorType,
        SEQUENTIAL_POINT_ORDER
    };

    if (isFullScreenGraph) return (
        <div className="fixed inset-0 z-50 bg-slate-800 p-4 flex flex-col gap-4">
             <div className="flex-1 min-w-0 space-y-6 flex flex-col relative h-full">
                <button onClick={() => setIsFullScreenGraph(false)} className="absolute top-0 right-0 z-20 p-2 text-slate-400 hover:text-white"><ExitFullScreenIcon /></button>
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
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => selectedChannel && toggleAnalysisMode(selectedChannel.id)} disabled={!selectedChannel} className={`py-3 rounded-md text-white text-sm transition-colors ${isManualActive ? 'bg-sky-600 ring-2' : 'bg-slate-700 hover:bg-slate-600'}`}>1. 수동 분석</button>
                            <button onClick={handleResetAnalysis} className="py-3 bg-red-600 hover:bg-red-700 rounded-md text-white text-sm transition-colors">2. 초기화</button>
                        </div>
                        <button onClick={toggleMaxMinMode} className={`w-full py-2.5 rounded-md text-white text-sm transition-colors ${activeJob.isMaxMinMode ? 'bg-amber-600 ring-2' : 'bg-slate-700 hover:bg-slate-600'}`}>최대/최소 (범위 지정)</button>
                        {isManualActive && (
                            <div className="pt-2 border-t border-slate-700 space-y-3">
                                <div className="flex flex-wrap gap-1.5">
                                    {['SS', 'PH', 'TU', 'Cl', 'DO'].map(opt => (
                                        <button key={opt} onClick={() => updateActiveJob(j => ({ ...j, sensorType: opt as SensorType }))} className={`px-2 py-1 rounded text-[10px] transition-colors ${activeJob.sensorType === opt ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300'}`}>{opt}</button>
                                    ))}
                                </div>
                                <h4 className="text-sm font-semibold text-slate-200">포인트 지정 ({activeJob.sensorType})</h4>
                                <div className="flex gap-2">
                                    <ActionButton onClick={handleToggleSequentialPlacement} fullWidth variant={sequentialPlacementState.isActive ? 'danger' : 'primary'} className="!text-[10px] py-1">{sequentialPlacementState.isActive ? '중단' : '순차 지정 시작'}</ActionButton>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5 max-h-[320px] overflow-y-auto pr-1">
                                    {getSensorPoints(activeJob.sensorType).map((p) => (
                                        <button 
                                            key={p} 
                                            id={`point-btn-${p}`} 
                                            onClick={() => setPlacingAiPointLabel(p)} 
                                            className={`text-[10px] font-bold rounded px-1 py-2 transition-colors truncate ${placingAiPointLabel === p ? 'bg-sky-500 text-white ring-2 ring-sky-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
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
                        <div className="flex flex-wrap gap-2">{activeJob.parsedData!.channels.map(ch => (
                            <button key={ch.id} onClick={() => updateActiveJob(j => ({...j, selectedChannelId: ch.id}))} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeJob.selectedChannelId === ch.id ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300'}`}>{ch.name}</button>
                        ))}</div>
                        <div className="flex items-center bg-slate-700/50 p-1 rounded-lg">{[10, 30, 60, 180, 'all'].map(m => (
                            <button key={String(m)} onClick={() => handleTimeRangeChange(m === 'all' ? 'all' : Number(m) * 60 * 1000)} className={`px-2 py-1 rounded text-[10px] ${activeJob.timeRangeInMs === (m === 'all' ? 'all' : Number(m) * 60 * 1000) ? 'bg-sky-500' : ''}`}>{m === 'all' ? '전체' : `${m}분`}</button>
                        ))}</div>
                    </div>
                    <div className="relative bg-slate-900 rounded-xl overflow-hidden border border-slate-700 h-[400px]">
                        <button onClick={() => setIsFullScreenGraph(true)} className="absolute top-2 right-2 z-20 p-2 text-slate-400 hover:text-white bg-slate-800/80 rounded-full"><EnterFullScreenIcon /></button>
                        {selectedChannel && selectedChannelIndex !== -1 && <Graph {...commonGraphProps} className='h-full' />}
                    </div>
                </div>
            </div>
            <div className="mt-4 bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                <table className="min-w-full text-xs">
                    <thead className="bg-slate-700/50 text-slate-400 uppercase">
                        <tr>
                            <th className="px-3 py-2 text-left w-16">유형</th>
                            <th className="px-3 py-2 text-left">항목</th>
                            <th className="px-3 py-2 text-left">시간/구간</th>
                            <th className="px-3 py-2 text-right w-24">값</th>
                            <th className="px-3 py-2 text-right w-24">최대</th>
                            <th className="px-3 py-2 text-right w-24">최소</th>
                            <th className="px-3 py-2 text-center w-12">관리</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                        {unifiedResults.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-4 text-center text-slate-500 italic">표시할 분석 결과가 없습니다.</td>
                            </tr>
                        ) : unifiedResults.map(item => (
                            <tr key={item.id} className="hover:bg-slate-700/30 text-slate-300">
                                <td className="px-3 py-2">{item.type}</td>
                                <td className="px-3 py-2 font-bold text-sky-400">{item.name}</td>
                                <td className="px-3 py-2">
                                    {item.endTime ? `${item.startTime.toLocaleTimeString()} ~ ${item.endTime.toLocaleTimeString()}` : item.startTime.toLocaleTimeString()}
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {item.type === '수동 분석' ? (
                                        <span className="text-amber-400">{item.diff?.toFixed(3)}</span>
                                    ) : (
                                        item.value?.toFixed(3) || '-'
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-400">
                                    {item.max?.toFixed(3) || '-'}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-400">
                                    {item.min?.toFixed(3) || '-'}
                                </td>
                                <td className="px-3 py-2 text-center">
                                    {item.type === '수동 분석' && (
                                        <button 
                                            onClick={() => handleDeleteManualResult(item.channelId, item.id)}
                                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                            title="삭제"
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
