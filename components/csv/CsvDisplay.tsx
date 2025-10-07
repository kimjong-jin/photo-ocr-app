import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';
// FIX: Correctly import types from the dedicated types file `../../types/csvGraph.ts`
import type { CsvGraphJob, ChannelAnalysisState, AiPhase, AiAnalysisPoint, AiAnalysisResult, AnalysisResult as JobAnalysisResult, SensorType } from '../../types/csvGraph';
import { getPhaseLabel } from '../../utils/phaseLabel';
import { isMobileDevice } from '../../shared/utils';

// Type imports moved from CsvGraphPage
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


// ---------- Custom hook to observe resize of a ref (SSR-safe) ----------
const useResizeObserver = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = resizeRef.current;
    if (!element) return;

    if (typeof (window as any).ResizeObserver === 'undefined') {
      const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
      update();
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

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

// ---------- Graphing Components ----------
interface GraphCanvasProps {
  data: DataPoint[];
  fullData: DataPoint[];
  channelIndex: number;
  channelInfo: ChannelInfo;
  width: number;
  height: number;
  onFinePan: (direction: number) => void;
  onPanByAmount: (ms: number) => void;
  onZoom: (zoomFactor: number, centerTs: number) => void;
  showMajorTicks: boolean;
  yMinMaxOverall: { yMin: number; yMax: number } | null;
  isAnalyzing: boolean;
  onPointSelect: (point: { timestamp: Date; value: number }) => void;
  selection: RangeSelection | null;
  analysisResults: AnalysisResult[];
  aiPhases: AiPhase[] | null;
  aiAnalysisResult: AiAnalysisResult | null;
  onPhaseTimeChange: (index: number, field: 'startTime' | 'endTime', newTime: Date) => void;
  onAiPointChange: (label: string, newPoint: AiAnalysisPoint) => void;
  isAiAnalyzing: boolean;
  placingAiPointLabel: string | null;
  onManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
  setPlacingAiPointLabel: (label: string | null) => void;
  isRangeSelecting: boolean;
  rangeSelection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; } | null;
  onRangeSelectComplete: (selection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; }) => void;
  excludeResponseTime: boolean;
  measurementRange?: number;
  sequentialPlacementState: { isActive: boolean; currentIndex: number; };
  onSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
  sensorType: SensorType;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({ 
    data, fullData, channelIndex, channelInfo, width, height, onFinePan, onPanByAmount, onZoom, showMajorTicks, yMinMaxOverall,
    isAnalyzing, onPointSelect, selection, analysisResults, aiPhases, aiAnalysisResult,
    onPhaseTimeChange, onAiPointChange, isAiAnalyzing, placingAiPointLabel, onManualAiPointPlacement,
    setPlacingAiPointLabel, isRangeSelecting, rangeSelection, onRangeSelectComplete, excludeResponseTime,
    measurementRange, sequentialPlacementState, onSequentialPointPlacement, sensorType
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const lastPanTime = useRef<number>(0);
  
  const [draggingPhase, setDraggingPhase] = useState<{ index: number; handle: 'start' | 'end' } | null>(null);
  const [hoveredPhaseHandle, setHoveredPhaseHandle] = useState<{ index: number; handle: 'start' | 'end' } | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ label: string } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ label: string } | null>(null);

  const [dragStart, setDragStart] = useState<{ x: number; timestamp: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number } | null>(null);
  // FIX: Change React.Touch[] to Touch[] to match the type returned by Array.from(event.touches)
  // which resolves type errors when accessing properties like clientX/clientY.
  const touchState = useRef<{ lastTouches: Touch[] }>({ lastTouches: [] });
  const longPressTimer = useRef<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);


  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isAiAnalyzing) return;

    if (isRangeSelecting) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        if (graphWidth <= 0) return;

        const channelData = data.map(d => ({ timestamp: d.timestamp, value: d.values[channelIndex] })).filter(d => d.value !== null) as { timestamp: Date, value: number }[];
        if (channelData.length < 1) return;
        let minTimestamp = channelData[0].timestamp.getTime();
        let maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
        if (minTimestamp === maxTimestamp) maxTimestamp++;

        const timeAtMouse = minTimestamp + ((x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);
        setDragStart({ x, timestamp: timeAtMouse });
        setDragEnd({ x });
        event.preventDefault();
        return;
    }

    if (hoveredPhaseHandle) {
        setDraggingPhase(hoveredPhaseHandle);
        event.preventDefault();
    } else if (hoveredPoint) {
        setDraggingPoint(hoveredPoint);
        event.preventDefault();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isRangeSelecting && dragStart && dragEnd) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        if (graphWidth > 0) {
            const channelData = data.map(d => ({ timestamp: d.timestamp, value: d.values[channelIndex] })).filter(d => d.value !== null) as { timestamp: Date, value: number }[];
            if (channelData.length > 0) {
                let minTimestamp = channelData[0].timestamp.getTime();
                let maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
                if (minTimestamp === maxTimestamp) maxTimestamp++;
                const timeAtMouse = minTimestamp + ((x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);
                onRangeSelectComplete({
                    start: { timestamp: new Date(Math.min(dragStart.timestamp, timeAtMouse)), value: 0 },
                    end: { timestamp: new Date(Math.max(dragStart.timestamp, timeAtMouse)), value: 0 },
                });
            }
        }
        setDragStart(null);
        setDragEnd(null);
    }
    setDraggingPhase(null);
    setDraggingPoint(null);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setMousePosition({ x, y });

    if (isRangeSelecting && dragStart) {
        setDragEnd({ x });
        return;
    }

    const padding = { top: 50, right: 80, bottom: 40, left: 60 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    const channelData = data
      .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
      .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
    if (channelData.length < 1) return;
    
    let minTimestamp = channelData[0].timestamp.getTime();
    let maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
    if (minTimestamp === maxTimestamp) maxTimestamp = minTimestamp + 1;

    const mapX = (ts: number) => padding.left + ((ts - minTimestamp) / (maxTimestamp - minTimestamp)) * graphWidth;
    let yMin, yMax;
    if (yMinMaxOverall) {
        yMin = yMinMaxOverall.yMin;
        yMax = yMinMaxOverall.yMax;
    } else {
        const yValues = channelData.map((d) => d.value);
        yMin = Math.min(...yValues);
        yMax = Math.max(...yValues);
    }
    const mapY = (val: number) => padding.top + graphHeight - ((val - yMin) / (yMax - yMin)) * graphHeight;

    const timeAtMouse = minTimestamp + ((x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);

    if (draggingPhase) {
        const fieldToChange = draggingPhase.handle === 'start' ? 'startTime' : 'endTime';
        onPhaseTimeChange(draggingPhase.index, fieldToChange, new Date(timeAtMouse));
        return; 
    }

    if (draggingPoint) {
        let closestIndex = -1;
        let minDistance = Infinity;
        channelData.forEach((d, i) => {
            const distance = Math.abs(d.timestamp.getTime() - timeAtMouse);
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        });

        if (closestIndex !== -1) {
            const closestDataPoint = channelData[closestIndex];
            onAiPointChange(draggingPoint.label, {
                timestamp: closestDataPoint.timestamp.toISOString(),
                value: closestDataPoint.value
            });
        }
        return;
    }
    
    if (isAiAnalyzing) return;

    let currentlyHoveredPhase: { index: number; handle: 'start' | 'end' } | null = null;
    if (aiPhases) {
        for (let i = 0; i < aiPhases.length; i++) {
            const phase = aiPhases[i];
            const startX = mapX(new Date(phase.startTime).getTime());
            const endX = mapX(new Date(phase.endTime).getTime());

            if (Math.abs(x - startX) < 5) {
                currentlyHoveredPhase = { index: i, handle: 'start' };
                break;
            }
            if (Math.abs(x - endX) < 5) {
                currentlyHoveredPhase = { index: i, handle: 'end' };
                break;
            }
        }
    }
    setHoveredPhaseHandle(currentlyHoveredPhase);

    let currentlyHoveredPoint: { label: string } | null = null;
    if (aiAnalysisResult && !currentlyHoveredPhase) {
        const points = Object.entries(aiAnalysisResult)
            .filter(([key, value]) => typeof value === 'object' && value && 'timestamp' in value && 'value' in value)
            .map(([key, value]) => ({ label: key, point: value as AiAnalysisPoint }));
            
        for (const {label, point} of points) {
            const pointTs = new Date(point.timestamp).getTime();
            if (pointTs >= minTimestamp && pointTs <= maxTimestamp) {
                const pointX = mapX(pointTs);
                
                let pointY;
                if (label === 'responseEndPoint' && aiAnalysisResult?.s1) {
                    pointY = mapY(aiAnalysisResult.s1.value * 0.9);
                } else {
                    pointY = mapY(point.value);
                }
                
                const hitBoxHalfWidth = 15;
                const hitBoxTopOffset = 25;
                const hitBoxBottomOffset = 10;
                
                if (
                    x >= pointX - hitBoxHalfWidth &&
                    x <= pointX + hitBoxHalfWidth &&
                    y >= pointY - hitBoxTopOffset &&
                    y <= pointY + hitBoxBottomOffset
                ) {
                    currentlyHoveredPoint = { label };
                    break;
                }
            }
        }
    }
    setHoveredPoint(currentlyHoveredPoint);
  };

  const handleMouseLeave = () => {
    setMousePosition(null);
    setDraggingPhase(null);
    setHoveredPhaseHandle(null);
    setDraggingPoint(null);
    setHoveredPoint(null);
    setDragStart(null);
    setDragEnd(null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastPanTime.current > 50) {
        onFinePan(Math.sign(event.deltaY));
        lastPanTime.current = now;
    }
  };

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (isAiAnalyzing || isRangeSelecting) return;
        
        const canvas = canvasRef.current;
        if (!canvas) return;

        const channelData = data
          .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
          .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
        if (channelData.length < 1) return;
        
        const rect = event.currentTarget.getBoundingClientRect();
        const xPos = event.clientX - rect.left;
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        if (graphWidth <=0) return;

        let minTimestamp = channelData[0].timestamp.getTime();
        let maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
        if (minTimestamp === maxTimestamp) maxTimestamp = minTimestamp + 1;

        let closestIndex = -1;
        let minDistance = Infinity;
        const timeAtMouse = minTimestamp + ((xPos - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);
        
        channelData.forEach((d, i) => {
          const distance = Math.abs(d.timestamp.getTime() - timeAtMouse);
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
          }
        });

        if (closestIndex !== -1) {
          const point = channelData[closestIndex];
          if (sequentialPlacementState.isActive) {
            onSequentialPointPlacement(point);
          } else if (placingAiPointLabel) {
              onManualAiPointPlacement(placingAiPointLabel, point);
          } else if (isAnalyzing) {
              onPointSelect(point);
          }
        }
      };

    const getCanvasCoords = (clientX: number, clientY: number, target: HTMLCanvasElement) => {
        const rect = target.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const findPointAtCoords = (x: number, y: number): { label: string } | null => {
        if (!aiAnalysisResult) return null;
        
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        if (graphWidth <= 0 || graphHeight <= 0) return null;
        
        const channelData = data.filter(d => d.values[channelIndex] !== null);
        if (channelData.length < 1) return null;
        
        const minTimestamp = channelData[0].timestamp.getTime();
        const maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
        const mapX = (ts: number) => padding.left + ((ts - minTimestamp) / (maxTimestamp - minTimestamp)) * graphWidth;

        let yMin, yMax;
        if (yMinMaxOverall) {
            yMin = yMinMaxOverall.yMin; yMax = yMinMaxOverall.yMax;
        } else {
            const yValues = channelData.map(d => d.values[channelIndex] as number);
            yMin = Math.min(...yValues); yMax = Math.max(...yValues);
        }
        const mapY = (val: number) => padding.top + graphHeight - ((val - yMin) / (yMax - yMin)) * graphHeight;

        const points = Object.entries(aiAnalysisResult)
            .filter(([key, value]) => typeof value === 'object' && value && 'timestamp' in value && 'value' in value)
            .map(([key, value]) => ({ label: key, point: value as AiAnalysisPoint }));

        for (const { label, point } of points) {
            const pointTs = new Date(point.timestamp).getTime();
            if (pointTs >= minTimestamp && pointTs <= maxTimestamp) {
                const pointX = mapX(pointTs);
                let pointY;
                if (label === 'responseEndPoint' && aiAnalysisResult?.s1) {
                    pointY = mapY(aiAnalysisResult.s1.value * 0.9);
                } else {
                    pointY = mapY(point.value);
                }
                
                // FIX: Use a rectangular hitbox for touch events, consistent with mouse hover logic, to make labels draggable.
                const hitBoxHalfWidth = 15;
                const hitBoxTopOffset = 25;
                const hitBoxBottomOffset = 10;
                
                if (
                    x >= pointX - hitBoxHalfWidth &&
                    x <= pointX + hitBoxHalfWidth &&
                    y >= pointY - hitBoxTopOffset &&
                    y <= pointY + hitBoxBottomOffset
                ) {
                    return { label };
                }
            }
        }
        return null;
    };

    const findClosestDataPointToX = (x: number): { timestamp: Date; value: number } | null => {
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        if (graphWidth <= 0) return null;
        const channelData = data.filter(d => d.values[channelIndex] !== null) as { timestamp: Date; values: (number|null)[] }[];
        if (channelData.length < 1) return null;
        
        const minTimestamp = channelData[0].timestamp.getTime();
        const maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
        const timeAtMouse = minTimestamp + ((x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);

        let closestIndex = -1, minDistance = Infinity;
        channelData.forEach((d, i) => {
            const distance = Math.abs(d.timestamp.getTime() - timeAtMouse);
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        });
        
        if (closestIndex > -1) {
            const point = channelData[closestIndex];
            return { timestamp: point.timestamp, value: point.values[channelIndex]! };
        }
        return null;
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        const touch = event.touches[0];
        touchStartPos.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

        if (longPressTimer.current) clearTimeout(longPressTimer.current);

        longPressTimer.current = window.setTimeout(() => {
            longPressTimer.current = null;
            if (touchStartPos.current) {
                const { x, y } = getCanvasCoords(touchStartPos.current.x, touchStartPos.current.y, event.currentTarget);
                const pointToDrag = findPointAtCoords(x, y);
                if (pointToDrag) {
                    setDraggingPoint({ label: pointToDrag.label });
                }
            }
        }, 500);

        touchState.current.lastTouches = Array.from(event.touches);
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
        event.preventDefault();

        if (longPressTimer.current && touchStartPos.current) {
            const touch = event.touches[0];
            const dx = Math.abs(touch.clientX - touchStartPos.current.x);
            const dy = Math.abs(touch.clientY - touchStartPos.current.y);
            if (dx > 10 || dy > 10) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
        }
        
        if (draggingPoint) {
            const touch = event.touches[0];
            const { x } = getCanvasCoords(touch.clientX, touch.clientY, event.currentTarget);
            const closestDataPoint = findClosestDataPointToX(x);
            if (closestDataPoint) {
                onAiPointChange(draggingPoint.label, {
                    timestamp: closestDataPoint.timestamp.toISOString(),
                    value: closestDataPoint.value
                });
            }
            return;
        }

        const last = touchState.current.lastTouches;
        const current = Array.from(event.touches);
        const padding = { top: 50, right: 80, bottom: 40, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        if (graphWidth <= 0) return;
        const minTimestamp = data.length > 0 ? data[0].timestamp.getTime() : 0;
        const maxTimestamp = data.length > 0 ? data[data.length - 1].timestamp.getTime() : 0;
        const timeRangeInMs = maxTimestamp - minTimestamp;
        if (timeRangeInMs <= 0) return;

        if (last.length === 1 && current.length === 1) {
            const deltaX = current[0].clientX - last[0].clientX;
            const panAmountMs = (deltaX / graphWidth) * timeRangeInMs;
            onPanByAmount(-panAmountMs);
        } else if (last.length === 2 && current.length === 2) {
            const oldDist = Math.hypot(last[0].clientX - last[1].clientX, last[0].clientY - last[1].clientY);
            const newDist = Math.hypot(current[0].clientX - current[1].clientX, current[0].clientY - current[1].clientY);
            if (oldDist > 0) {
                const zoomFactor = newDist / oldDist;
                const rect = event.currentTarget.getBoundingClientRect();
                const centerX = (current[0].clientX + current[1].clientX) / 2 - rect.left;
                const centerTs = minTimestamp + ((centerX - padding.left) / graphWidth) * timeRangeInMs;
                onZoom(zoomFactor, centerTs);
            }
        }
        touchState.current.lastTouches = current;
    };

    const handleTouchEnd = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
            if (touchStartPos.current) {
                const duration = Date.now() - touchStartPos.current.time;
                const lastTouch = event.changedTouches[0];
                const dx = Math.abs(lastTouch.clientX - touchStartPos.current.x);
                const dy = Math.abs(lastTouch.clientY - touchStartPos.current.y);
                if (duration < 300 && dx < 10 && dy < 10) {
                    const mockMouseEvent = { clientX: lastTouch.clientX, clientY: lastTouch.clientY, currentTarget: event.currentTarget } as any;
                    handleClick(mockMouseEvent);
                }
            }
        }
        if (draggingPoint) setDraggingPoint(null);
        touchStartPos.current = null;
        touchState.current.lastTouches = Array.from(event.touches);
    };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cursorStyle = 'crosshair';
    if (isRangeSelecting) {
        cursorStyle = 'ew-resize';
    } else if (placingAiPointLabel || sequentialPlacementState.isActive) {
        cursorStyle = 'cell';
    } else if (isAnalyzing) {
        cursorStyle = 'copy';
    } else if (hoveredPhaseHandle || draggingPhase) {
        cursorStyle = 'col-resize';
    } else if (hoveredPoint || draggingPoint) {
        cursorStyle = 'move';
    }
    canvas.style.cursor = cursorStyle;
  }, [isAnalyzing, hoveredPhaseHandle, draggingPhase, hoveredPoint, draggingPoint, placingAiPointLabel, isRangeSelecting, sequentialPlacementState.isActive]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 50, right: 80, bottom: 40, left: 60 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    if (graphWidth <= 0 || graphHeight <= 0) return;

    const channelData = data
      .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
      .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
    channelData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (channelData.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '14px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
      ctx.fillText('데이터가 부족하여 그래프를 표시할 수 없습니다.', width / 2, height / 2);
      return;
    }

    let minTimestamp = channelData[0].timestamp.getTime();
    let maxTimestamp = channelData[channelData.length - 1].timestamp.getTime();
    if (minTimestamp === maxTimestamp) maxTimestamp = minTimestamp + 1;

    let yMin, yMax;
    if (yMinMaxOverall) {
        yMin = yMinMaxOverall.yMin;
        yMax = yMinMaxOverall.yMax;
    } else {
        const yValues = channelData.map((d) => d.value);
        yMin = Math.min(...yValues);
        yMax = Math.max(...yValues);
        const yRange = yMax - yMin || 1;
        yMin -= yRange * 0.1;
        yMax += yRange * 0.1;
    }

    const mapX = (ts: number) => padding.left + ((ts - minTimestamp) / (maxTimestamp - minTimestamp)) * graphWidth;
    const mapY = (val: number) => padding.top + graphHeight - ((val - yMin) / (yMax - yMin)) * graphHeight;

    // Draw concentration zones
    if (sensorType === '수질 (PH)') {
        // pH 4 (3.5-5.0)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.08)'; // red-500
        const ph4_start = mapY(5.0);
        const ph4_end = mapY(3.5);
        ctx.fillRect(padding.left, ph4_start, graphWidth, ph4_end - ph4_start);

        // pH 7 (6.5-8.0)
        ctx.fillStyle = 'rgba(34, 197, 94, 0.08)'; // green-500
        const ph7_start = mapY(8.0);
        const ph7_end = mapY(6.5);
        ctx.fillRect(padding.left, ph7_start, graphWidth, ph7_end - ph7_start);

        // pH 10 (9.0-11.0)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)'; // blue-500
        const ph10_start = mapY(11.0);
        const ph10_end = mapY(9.0);
        ctx.fillRect(padding.left, ph10_start, graphWidth, ph10_end - ph10_start);
        
        // Add 4, 7, 10 labels on the right
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('10', width - padding.right + 5, mapY(10));
        ctx.fillText('7', width - padding.right + 5, mapY(7));
        ctx.fillText('4', width - padding.right + 5, mapY(4));
    } else { // Default and SS
        const yMaxForConcentration = measurementRange || yMax;
        if (yMaxForConcentration > 0) {
            // High (S) zone: 80-100%
            ctx.fillStyle = 'rgba(250, 204, 21, 0.08)'; // yellow-300 with opacity
            const highYStart = mapY(yMaxForConcentration);
            const highYEnd = mapY(yMaxForConcentration * 0.8);
            ctx.fillRect(padding.left, highYStart, graphWidth, highYEnd - highYStart);

            // Medium (M) zone: 40-60%
            ctx.fillStyle = 'rgba(16, 185, 129, 0.08)'; // green-500 with opacity
            const medYStart = mapY(yMaxForConcentration * 0.6);
            const medYEnd = mapY(yMaxForConcentration * 0.4);
            ctx.fillRect(padding.left, medYStart, graphWidth, medYEnd - medYStart);

            // Low (Z) zone: 0-20%
            ctx.fillStyle = 'rgba(59, 130, 246, 0.08)'; // blue-500 with opacity
            const lowYStart = mapY(yMaxForConcentration * 0.2);
            const lowYEnd = mapY(0);
            ctx.fillRect(padding.left, lowYStart, graphWidth, lowYEnd - lowYStart);
            
            // Add L, M, H labels on the right
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px Inter, system-ui';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('H', width - padding.right + 5, mapY(yMaxForConcentration * 0.9));
            ctx.fillText('M', width - padding.right + 5, mapY(yMaxForConcentration * 0.5));
            ctx.fillText('L', width - padding.right + 5, mapY(yMaxForConcentration * 0.1));
        }
    }
    
    if (rangeSelection?.start && rangeSelection?.end) {
        const startX = mapX(rangeSelection.start.timestamp.getTime());
        const endX = mapX(rangeSelection.end.timestamp.getTime());
        if (startX < endX) {
            ctx.fillStyle = "rgba(253, 224, 71, 0.2)";
            ctx.fillRect(startX, padding.top, endX - startX, graphHeight);
        }
    }

    if (aiPhases) {
        ctx.save();
        const phaseY = padding.top - 25;
        const bracketHeight = 5;
        ctx.font = '9px Inter, system-ui';
        ctx.textAlign = 'center';

        aiPhases.forEach((phase, index) => {
            const startTs = new Date(phase.startTime).getTime();
            const endTs = new Date(phase.endTime).getTime();

            if (isNaN(startTs) || isNaN(endTs) || endTs < minTimestamp || startTs > maxTimestamp) {
                return;
            }

            const startX = mapX(Math.max(startTs, minTimestamp));
            const endX = mapX(Math.min(endTs, maxTimestamp));
            
            let color = '#94a3b8';
            if (phase.name.toLowerCase().includes('low')) color = '#60a5fa';
            else if (phase.name.toLowerCase().includes('high')) color = '#facc15';
            else if (phase.name.toLowerCase().includes('medium')) color = '#f97316';
            
            const isHovered = (hoveredPhaseHandle?.index === index || draggingPhase?.index === index);

            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;

            ctx.beginPath();
            ctx.moveTo(startX, phaseY + bracketHeight);
            ctx.lineTo(startX, phaseY);
            ctx.lineTo(endX, phaseY);
            ctx.lineTo(endX, phaseY + bracketHeight);
            ctx.stroke();

            ctx.lineWidth = isHovered ? 2.5 : 1.5;
            ctx.strokeStyle = isHovered ? '#f8fafc' : color;
            ctx.beginPath();
            ctx.moveTo(startX, phaseY - 5);
            ctx.lineTo(startX, phaseY + bracketHeight + 5);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(endX, phaseY - 5);
            ctx.lineTo(endX, phaseY + bracketHeight + 5);
            ctx.stroke();

            const labelX = startX + (endX - startX) / 2;
            
            const labelText = getPhaseLabel(phase.name);

            ctx.fillText(labelText, labelX, phaseY - 8);
        });
        ctx.restore();
    }

    ctx.strokeStyle = '#334155';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
    ctx.lineWidth = 1;

    const numYGridLines = 5;
    for (let i = 0; i <= numYGridLines; i++) {
      const y = padding.top + (i / numYGridLines) * graphHeight;
      const value = yMax - (i / numYGridLines) * (yMax - yMin);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + graphWidth, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(value.toFixed(2), padding.left - 8, y);
    }

    const numXGridLines = Math.min(Math.floor(graphWidth / 100), 10);
    if (numXGridLines > 0) {
      for (let i = 0; i <= numXGridLines; i++) {
        const x = padding.left + (i / numXGridLines) * graphWidth;
        const timestamp = new Date(minTimestamp + (i / numXGridLines) * (maxTimestamp - minTimestamp));
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + graphHeight);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(timestamp.toLocaleTimeString(), x, padding.top + graphHeight + 8);
      }
    }
    
    const ONE_HOUR_MS = 60 * 60 * 1000;
    if (showMajorTicks) {
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      let tickTime = Math.ceil(minTimestamp / ONE_HOUR_MS) * ONE_HOUR_MS;
      while (tickTime < maxTimestamp) {
        const x = mapX(tickTime);
        if (x > padding.left && x < width - padding.right) {
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + graphHeight);
            ctx.stroke();
        }
        tickTime += ONE_HOUR_MS;
      }
      ctx.restore();
    }
    
    if (isAnalyzing && selection?.start && !selection.end) {
        const startX = mapX(selection.start.timestamp.getTime());
        ctx.save();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(startX, padding.top);
        ctx.lineTo(startX, padding.top + graphHeight);
        ctx.stroke();
        ctx.restore();
    }

    if (analysisResults) {
        analysisResults.forEach(result => {
            const startX = mapX(result.startTime.getTime());
            const endX = mapX(result.endTime.getTime());
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.fillRect(startX, padding.top, endX - startX, graphHeight);
        });
    }

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    channelData.forEach((d, i) => {
      const x = mapX(d.timestamp.getTime());
      const y = mapY(d.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (analysisResults) {
        const fullChannelDataForAnalysis = (fullData || data)
            .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
            .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];

        analysisResults.forEach(result => {
            const pointsInRange = fullChannelDataForAnalysis.filter(d => d.timestamp >= result.startTime && d.timestamp <= result.endTime);
            if (pointsInRange.length === 0) return;
            
            const EPSILON = 1e-9;
            const maxPoint = pointsInRange.find(p => Math.abs(p.value - result.max) < EPSILON);

            const drawResultPoint = (point: { value: number; timestamp: Date; } | undefined, color: string) => {
                if (!point) return;
                const x = mapX(point.timestamp.getTime());
                const y = mapY(point.value);
                ctx.fillStyle = color;
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            };
            drawResultPoint(maxPoint, '#4ade80');
        });
    }
    
    // Draw response time area and lines BEFORE points
    if (!excludeResponseTime && aiAnalysisResult?.responseStartPoint && aiAnalysisResult.responseEndPoint && typeof aiAnalysisResult.responseTimeInSeconds === 'number') {
        const startPt = aiAnalysisResult.responseStartPoint;
        const endPt = aiAnalysisResult.responseEndPoint;
        const startTs = new Date(startPt.timestamp).getTime();
        const endTs = new Date(endPt.timestamp).getTime();

        if (Math.max(startTs, minTimestamp) <= Math.min(endTs, maxTimestamp)) {
            const startX = mapX(startTs);
            const endX = mapX(endTs);
            
            let endY;
            if (aiAnalysisResult.s1) {
                endY = mapY(aiAnalysisResult.s1.value * 0.9);
            } else {
                endY = mapY(endPt.value);
            }

            // 1. Highlighted Area
            ctx.fillStyle = 'rgba(45, 212, 191, 0.15)'; // translucent teal
            ctx.fillRect(startX, padding.top, endX - startX, graphHeight);

            // 2. Dashed line from End Point to the 90% threshold line
            ctx.save();
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);

            if (aiAnalysisResult.s1) {
                const targetValue = aiAnalysisResult.s1.value * 0.9;
                const y90percent = mapY(targetValue);
                
                if (y90percent >= padding.top && y90percent <= padding.top + graphHeight) {
                    ctx.strokeStyle = '#f472b6'; // pink, to match the horizontal line
                    ctx.beginPath();
                    ctx.moveTo(endX, mapY(endPt.value));
                    ctx.lineTo(endX, y90percent);
                    ctx.stroke();
                }
            }
            
            ctx.restore();
        }
    }


    if (aiAnalysisResult) {
        const pointsToDraw = [
            { label: 'Z1', key: 'z1', point: aiAnalysisResult.z1, color: '#60a5fa' },
            { label: 'Z2', key: 'z2', point: aiAnalysisResult.z2, color: '#60a5fa' },
            { label: 'Z3', key: 'z3', point: aiAnalysisResult.z3, color: '#60a5fa' },
            { label: 'Z4', key: 'z4', point: aiAnalysisResult.z4, color: '#60a5fa' },
            { label: 'Z5', key: 'z5', point: aiAnalysisResult.z5, color: '#60a5fa' },
            { label: 'S1', key: 's1', point: aiAnalysisResult.s1, color: '#facc15' },
            { label: 'S2', key: 's2', point: aiAnalysisResult.s2, color: '#facc15' },
            { label: 'S3', key: 's3', point: aiAnalysisResult.s3, color: '#facc15' },
            { label: 'S4', key: 's4', point: aiAnalysisResult.s4, color: '#facc15' },
            { label: 'S5', key: 's5', point: aiAnalysisResult.s5, color: '#facc15' },
            { label: 'M1', key: 'm1', point: aiAnalysisResult.m1, color: '#f97316' },
            { label: 'ST', key: 'responseStartPoint', point: aiAnalysisResult.responseStartPoint, color: '#2dd4bf' },
            { label: 'EN', key: 'responseEndPoint', point: aiAnalysisResult.responseEndPoint, color: '#2dd4bf' },
            { label: '현장1', key: '현장1', point: aiAnalysisResult.현장1, color: '#a78bfa' },
            { label: '현장2', key: '현장2', point: aiAnalysisResult.현장2, color: '#a78bfa' },
        ];

        pointsToDraw.forEach(({ label, key, point, color }) => {
            if (excludeResponseTime && (label === 'ST' || label === 'EN')) {
                return;
            }
            if (point && point.timestamp && typeof point.value === 'number') {
                const pointTs = new Date(point.timestamp).getTime();
                if (pointTs >= minTimestamp && pointTs <= maxTimestamp) {
                    const x = mapX(pointTs);
                    
                    let y;
                    if (label === 'EN' && aiAnalysisResult.s1) {
                        y = mapY(aiAnalysisResult.s1.value * 0.9);
                    } else {
                        y = mapY(point.value);
                    }

                    const isHovered = (hoveredPoint?.label === key || draggingPoint?.label === key);

                    ctx.save();
                    ctx.fillStyle = color;
                    ctx.strokeStyle = isHovered ? '#f8fafc' : '#0f172a';
                    ctx.lineWidth = isHovered ? 3 : 2;
                    ctx.beginPath();
                    ctx.arc(x, y, isHovered ? 6 : 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();

                    ctx.fillStyle = '#f8fafc';
                    ctx.font = 'bold 11px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(label, x, y - (isHovered ? 9 : 7));
                    ctx.restore();
                }
            }
        });
        
        if (!excludeResponseTime && aiAnalysisResult?.s1) {
            const targetValue = aiAnalysisResult.s1.value * 0.9;
            const y = mapY(targetValue);
            
            if (y >= padding.top && y <= padding.top + graphHeight) {
                ctx.save();
                ctx.strokeStyle = '#f472b6';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);

                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(padding.left + graphWidth, y);
                ctx.stroke();
                
                ctx.fillStyle = '#f472b6';
                ctx.font = '10px Inter, system-ui';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`90% of S1`, padding.left + graphWidth - 5, y - 2);
                
                ctx.restore();
            }
        }
    }

    if (dragStart && dragEnd) {
        const startX = Math.min(dragStart.x, dragEnd.x);
        const endX = Math.max(dragStart.x, dragEnd.x);
        ctx.fillStyle = "rgba(253, 224, 71, 0.3)";
        ctx.fillRect(startX, padding.top, endX - startX, graphHeight);
    }

    if (
      mousePosition && !dragStart &&
      mousePosition.x > padding.left && mousePosition.x < width - padding.right &&
      mousePosition.y > padding.top && mousePosition.y < height - padding.bottom
    ) {
      let closestIndex = -1;
      let minDistance = Infinity;
      const timeAtMouse = minTimestamp + ((mousePosition.x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);
      channelData.forEach((d, i) => {
        const distance = Math.abs(d.timestamp.getTime() - timeAtMouse);
        if (distance < minDistance) { minDistance = distance; closestIndex = i; }
      });
      if (closestIndex !== -1) {
        const point = channelData[closestIndex];
        const x = mapX(point.timestamp.getTime());
        const y = mapY(point.value);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + graphHeight);
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const text1 = `${point.timestamp.toLocaleString()}`;
        const text2 = `${point.value.toFixed(3)} ${channelInfo.unit.replace(/\[|\]/g, '')}`;
        ctx.font = '12px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
        const text1Width = ctx.measureText(text1).width;
        const text2Width = ctx.measureText(text2).width;
        const boxWidth = Math.max(text1Width, text2Width) + 16;
        const boxHeight = 44;
        let boxX = x + 15;
        if (boxX + boxWidth > width) boxX = x - boxWidth - 15;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(boxX, mousePosition.y - boxHeight / 2, boxWidth, boxHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text1, boxX + 8, mousePosition.y - 8);
        ctx.fillText(text2, boxX + 8, mousePosition.y + 8);
      }
    }
  }, [data, fullData, channelIndex, channelInfo, width, height, mousePosition, showMajorTicks, yMinMaxOverall, isAnalyzing, selection, analysisResults, onPointSelect, aiPhases, aiAnalysisResult, hoveredPhaseHandle, draggingPhase, hoveredPoint, draggingPoint, placingAiPointLabel, onManualAiPointPlacement, rangeSelection, dragStart, dragEnd, excludeResponseTime, measurementRange, sequentialPlacementState, sensorType]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'pan-y' }}
    />
  );
};

interface TimelineNavigatorProps {
  fullData: DataPoint[];
  channelIndex: number;
  fullTimeRange: { min: number; max: number };
  viewTimeRange: number;
  viewEndTimestamp: number;
  onNavigate: (newEndTimestamp: number) => void;
  yMinMaxOverall: { yMin: number; yMax: number } | null;
}

const TimelineNavigator: React.FC<TimelineNavigatorProps> = ({
  fullData, channelIndex, fullTimeRange, viewTimeRange, viewEndTimestamp, onNavigate, yMinMaxOverall
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ref: containerRef, width, height } = useResizeObserver();
  const isDragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, endTimestamp: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const channelData = fullData
      .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
      .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
    if (channelData.length < 2) return;

    const { min: minTs, max: maxTs } = fullTimeRange;
    const duration = maxTs - minTs;
    const { yMin, yMax } = yMinMaxOverall || { yMin: 0, yMax: 1 };

    const mapX = (ts: number) => ((ts - minTs) / duration) * width;
    const mapY = (val: number) => height - ((val - yMin) / (yMax - yMin)) * height;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    channelData.forEach((d, i) => {
      const x = mapX(d.timestamp.getTime());
      const y = mapY(d.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const windowWidth = (viewTimeRange / duration) * width;
    const windowStartTs = viewEndTimestamp - viewTimeRange;
    const windowX = mapX(windowStartTs);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.fillRect(windowX, 0, windowWidth, height);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.strokeRect(windowX, 0, windowWidth, height);

  }, [width, height, fullData, channelIndex, fullTimeRange, viewTimeRange, viewEndTimestamp, yMinMaxOverall]);

  const handleInteraction = (clientX: number, isEnd: boolean = false) => {
    if (isEnd) {
      isDragging.current = false;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const duration = fullTimeRange.max - fullTimeRange.min;
    
    if (isDragging.current) {
        const deltaX = mouseX - dragStart.current.mouseX;
        const deltaMs = (deltaX / width) * duration;
        let newEnd = dragStart.current.endTimestamp + deltaMs;
        const minPossibleEnd = fullTimeRange.min + viewTimeRange;
        const maxPossibleEnd = fullTimeRange.max;
        newEnd = Math.max(minPossibleEnd, Math.min(newEnd, maxPossibleEnd));
        onNavigate(newEnd);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const duration = fullTimeRange.max - fullTimeRange.min;

    const windowWidth = (viewTimeRange / duration) * width;
    const windowX = ((viewEndTimestamp - viewTimeRange - fullTimeRange.min) / duration) * width;
    
    if(mouseX >= windowX && mouseX <= windowX + windowWidth) {
        isDragging.current = true;
        dragStart.current = { mouseX: mouseX, endTimestamp: viewEndTimestamp };
    } else {
        const clickedTs = fullTimeRange.min + (mouseX / width) * duration;
        let newEnd = clickedTs + viewTimeRange / 2;
        const minPossibleEnd = fullTimeRange.min + viewTimeRange;
        const maxPossibleEnd = fullTimeRange.max;
        newEnd = Math.max(minPossibleEnd, Math.min(newEnd, maxPossibleEnd));
        onNavigate(newEnd);
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent) => handleInteraction(e.clientX);
  const handleMouseUp = (e: React.MouseEvent) => handleInteraction(e.clientX, true);
  const handleMouseLeave = (e: React.MouseEvent) => handleInteraction(e.clientX, true);

  const getCursor = () => {
    if (isDragging.current) return 'grabbing';
    return 'grab';
  };

  return (
    <div ref={containerRef} className="w-full h-16 bg-slate-900/50 rounded-md border border-slate-700 p-1">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: getCursor() }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
};


interface GraphProps { 
    className?: string;
    data: DataPoint[]; 
    fullData: DataPoint[];
    channelIndex: number; 
    channelInfo: ChannelInfo; 
    onFinePan: (direction: number) => void;
    onPanByAmount: (ms: number) => void;
    onZoom: (zoomFactor: number, centerTs: number) => void;
    showMajorTicks: boolean; 
    yMinMaxOverall: { yMin: number; yMax: number } | null;
    isAnalyzing: boolean;
    onPointSelect: (point: { timestamp: Date; value: number }) => void;
    selection: RangeSelection | null;
    analysisResults: AnalysisResult[];
    aiPhases: AiPhase[] | null;
    aiAnalysisResult: AiAnalysisResult | null;
    onPhaseTimeChange: (index: number, field: 'startTime' | 'endTime', newTime: Date) => void;
    onAiPointChange: (label: string, newPoint: AiAnalysisPoint) => void;
    isAiAnalyzing: boolean;
    placingAiPointLabel: string | null;
    onManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
    setPlacingAiPointLabel: (label: string | null) => void;
    isRangeSelecting: boolean;
    rangeSelection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; } | null;
    onRangeSelectComplete: (selection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; }) => void;
    excludeResponseTime: boolean;
    measurementRange?: number;
    sequentialPlacementState: { isActive: boolean; currentIndex: number; };
    onSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
    sensorType: SensorType;
}

const Graph: React.FC<GraphProps> = (props) => {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} className={`w-full relative ${props.className || 'h-80 lg:h-96'}`}>
      <GraphCanvas {...props} width={width} height={height} />
    </div>
  );
};

interface UnifiedResult {
    id: string;
    order: number;
    type: '농도 구간' | '패턴 포인트' | '응답 시간' | '자동 최대/최소' | '수동 분석';
    name: string;
    startTime?: Date;
    endTime?: Date;
    value?: number;
    max?: number;
    min?: number;
    diff?: number;
    data: any;
}

const getShortType = (type: UnifiedResult['type']): string => {
    switch (type) {
        case '농도 구간': return '구간';
        case '패턴 포인트': return '패턴';
        case '자동 최대/최소': return '대/소';
        case '수동 분석': return '수동';
        case '응답 시간': return '응답';
        default: return type;
    }
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
    handleGoToStart: () => void;
    handleGoToEnd: () => void;
    handlePreviousChunk: () => void;
    handleNextChunk: () => void;
    handleFinePan: (direction: number) => void;
    handlePan: (ms: number) => void;
    handleZoom: (zoomFactor: number, centerTs: number) => void;
    handleNavigate: (newEndTimestamp: number) => void;
    toggleAnalysisMode: (channelId: string) => void;
    handleUndoLastResult: (channelId: string) => void;
    handleResetAnalysis: () => void;
    handleCancelSelection: (channelId: string) => void;
    handlePointSelect: (channelId: string, point: { timestamp: Date; value: number; }) => void;
    handlePhaseTimeChange: (index: number, field: "startTime" | "endTime", newTime: Date) => void;
    handleAiPointChange: (pointLabel: string, newPoint: AiAnalysisPoint) => void;
    handleAutoRangeAnalysis: () => void;
    handleAiPhaseAnalysis: () => Promise<void>;
    handleAiAnalysis: () => Promise<void>;
    placingAiPointLabel: string | null;
    setPlacingAiPointLabel: (label: string | null) => void;
    handleManualAiPointPlacement: (label: string, point: { timestamp: Date; value: number; }) => void;
    handleAutoMinMaxResultChange: (resultId: string, field: keyof AnalysisResult, value: string) => void;
    handleManualAnalysisResultChange: (channelId: string, resultId: string, field: keyof AnalysisResult, value: string) => void;
    isPhaseAnalysisModified: boolean;
    handleReapplyAnalysis: () => Promise<void>;
    isFullScreenGraph: boolean;
    setIsFullScreenGraph: (isFull: boolean) => void;
    aiPointHistory: AiAnalysisResult[];
    handleUndoAiPointChange: () => void;
    sequentialPlacementState: { isActive: boolean; currentIndex: number; };
    handleToggleSequentialPlacement: () => void;
    handleSequentialPointPlacement: (point: { timestamp: Date; value: number; }) => void;
    SEQUENTIAL_POINT_ORDER: string[];
}

export const CsvDisplay: React.FC<CsvDisplayProps> = (props) => {
    const {
        activeJob, yMinMaxPerChannel, viewMemo, fullTimeRange, isAtStart, isAtEnd,
        selectedChannel, selectedChannelIndex,
        updateActiveJob, handleTimeRangeChange, handleGoToStart, handleGoToEnd, handlePreviousChunk,
        handleNextChunk, handleFinePan, handlePan, handleZoom, handleNavigate, toggleAnalysisMode, handleUndoLastResult,
        handleResetAnalysis, handleCancelSelection, handlePointSelect,
        handlePhaseTimeChange, handleAiPointChange, handleAutoRangeAnalysis, handleAiPhaseAnalysis, handleAiAnalysis,
        placingAiPointLabel, setPlacingAiPointLabel, handleManualAiPointPlacement, handleAutoMinMaxResultChange,
        handleManualAnalysisResultChange, isPhaseAnalysisModified, handleReapplyAnalysis,
        isFullScreenGraph, setIsFullScreenGraph,
        aiPointHistory, handleUndoAiPointChange, sequentialPlacementState, handleToggleSequentialPlacement,
        handleSequentialPointPlacement, SEQUENTIAL_POINT_ORDER
    } = props;

    const [manualRangeInput, setManualRangeInput] = useState<string>('');
    const [unifiedResults, setUnifiedResults] = useState<UnifiedResult[]>([]);
    const isUnderConstruction = activeJob.sensorType === '수질 (SS)' || activeJob.sensorType === '수질 (PH)';
    
    useEffect(() => {
        if (activeJob.parsedData) {
            setManualRangeInput(activeJob.parsedData.measurementRange?.toString() ?? '');
        }
    }, [activeJob.id, activeJob.parsedData?.measurementRange]);
    
    useEffect(() => {
        const results: UnifiedResult[] = [];
        let order = 1;
    
        // 1. Concentration Phases
        (activeJob.aiPhaseAnalysisResult || []).forEach(phase => {
            results.push({
                id: `phase-${phase.name}`, order: order++, type: '농도 구간', name: getPhaseLabel(phase.name),
                startTime: new Date(phase.startTime), endTime: new Date(phase.endTime), data: phase,
            });
        });
    
        // 2. Pattern Points
        if (activeJob.aiAnalysisResult) {
            const points = [
                { label: 'Z1', key: 'z1' }, { label: 'Z2', key: 'z2' },
                { label: 'S1', key: 's1' }, { label: 'S2', key: 's2' },
                { label: 'Z3', key: 'z3' }, { label: 'Z4', key: 'z4' },
                { label: 'S3', key: 's3' }, { label: 'S4', key: 's4' },
                { label: 'Z5', key: 'z5' }, { label: 'S5', key: 's5' },
                { label: 'M1', key: 'm1' },
                { label: '현장1', key: '현장1' }, { label: '현장2', key: '현장2' },
            ];
            points.forEach(({ label, key }) => {
                const point = (activeJob.aiAnalysisResult as any)[key];
                if (point) {
                    results.push({
                        id: `point-${key}`, order: order++, type: '패턴 포인트', name: label,
                        startTime: new Date(point.timestamp), value: point.value, data: point,
                    });
                }
            });
        }
    
        // 3. Response Time
        if (activeJob.aiAnalysisResult?.responseStartPoint && activeJob.aiAnalysisResult.responseEndPoint && !activeJob.excludeResponseTime) {
             const { responseTimeInSeconds, responseStartPoint, responseEndPoint, s1 } = activeJob.aiAnalysisResult;
             const targetValue = s1 ? s1.value * 0.9 : 0;
            results.push({
                id: 'response-time', order: order++, type: '응답 시간', 
                name: `응답 (${responseTimeInSeconds?.toFixed(1) ?? 'N/A'}초)`,
                startTime: new Date(responseStartPoint.timestamp), endTime: new Date(responseEndPoint.timestamp), 
                value: targetValue,
                data: activeJob.aiAnalysisResult,
            });
        }
    
        // 4. Auto Min/Max
        (activeJob.autoMinMaxResults || []).forEach(res => {
            results.push({
                id: `auto-${res.id}`, order: order++, type: '자동 최대/최소', name: getPhaseLabel(res.name || ''),
                startTime: res.startTime, endTime: res.endTime, max: res.max, min: res.min, diff: res.diff, data: res,
            });
        });
        
        // 5. Manual Analysis
        if (selectedChannel) {
            (activeJob.channelAnalysis[selectedChannel.id]?.results || []).forEach((res, idx) => {
                 results.push({
                    id: `manual-${res.id}`, order: order++, type: '수동 분석', name: `구간 ${idx + 1}`,
                    startTime: res.startTime, endTime: res.endTime, max: res.max, min: res.min, diff: res.diff, data: res,
                });
            });
        }
    
        setUnifiedResults(results);
    
    }, [
        activeJob.id,
        activeJob.aiPhaseAnalysisResult, 
        activeJob.aiAnalysisResult, 
        activeJob.autoMinMaxResults,
        activeJob.channelAnalysis,
        activeJob.excludeResponseTime,
        selectedChannel
    ]);

    const { zSummary, sSummary } = useMemo(() => {
        const aiAnalysisResult = activeJob.aiAnalysisResult;
        if (!aiAnalysisResult) return { zSummary: null, sSummary: null };

        const zKeys = ['z1', 'z2', 'z3', 'z4', 'z5'];
        const sKeys = ['s1', 's2', 's3', 's4', 's5'];
        
        const zValues = zKeys.map(k => (aiAnalysisResult as any)[k]?.value).filter(v => typeof v === 'number');
        const sValues = sKeys.map(k => (aiAnalysisResult as any)[k]?.value).filter(v => typeof v === 'number');

        let zSum = null;
        if (zValues.length > 0) {
            const max = Math.max(...zValues);
            const min = Math.min(...zValues);
            zSum = { max, min, diff: max - min };
        }

        let sSum = null;
        if (sValues.length > 0) {
            const max = Math.max(...sValues);
            const min = Math.min(...sValues);
            sSum = { max, min, diff: max - min };
        }
        
        return { zSummary: zSum, sSummary: sSum };
    }, [activeJob.aiAnalysisResult]);

    const handleApplyMeasurementRange = () => {
        const value = manualRangeInput.trim();
        const newValue = value === '' ? undefined : parseFloat(value);
        
        if (value !== '' && isNaN(newValue as number)) {
            alert("유효한 숫자를 입력해주세요.");
            setManualRangeInput(activeJob.parsedData?.measurementRange?.toString() ?? '');
            return;
        }

        updateActiveJob(j => {
            if (!j.parsedData) return j;
            return { ...j, parsedData: { ...j.parsedData, measurementRange: newValue } };
        });
    };

    const { parsedData } = activeJob;

    const timeRangeOptions = [
        { label: '10분', value: 10 * 60 * 1000 },
        { label: '30분', value: 30 * 60 * 1000 },
        { label: '1시간', value: 60 * 60 * 1000 },
        { label: '3시간', value: 3 * 60 * 60 * 1000 },
        { label: '6시간', value: 6 * 60 * 60 * 1000 },
        { label: '12시간', value: 12 * 60 * 60 * 1000 },
        { label: '전체', value: 'all' },
    ] as const;

    const handleRangeSelectComplete = (selection: { start: { timestamp: Date; value: number }; end: { timestamp: Date; value: number }; }) => {
        updateActiveJob(job => ({
            ...job,
            isRangeSelecting: false,
            rangeSelection: selection,
        }));
    };
    
    const isAnalyzingAnything = !!activeJob.isAiPhaseAnalyzing || !!activeJob.isAiAnalyzing;
    
    const getButtonClass = (isComplete: boolean, isActive: boolean = false) => {
        if (isActive) return 'bg-indigo-600 hover:bg-indigo-500';
        if (isComplete) return 'bg-green-600';
        return 'bg-slate-600 hover:bg-slate-500';
    };

    const isManualMinMaxComplete = () => {
        if (!selectedChannel) return false;
        const results = activeJob.channelAnalysis[selectedChannel.id]?.results;
        return !!(results && results.length > 0);
    };
    
    const handleOrderInputChange = (id: string, newOrder: number) => {
        setUnifiedResults(prev => 
            prev.map(item => item.id === id ? { ...item, order: isNaN(newOrder) ? 0 : newOrder } : item)
        );
    };
    
    const handleApplyOrder = () => {
        setUnifiedResults(prev => 
            [...prev].sort((a, b) => a.order - b.order)
        );
    };
    
    const handleResultItemChange = (item: UnifiedResult, field: 'startTime' | 'endTime' | 'value' | 'max' | 'min', newValue: string) => {
        if (!selectedChannel) return;

        const parseDateTime = (str: string): Date | null => {
            const d = new Date(str.replace(' ', 'T'));
            return isNaN(d.getTime()) ? null : d;
        };

        const parseNumber = (str: string): number | null => {
            const n = parseFloat(str);
            return isNaN(n) ? null : n;
        };

        switch (item.type) {
            case '농도 구간':
                if ((field === 'startTime' || field === 'endTime')) {
                    const date = parseDateTime(newValue);
                    const phaseIndex = activeJob.aiPhaseAnalysisResult?.findIndex(p => p.name === item.data.name);
                    if (date && phaseIndex !== undefined && phaseIndex > -1) {
                        handlePhaseTimeChange(phaseIndex, field, date);
                    }
                }
                break;
            case '패턴 포인트':
                const pointKey = item.name.toLowerCase();
                const currentPoint = (activeJob.aiAnalysisResult as any)?.[pointKey];
                if (!currentPoint) break;

                let updatedPoint = { ...currentPoint };
                if (field === 'startTime') {
                    const date = parseDateTime(newValue);
                    if (date) updatedPoint.timestamp = date.toISOString();
                } else if (field === 'value') {
                    const num = parseNumber(newValue);
                    if (num !== null) updatedPoint.value = num;
                }
                handleAiPointChange(pointKey, updatedPoint);
                break;
            
            case '자동 최대/최소':
                handleAutoMinMaxResultChange(item.data.id, field as keyof AnalysisResult, newValue);
                break;

            case '수동 분석':
                handleManualAnalysisResultChange(selectedChannel.id, item.data.id, field as keyof AnalysisResult, newValue);
                break;
            
            case '응답 시간':
                break;
        }
    };

    const renderUnifiedResults = () => {
        const editableInputClass = "bg-transparent w-full p-1 text-slate-200 disabled:text-slate-500 focus:bg-slate-600 rounded";
        return (
            <div className="mt-4 bg-slate-800 rounded-lg max-h-[450px] overflow-y-auto border border-slate-700">
                <div className="flex justify-between items-center p-3 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
                    <h3 className="text-sky-400 font-semibold">분석 결과</h3>
                    <ActionButton onClick={handleApplyOrder} variant="secondary" className="text-xs !py-1 !px-3">순서 적용</ActionButton>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-900/50 text-xs uppercase text-slate-400">
                            <tr>
                                <th rowSpan={2} className="p-2 font-medium text-left align-bottom">No.</th>
                                <th rowSpan={2} className="p-2 font-medium text-left align-bottom">유형</th>
                                <th rowSpan={2} className="p-2 font-medium text-left align-bottom">항목</th>
                                <th colSpan={2} className="p-2 pt-2 font-medium text-center">시간</th>
                                <th rowSpan={2} className="p-2 font-medium text-right align-bottom">값</th>
                                <th rowSpan={2} className="p-2 font-medium text-right align-bottom">최대</th>
                                <th rowSpan={2} className="p-2 font-medium text-right align-bottom">최소</th>
                                <th rowSpan={2} className="p-2 font-medium text-right align-bottom">차이</th>
                            </tr>
                            <tr>
                                <th className="p-2 pb-2 pt-0 font-medium text-left">시작</th>
                                <th className="p-2 pb-2 pt-0 font-medium text-left">종료</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700">
                            {unifiedResults.map(item => {
                                const isEditable = item.type !== '응답 시간';
                                
                                return (
                                    <tr key={item.id} className="hover:bg-slate-700/30">
                                        <td className="p-1 text-center align-middle w-16">
                                            <input type="number" value={item.order} onChange={(e) => handleOrderInputChange(item.id, parseInt(e.target.value, 10))} className="w-12 bg-slate-700 border border-slate-600 rounded p-1 text-slate-200 text-center" />
                                        </td>
                                        <td className="p-2 whitespace-nowrap align-middle text-slate-400">{getShortType(item.type)}</td>
                                        <td className="p-2 whitespace-nowrap font-semibold text-slate-200 align-middle">{item.name}</td>
                                        <td className="p-1 align-middle">
                                            <input type="text" key={`${item.id}-start`} defaultValue={item.startTime ? item.startTime.toLocaleString('sv-SE').replace(' ', 'T') : ''} onBlur={(e) => isEditable && handleResultItemChange(item, 'startTime', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${editableInputClass} font-mono text-xs w-40`} placeholder="-" disabled={!item.startTime || !isEditable} />
                                        </td>
                                        <td className="p-1 align-middle">
                                            <input type="text" key={`${item.id}-end`} defaultValue={item.endTime ? item.endTime.toLocaleString('sv-SE').replace(' ', 'T') : ''} onBlur={(e) => isEditable && handleResultItemChange(item, 'endTime', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${editableInputClass} font-mono text-xs w-40`} placeholder="-" disabled={!item.endTime || !isEditable} />
                                        </td>
                                        <td className="p-1 align-middle">
                                            <input type="number" step="0.001" key={`${item.id}-value`} defaultValue={item.value !== undefined ? item.value.toFixed(3) : ''} onBlur={(e) => isEditable && handleResultItemChange(item, 'value', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${editableInputClass} text-right font-mono text-sky-300 w-24`} placeholder="-" disabled={item.value === undefined || !isEditable} />
                                        </td>
                                        <td className="p-1 align-middle">
                                            <input type="number" step="0.001" key={`${item.id}-max`} defaultValue={item.max !== undefined ? item.max.toFixed(3) : ''} onBlur={(e) => isEditable && handleResultItemChange(item, 'max', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${editableInputClass} text-right font-mono text-green-400 w-24`} placeholder="-" disabled={item.max === undefined || !isEditable} />
                                        </td>
                                        <td className="p-1 align-middle">
                                            <input type="number" step="0.001" key={`${item.id}-min`} defaultValue={item.min !== undefined ? item.min.toFixed(3) : ''} onBlur={(e) => isEditable && handleResultItemChange(item, 'min', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${editableInputClass} text-right font-mono text-red-400 w-24`} placeholder="-" disabled={item.min === undefined || !isEditable} />
                                        </td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-amber-400 align-middle w-24">{item.diff?.toFixed(3) ?? '-'}</td>
                                    </tr>
                                );
                            })}
                            {unifiedResults.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="text-center py-8 text-slate-500">
                                        분석 결과가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {(zSummary || sSummary) && (
                            <tbody className="bg-slate-900 font-semibold">
                                {zSummary && (
                                    <tr className="border-t-2 border-slate-700">
                                        <td colSpan={2} className="p-2 whitespace-nowrap align-middle text-slate-400 text-center">총/소</td>
                                        <td className="p-2 whitespace-nowrap text-slate-200 align-middle">Z 포인트 종합</td>
                                        <td className="p-1 align-middle" colSpan={3}>
                                            <input type="text" className={`${editableInputClass} font-mono text-xs`} placeholder="-" disabled />
                                        </td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-green-400 align-middle w-24">{zSummary.max.toFixed(3)}</td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-red-400 align-middle w-24">{zSummary.min.toFixed(3)}</td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-amber-400 align-middle w-24">{zSummary.diff.toFixed(3)}</td>
                                    </tr>
                                )}
                                {sSummary && (
                                    <tr>
                                        <td colSpan={2} className="p-2 whitespace-nowrap align-middle text-slate-400 text-center">총/대</td>
                                        <td className="p-2 whitespace-nowrap text-slate-200 align-middle">S 포인트 종합</td>
                                        <td className="p-1 align-middle" colSpan={3}>
                                            <input type="text" className={`${editableInputClass} font-mono text-xs`} placeholder="-" disabled />
                                        </td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-green-400 align-middle w-24">{sSummary.max.toFixed(3)}</td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-red-400 align-middle w-24">{sSummary.min.toFixed(3)}</td>
                                        <td className="p-2 text-right whitespace-nowrap font-mono text-amber-400 align-middle w-24">{sSummary.diff.toFixed(3)}</td>
                                    </tr>
                                )}
                            </tbody>
                        )}
                    </table>
                </div>
            </div>
        );
    };
    
    if (isFullScreenGraph) {
        return (
            <div className="fixed inset-0 z-50 bg-slate-800 p-4 flex flex-col gap-4">
                 <div className="flex-1 min-w-0 space-y-6 flex flex-col relative h-full">
                    <div className="absolute top-0 right-0 z-20">
                        <button
                            onClick={() => setIsFullScreenGraph(false)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                            aria-label="전체 화면 종료"
                        >
                            <ExitFullScreenIcon />
                        </button>
                    </div>
                    {/* Graph content for fullscreen */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pr-12">
                        <h3 className="text-xl font-semibold text-slate-100">그래프 분석: <span className="text-sky-400">{activeJob.fileName}</span></h3>
                    </div>
                     {selectedChannel && selectedChannelIndex !== -1 && (
                        <div className="space-y-4 flex-grow min-h-0 flex flex-col">
                            <Graph
                                className='flex-grow min-h-0'
                                data={viewMemo.filteredData}
                                fullData={activeJob.parsedData!.data}
                                channelIndex={selectedChannelIndex}
                                channelInfo={selectedChannel!}
                                onFinePan={handleFinePan}
                                onPanByAmount={handlePan}
                                onZoom={handleZoom}
                                showMajorTicks={typeof activeJob.timeRangeInMs === 'number' && activeJob.timeRangeInMs <= 24 * 60 * 60 * 1000}
                                yMinMaxOverall={yMinMaxPerChannel[selectedChannelIndex]}
                                isAnalyzing={!!activeJob.channelAnalysis[selectedChannel!.id]?.isAnalyzing}
                                onPointSelect={(point) => handlePointSelect(selectedChannel!.id, point)}
                                selection={activeJob.channelAnalysis[selectedChannel!.id]?.selection || null}
                                analysisResults={activeJob.channelAnalysis[selectedChannel!.id]?.results || []}
                                aiPhases={activeJob.aiPhaseAnalysisResult || null}
                                aiAnalysisResult={activeJob.aiAnalysisResult || null}
                                onPhaseTimeChange={handlePhaseTimeChange}
                                onAiPointChange={handleAiPointChange}
                                isAiAnalyzing={!!activeJob.isAiAnalyzing}
                                placingAiPointLabel={placingAiPointLabel}
                                onManualAiPointPlacement={handleManualAiPointPlacement}
                                setPlacingAiPointLabel={setPlacingAiPointLabel}
                                isRangeSelecting={!!activeJob.isRangeSelecting}
                                rangeSelection={activeJob.rangeSelection || null}
                                onRangeSelectComplete={handleRangeSelectComplete}
                                excludeResponseTime={!!activeJob.excludeResponseTime}
                                measurementRange={activeJob.parsedData?.measurementRange}
                                sequentialPlacementState={sequentialPlacementState}
                                onSequentialPointPlacement={handleSequentialPointPlacement}
                                sensorType={activeJob.sensorType}
                            />
                        </div>
                     )}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row gap-6">
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-4 lg:w-1/3">
                    <div className="space-y-3">
                        <h3 className="text-lg font-semibold text-slate-100">분석 단계</h3>
                        {isUnderConstruction && (
                            <div className="p-3 bg-amber-800/30 border border-amber-600/50 text-amber-300 rounded-md text-center text-sm">
                                <p><strong>'{activeJob.sensorType}'</strong> 기능은 현재 구축 중입니다.</p>
                                <p>수동 분석 및 초기화만 사용 가능합니다.</p>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => updateActiveJob(j => ({ ...j, isRangeSelecting: !j.isRangeSelecting }))} disabled={isAnalyzingAnything || isUnderConstruction} className={`py-3 rounded-md text-white text-sm transition-colors disabled:opacity-50 ${getButtonClass(!!activeJob.rangeSelection, !!activeJob.isRangeSelecting)}`}>1. 범위 지정</button>
                            <button onClick={handleAiPhaseAnalysis} disabled={isAnalyzingAnything || !parsedData || isUnderConstruction} className={`py-3 rounded-md text-white text-sm transition-colors disabled:opacity-50 ${getButtonClass(!!activeJob.aiPhaseAnalysisResult)}`}>{activeJob.isAiPhaseAnalyzing ? <Spinner size="sm" /> : '2. 농도 분석'}</button>
                            <button onClick={handleAiAnalysis} disabled={isAnalyzingAnything || !activeJob.aiPhaseAnalysisResult || isUnderConstruction} className={`py-3 rounded-md text-white text-sm transition-colors disabled:opacity-50 ${getButtonClass(!!activeJob.aiAnalysisResult, false)}`}>{activeJob.isAiAnalyzing ? <Spinner size="sm" /> : '3. 패턴 분석'}</button>
                            <button onClick={handleAutoRangeAnalysis} disabled={isAnalyzingAnything || !activeJob.aiPhaseAnalysisResult || isUnderConstruction} className={`py-3 rounded-md text-white text-sm transition-colors disabled:opacity-50 ${getButtonClass(!!activeJob.autoMinMaxResults)}`}>4. 최대/최소</button>
                            <button onClick={() => selectedChannel && toggleAnalysisMode(selectedChannel.id)} disabled={isAnalyzingAnything || !selectedChannel} className={`py-3 rounded-md text-white text-sm transition-colors disabled:opacity-50 ${getButtonClass(isManualMinMaxComplete(), activeJob.channelAnalysis[selectedChannel?.id || '']?.isAnalyzing)}`}>5. 수동 분석</button>
                            <button onClick={handleResetAnalysis} disabled={isAnalyzingAnything} className="py-3 bg-red-600 hover:bg-red-700 rounded-md text-white text-sm transition-colors disabled:opacity-50">6. 초기화</button>
                        </div>
                        {isPhaseAnalysisModified && !isUnderConstruction && (
                            <ActionButton onClick={handleReapplyAnalysis} variant="primary" fullWidth>
                                수정된 농도 분석 적용
                            </ActionButton>
                        )}
                        {!isUnderConstruction && (
                            <div className="flex items-center gap-2 pt-2">
                                <input type="checkbox" id="excludeResponseTime" className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500 disabled:opacity-50" checked={activeJob.excludeResponseTime || false} onChange={(e) => updateActiveJob(job => ({ ...job, excludeResponseTime: e.target.checked }))} disabled={isAnalyzingAnything}/>
                                <label htmlFor="excludeResponseTime" className="text-slate-200 text-sm cursor-pointer">시약식</label>
                            </div>
                        )}
                    </div>

                    <div className="space-y-3 pt-3 border-t border-slate-700">
                        <h4 className="text-lg font-semibold text-slate-100">수동 포인트 지정</h4>
                        {isUnderConstruction ? (
                             <p className="text-xs text-slate-400">이 기능은 현재 비활성화되어 있습니다.</p>
                        ) : (
                            <>
                                <p className="text-xs text-slate-400">
                                    {sequentialPlacementState.isActive
                                        ? `그래프를 탭하여 '${(SEQUENTIAL_POINT_ORDER[sequentialPlacementState.currentIndex] || '').toUpperCase()}' 포인트를 지정하세요.`
                                        : placingAiPointLabel
                                            ? `그래프를 탭하여 '${placingAiPointLabel.toUpperCase()}' 포인트를 지정하세요.`
                                            : "'순차 지정 시작' 버튼으로 순서대로 지정하거나, 아래 개별 버튼으로 특정 포인트만 지정할 수 있습니다."}
                                </p>

                                <div className="grid grid-cols-2 gap-3">
                                    <ActionButton onClick={handleToggleSequentialPlacement} fullWidth variant={sequentialPlacementState.isActive ? 'danger' : 'primary'}>
                                        {sequentialPlacementState.isActive ? '지정 중단' : '순차 지정 시작'}
                                    </ActionButton>
                                    <ActionButton onClick={handleUndoAiPointChange} disabled={aiPointHistory.length === 0} fullWidth variant="secondary">
                                        되돌리기
                                    </ActionButton>
                                </div>
                                
                                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                                    {SEQUENTIAL_POINT_ORDER.map((pointKey, index) => {
                                        const isPlaced = !!(activeJob.aiAnalysisResult as any)?.[pointKey];
                                        const isNext = sequentialPlacementState.isActive && sequentialPlacementState.currentIndex === index;
                                        const isBeingPlaced = placingAiPointLabel === pointKey;
                                        
                                        let label = pointKey.toUpperCase();
                                        if (pointKey === 'responseStartPoint') label = 'ST';
                                        if (pointKey === 'responseEndPoint') label = 'EN';
                                        if (pointKey === '현장1') label = '현장1';
                                        if (pointKey === '현장2') label = '현장2';

                                        let buttonClass = 'bg-slate-600 hover:bg-slate-500 text-slate-300';
                                        if (isBeingPlaced) {
                                            buttonClass = 'bg-sky-500 text-white ring-2 ring-sky-300';
                                        } else if (isNext) {
                                            buttonClass = 'bg-sky-500 text-white animate-pulse';
                                        } else if (isPlaced) {
                                            buttonClass = 'bg-green-600 text-white';
                                        }

                                        return (
                                            <button
                                                key={pointKey}
                                                onClick={() => setPlacingAiPointLabel(pointKey)}
                                                className={`text-xs font-bold rounded-md px-2 py-1 text-center transition-colors ${buttonClass}`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="space-y-6 lg:w-2/3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <h3 className="text-xl font-semibold text-slate-100">그래프 분석: <span className="text-sky-400">{activeJob.fileName}</span></h3>
                        <div className="flex items-center bg-slate-700/50 p-1 rounded-lg">
                        {timeRangeOptions.map(opt => (
                            <button key={opt.label} onClick={() => handleTimeRangeChange(opt.value)} className={`px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-opacity-50 ${activeJob.timeRangeInMs === opt.value ? 'bg-sky-500 text-white shadow-md' : 'text-slate-300 hover:bg-slate-700'}`}>
                            {opt.label}
                            </button>
                        ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
                        <h4 className="text-md font-semibold text-slate-200">채널 선택:</h4>
                        <div className="flex flex-wrap gap-2">
                            {activeJob.parsedData!.channels.map(channel => (
                            <button key={channel.id} onClick={() => updateActiveJob(j => ({...j, selectedChannelId: channel.id}))} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 ${activeJob.selectedChannelId === channel.id ? 'bg-sky-500 text-white' : 'bg-slate-600 hover:bg-slate-500 text-slate-300'}`}>
                                {channel.name} ({channel.id})
                            </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                            <label htmlFor="measurement-range" className="text-sm font-medium text-slate-300 whitespace-nowrap">측정 범위:</label>
                            <input type="number" id="measurement-range" value={manualRangeInput} onChange={(e) => setManualRangeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleApplyMeasurementRange(); (e.target as HTMLInputElement).blur(); }}} placeholder="Auto" className="w-24 text-xs bg-slate-700 border border-slate-600 rounded-md p-2 font-mono focus:ring-sky-500 focus:border-sky-500 text-slate-200 placeholder-slate-400" disabled={isAnalyzingAnything}/>
                            <button onClick={handleApplyMeasurementRange} disabled={isAnalyzingAnything} className="px-3 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors disabled:opacity-50" aria-label="측정 범위 적용">적용</button>
                        </div>
                    </div>
                    {activeJob.timeRangeInMs !== 'all' && fullTimeRange && activeJob.viewEndTimestamp !== null && (
                        <TimelineNavigator
                            fullData={activeJob.parsedData!.data}
                            channelIndex={selectedChannelIndex}
                            fullTimeRange={fullTimeRange}
                            viewTimeRange={activeJob.timeRangeInMs}
                            viewEndTimestamp={activeJob.viewEndTimestamp}
                            onNavigate={handleNavigate}
                            yMinMaxOverall={yMinMaxPerChannel[selectedChannelIndex]}
                        />
                    )}
                </div>
            </div>

            {selectedChannel && selectedChannelIndex !== -1 && (
                <div className="relative">
                    <div className="absolute top-0 right-0 z-20">
                        <button
                            onClick={() => setIsFullScreenGraph(true)}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                            aria-label="전체 화면으로 보기"
                        >
                            <EnterFullScreenIcon />
                        </button>
                    </div>
                    <div className="space-y-4">
                        <Graph
                            className='h-[350px]'
                            data={viewMemo.filteredData}
                            fullData={activeJob.parsedData!.data}
                            channelIndex={selectedChannelIndex}
                            channelInfo={selectedChannel!}
                            onFinePan={handleFinePan}
                            onPanByAmount={handlePan}
                            onZoom={handleZoom}
                            showMajorTicks={typeof activeJob.timeRangeInMs === 'number' && activeJob.timeRangeInMs <= 24 * 60 * 60 * 1000}
                            yMinMaxOverall={yMinMaxPerChannel[selectedChannelIndex]}
                            isAnalyzing={!!activeJob.channelAnalysis[selectedChannel!.id]?.isAnalyzing}
                            onPointSelect={(point) => handlePointSelect(selectedChannel!.id, point)}
                            selection={activeJob.channelAnalysis[selectedChannel!.id]?.selection || null}
                            analysisResults={activeJob.channelAnalysis[selectedChannel!.id]?.results || []}
                            aiPhases={activeJob.aiPhaseAnalysisResult || null}
                            aiAnalysisResult={activeJob.aiAnalysisResult || null}
                            onPhaseTimeChange={handlePhaseTimeChange}
                            onAiPointChange={handleAiPointChange}
                            isAiAnalyzing={!!activeJob.isAiAnalyzing}
                            placingAiPointLabel={placingAiPointLabel}
                            onManualAiPointPlacement={handleManualAiPointPlacement}
                            setPlacingAiPointLabel={setPlacingAiPointLabel}
                            isRangeSelecting={!!activeJob.isRangeSelecting}
                            rangeSelection={activeJob.rangeSelection || null}
                            onRangeSelectComplete={handleRangeSelectComplete}
                            excludeResponseTime={!!activeJob.excludeResponseTime}
                            measurementRange={activeJob.parsedData?.measurementRange}
                            sequentialPlacementState={sequentialPlacementState}
                            onSequentialPointPlacement={handleSequentialPointPlacement}
                            sensorType={activeJob.sensorType}
                        />
                    </div>
                </div>
            )}

            <div className="w-full">
                {renderUnifiedResults()}
            </div>
        </div>
    );
}
