import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';

// Interfaces for parsed data
interface ChannelInfo {
  id: string;
  name: string;
  unit: string;
}

interface DataPoint {
  timestamp: Date;
  values: (number | null)[];
}

interface ParsedCsvData {
  channels: ChannelInfo[];
  data: DataPoint[];
  fileName: string;
}

// Interfaces for Range Analysis
interface RangeSelection {
  start: { timestamp: Date; value: number } | null;
  end: { timestamp: Date; value: number } | null;
}

interface AnalysisResult {
  id: string; // For React keys
  min: number;
  max: number;
  diff: number;
  startTime: Date;
  endTime: Date;
}

interface ChannelAnalysisState {
  isAnalyzing: boolean;
  selection: RangeSelection;
  results: AnalysisResult[];
}


// ---------- small CSV helper (handles quoted commas) ----------
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ''));
};

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
  channelIndex: number;
  channelInfo: ChannelInfo;
  width: number;
  height: number;
  onPan: (direction: number) => void;
  showMajorTicks: boolean;
  yMinMaxOverall: { yMin: number; yMax: number } | null;
  isAnalyzing: boolean;
  onPointSelect: (point: { timestamp: Date; value: number }) => void;
  selection: RangeSelection | null;
  analysisResults: AnalysisResult[];
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({ 
    data, channelIndex, channelInfo, width, height, onPan, showMajorTicks, yMinMaxOverall,
    isAnalyzing, onPointSelect, selection, analysisResults
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const touchStartX = useRef<number | null>(null);
  const lastPanTime = useRef<number>(0);

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const handleMouseLeave = () => setMousePosition(null);

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastPanTime.current > 50) {
        onPan(Math.sign(event.deltaY));
        lastPanTime.current = now;
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const touch = event.touches[0];
    setMousePosition({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    touchStartX.current = touch.clientX;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (touchStartX.current === null) return;
    const currentX = event.touches[0].clientX;
    const deltaX = currentX - touchStartX.current;
    
    if (Math.abs(deltaX) > 10) setMousePosition(null);
    if (Math.abs(deltaX) > 40) { onPan(-Math.sign(deltaX)); touchStartX.current = currentX; }
  };
  
  const handleTouchEnd = () => { touchStartX.current = null; };
  
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isAnalyzing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const channelData = data
      .map((d) => ({ timestamp: d.timestamp, value: d.values[channelIndex] }))
      .filter((d) => d.value !== null && typeof d.value === 'number') as { timestamp: Date; value: number }[];
    if (channelData.length < 1) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    const xPos = event.clientX - rect.left;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
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
      onPointSelect(channelData[closestIndex]);
    }

  }, [isAnalyzing, data, channelIndex, width, onPointSelect]);

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

    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
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

    // --- Drawing starts ---
    ctx.strokeStyle = '#334155';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
    ctx.lineWidth = 1;

    // Y-Axis and Grid
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

    // X-Axis and Grid
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
    
    // Major Time Ticks (1 hour)
    const ONE_HOUR_MS = 60 * 60 * 1000;
    if (showMajorTicks) {
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)'; // red-500
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
    
    // --- Range Analysis Visuals ---
    if (isAnalyzing && selection?.start && !selection.end) {
        const startX = mapX(selection.start.timestamp.getTime());
        ctx.save();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.9)'; // yellow-300
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

    // Main Graph Line
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

    // Analysis Result Points (Min/Max)
    if (analysisResults) {
        analysisResults.forEach(result => {
            const pointsInRange = channelData.filter(d => d.timestamp >= result.startTime && d.timestamp <= result.endTime);
            if (pointsInRange.length === 0) return;
            const maxPoint = pointsInRange.find(p => p.value === result.max);
            const minPoint = pointsInRange.find(p => p.value === result.min);

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
            drawResultPoint(maxPoint, '#4ade80'); // green-400
            drawResultPoint(minPoint, '#f87171'); // red-400
        });
    }

    // Hover Tooltip
    if (
      mousePosition &&
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
  }, [data, channelIndex, channelInfo, width, height, mousePosition, showMajorTicks, yMinMaxOverall, isAnalyzing, selection, analysisResults, onPointSelect]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
      style={{ width: '100%', height: '100%', display: 'block', cursor: isAnalyzing ? 'copy' : 'crosshair', touchAction: 'pan-y' }}
    />
  );
};

const Graph: React.FC<{ 
    data: DataPoint[]; 
    channelIndex: number; 
    channelInfo: ChannelInfo; 
    onPan: (direction: number) => void; 
    showMajorTicks: boolean; 
    yMinMaxOverall: { yMin: number; yMax: number } | null;
    isAnalyzing: boolean;
    onPointSelect: (point: { timestamp: Date; value: number }) => void;
    selection: RangeSelection | null;
    analysisResults: AnalysisResult[];
}> = (props) => {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} className="w-full h-80 relative">
      <GraphCanvas {...props} width={width} height={height} />
    </div>
  );
};

const parseGraphtecCsv = (csvContent: string, fileName: string): ParsedCsvData => {
  const lines = csvContent.split(/\r?\n/);
  const channels: ChannelInfo[] = [];
  const data: DataPoint[] = [];

  let state: 'idle' | 'amp' | 'data' = 'idle';
  let dataHeaderCols: string[] = [];
  let ampHeaderFound = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\uFEFF/g, '');
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (trimmedLine.startsWith('AMP settings')) {
      state = 'amp';
      ampHeaderFound = false;
      continue;
    } else if (trimmedLine.startsWith('Data')) {
      state = 'data';
      continue;
    } else if (trimmedLine.startsWith('Calc settings')) {
      state = 'idle';
      continue;
    }

    if (state === 'amp') {
        if (!ampHeaderFound) {
            if (trimmedLine.toLowerCase().startsWith('ch,signal name')) ampHeaderFound = true;
        } else {
            const cols = splitCsvLine(line);
            if (cols[0]?.toLowerCase().startsWith('ch') && !isNaN(parseInt(cols[0].substring(2))) && cols.length > 9) {
                channels.push({ id: cols[0], name: cols[1], unit: cols[9] });
            }
        }
    } else if (state === 'data') {
      if (dataHeaderCols.length === 0 && trimmedLine.toLowerCase().includes('date&time')) {
        dataHeaderCols = splitCsvLine(line).map(h => h.replace(/"/g, '').trim());
      } else if (dataHeaderCols.length > 0 && /^\d+/.test(trimmedLine)) {
        const cols = splitCsvLine(line);
        const timeColIndex = dataHeaderCols.findIndex(h => h.toLowerCase() === 'date&time');
        if (timeColIndex === -1 || timeColIndex >= cols.length) continue;
        const timestampStr = cols[timeColIndex];
        const normalized = timestampStr.replace(/\//g, '-').replace(/\s+/, 'T');
        const timestamp = new Date(normalized);
        if (isNaN(timestamp.getTime())) continue;

        const values: (number | null)[] = [];
        channels.forEach((ch) => {
            const colIndex = dataHeaderCols.findIndex(h => h.toUpperCase() === ch.id.toUpperCase());
          if (colIndex !== -1 && colIndex < cols.length && cols[colIndex] !== '') {
            const val = parseFloat(cols[colIndex].replace('+', ''));
            values.push(Number.isFinite(val) ? val : null);
          } else {
            values.push(null);
          }
        });
        data.push({ timestamp, values });
      }
    }
  }

  if (channels.length === 0 || data.length === 0) {
    throw new Error('CSV 파일 형식이 올바르지 않거나 지원되지 않는 형식입니다. (AMP settings 또는 Data 섹션 누락)');
  }

  return { channels, data, fileName };
};

const ONE_MINUTE_MS = 60 * 1000;
const BIG_PAN_RATIO = 0.25;

const CsvGraphPage: React.FC = () => {
  const [parsedData, setParsedData] = useState<ParsedCsvData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [timeRangeInMs, setTimeRangeInMs] = useState<'all' | number>('all');
  const [viewEndTimestamp, setViewEndTimestamp] = useState<number | null>(null);
  const [channelAnalysis, setChannelAnalysis] = useState<Record<string, ChannelAnalysisState>>({});
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const { fullTimeRange } = useMemo(() => {
    if (!parsedData?.data || parsedData.data.length < 2) {
      return { fullTimeRange: null };
    }
    const sortedData = [...parsedData.data].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const minTimestamp = sortedData[0].timestamp.getTime();
    const maxTimestamp = sortedData[sortedData.length - 1].timestamp.getTime();
    return { fullTimeRange: { min: minTimestamp, max: maxTimestamp } };
  }, [parsedData]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setParsedData(null);
    setTimeRangeInMs('all');
    setViewEndTimestamp(null);
    setChannelAnalysis({});
    setSelectedChannelId(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = (e.target?.result as string) || '';
        const parsed = parseGraphtecCsv(content, file.name);
        setParsedData(parsed);
        if (parsed.channels.length > 0) {
          setSelectedChannelId(parsed.channels[0].id);
        }
      } catch (err: any) {
        setError(err?.message || '파일 처리 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => { setError('파일을 읽는 데 실패했습니다.'); setIsLoading(false); };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleClear = () => {
    setParsedData(null);
    setError(null);
    setTimeRangeInMs('all');
    setViewEndTimestamp(null);
    setChannelAnalysis({});
    setSelectedChannelId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const { yMinMaxPerChannel } = useMemo(() => {
    if (!parsedData?.data || parsedData.data.length === 0) {
      return { yMinMaxPerChannel: [] };
    }

    const minMax: ({ yMin: number; yMax: number } | null)[] = parsedData.channels.map((_, channelIndex) => {
        const yValues = parsedData.data
            .map(d => d.values[channelIndex])
            .filter(v => v !== null && typeof v === 'number') as number[];
        
        if (yValues.length === 0) return null;
        
        let yMin = Math.min(...yValues);
        let yMax = Math.max(...yValues);
        
        if (yMin === yMax) { yMin -= 1; yMax += 1; }

        const yRange = yMax - yMin;
        yMin -= yRange * 0.1;
        yMax += yRange * 0.1;

        return { yMin, yMax };
    });

    return { yMinMaxPerChannel: minMax };
  }, [parsedData]);
  
  const viewMemo = useMemo(() => {
    if (!parsedData?.data || parsedData.data.length === 0 || timeRangeInMs === 'all' || viewEndTimestamp === null) {
      return { filteredData: parsedData?.data || [], currentWindowDisplay: "전체 기간" };
    }
    
    const endTime = viewEndTimestamp;
    const startTime = endTime - timeRangeInMs;

    const dataInWindow = parsedData.data.filter(d => {
        const time = d.timestamp.getTime();
        return time >= startTime && time <= endTime;
    });

    const windowDisplay = `${new Date(startTime).toLocaleString()} ~ ${new Date(endTime).toLocaleString()}`;

    return { filteredData: dataInWindow, currentWindowDisplay: windowDisplay };
  }, [parsedData, timeRangeInMs, viewEndTimestamp]);
  
  const { selectedChannel, selectedChannelIndex } = useMemo(() => {
    if (!parsedData || !selectedChannelId) {
        return { selectedChannel: null, selectedChannelIndex: -1 };
    }
    const index = parsedData.channels.findIndex(c => c.id === selectedChannelId);
    return {
        selectedChannel: index > -1 ? parsedData.channels[index] : null,
        selectedChannelIndex: index,
    };
  }, [parsedData, selectedChannelId]);


  const handleTimeRangeChange = (value: 'all' | number) => {
    setTimeRangeInMs(value);
    if (value === 'all' || !fullTimeRange) {
        setViewEndTimestamp(null);
    } else {
        setViewEndTimestamp(fullTimeRange.max);
    }
  };
  
  const handlePan = useCallback((panAmountMs: number) => {
    if (timeRangeInMs === 'all' || !fullTimeRange || typeof timeRangeInMs !== 'number') return;
    
    setViewEndTimestamp(prev => {
        if (prev === null) return null;
        const newEnd = prev + panAmountMs;
        const minPossibleEnd = fullTimeRange.min + timeRangeInMs;
        const maxPossibleEnd = fullTimeRange.max;
        return Math.max(minPossibleEnd, Math.min(newEnd, maxPossibleEnd));
    });
  }, [timeRangeInMs, fullTimeRange]);

  const handleFinePan = (direction: number) => handlePan(direction * ONE_MINUTE_MS);
  const handleCoarsePan = (direction: number) => {
      if (typeof timeRangeInMs === 'number') handlePan(direction * timeRangeInMs * BIG_PAN_RATIO);
  };

  const handleGoToStart = () => {
    if (fullTimeRange && typeof timeRangeInMs === 'number') setViewEndTimestamp(fullTimeRange.min + timeRangeInMs);
  };
  const handleGoToEnd = () => {
    if (fullTimeRange) setViewEndTimestamp(fullTimeRange.max);
  };
  const handlePreviousChunk = () => handleCoarsePan(-1);
  const handleNextChunk = () => handleCoarsePan(1);
  
  const isAtStart = viewEndTimestamp !== null && fullTimeRange !== null && typeof timeRangeInMs === 'number' && viewEndTimestamp <= fullTimeRange.min + timeRangeInMs;
  const isAtEnd = viewEndTimestamp !== null && fullTimeRange !== null && viewEndTimestamp >= fullTimeRange.max;

  const toggleAnalysisMode = (channelId: string) => {
    setChannelAnalysis(prev => {
      const current = prev[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
      if (current.isAnalyzing) {
        return { ...prev, [channelId]: { ...current, isAnalyzing: false, selection: { start: null, end: null } } };
      }
      return { ...prev, [channelId]: { ...current, isAnalyzing: true, selection: { start: null, end: null } } };
    });
  };
  
  const handleResetAnalysis = (channelId: string) => {
    setChannelAnalysis(prev => ({
        ...prev,
        [channelId]: { isAnalyzing: false, selection: { start: null, end: null }, results: [] }
    }));
  };

  const handlePointSelect = useCallback((channelId: string, point: { timestamp: Date; value: number }) => {
    if (!parsedData) return;
    const channelIndex = parsedData.channels.findIndex(c => c.id === channelId);
    if (channelIndex === -1) return;

    setChannelAnalysis(prev => {
      const state = prev[channelId] || { isAnalyzing: false, selection: { start: null, end: null }, results: [] };
      if (!state.isAnalyzing) return prev;

      if (!state.selection.start) {
        return { ...prev, [channelId]: { ...state, selection: { start: point, end: null } } };
      } else {
        if (state.results.length >= 15) {
          alert("채널당 최대 15개의 분석만 추가할 수 있습니다.");
          return { ...prev, [channelId]: { ...state, selection: { start: null, end: null } } };
        }

        const start = state.selection.start;
        const end = point;
        const [startTime, endTime] = [start.timestamp, end.timestamp].sort((a, b) => a.getTime() - b.getTime());

        const valuesInRange = (parsedData.data || [])
          .filter(d => d.timestamp >= startTime && d.timestamp <= endTime)
          .map(d => d.values[channelIndex])
          .filter(v => v !== null) as number[];

        if (valuesInRange.length < 1) {
          return { ...prev, [channelId]: { ...state, selection: { start: null, end: null } } };
        }
        
        const min = Math.min(...valuesInRange);
        const max = Math.max(...valuesInRange);
        
        const newResult: AnalysisResult = {
            id: self.crypto.randomUUID(), min, max, diff: max - min, startTime, endTime
        };

        return {
          ...prev,
          [channelId]: {
            ...state,
            selection: { start: null, end: null },
            results: [...state.results, newResult]
          }
        };
      }
    });
  }, [parsedData]);

  const getAnalysisButtonText = (state: ChannelAnalysisState | undefined) => {
    if (state?.isAnalyzing) {
        if (state.selection.start) return '끝점 선택...';
        return '분석 중 (종료하려면 클릭)';
    }
    return '범위 분석';
  };

  const timeRangeOptions = [
    { label: '10분', value: 10 * 60 * 1000 },
    { label: '30분', value: 30 * 60 * 1000 },
    { label: '1시간', value: 60 * 60 * 1000 },
    { label: '3시간', value: 3 * 60 * 60 * 1000 },
    { label: '6시간', value: 6 * 60 * 60 * 1000 },
    { label: '12시간', value: 12 * 60 * 60 * 1000 },
    { label: '전체', value: 'all' },
  ] as const;

  const baseButtonClass = "px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500";
  const activeButtonClass = "bg-sky-500 text-white";
  const inactiveButtonClass = "bg-slate-600 hover:bg-slate-500 text-slate-300";

  return (
    <div className="w-full max-w-7xl mx-auto bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">CSV 그래프 (P6)</h2>

      <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 flex flex-col sm:flex-row gap-4">
        <div className="flex-grow">
          <label htmlFor="csv-upload" className="block text-sm font-medium text-slate-300 mb-1">데이터 파일 선택 (CSV, TXT)</label>
          <input ref={fileInputRef} id="csv-upload" type="file" accept=".csv,.txt" onChange={handleFileChange} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-500 file:text-white hover:file:bg-sky-600 disabled:opacity-50" disabled={isLoading} />
        </div>
        <div className="flex-shrink-0 self-end">
          <ActionButton onClick={handleClear} variant="secondary" disabled={isLoading || !parsedData}>초기화</ActionButton>
        </div>
      </div>

      {isLoading && (<div className="flex justify-center items-center py-10"><Spinner /><span className="ml-3 text-slate-300">파일을 분석 중입니다...</span></div>)}
      {error && <p className="text-red-400 text-center p-4 bg-red-900/30 rounded-md">{error}</p>}

      {parsedData && (
        <>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="text-xl font-semibold text-slate-100">그래프 분석: <span className="text-sky-400">{parsedData.fileName}</span></h3>
            <div className="flex items-center space-x-1 sm:space-x-2 bg-slate-700/50 p-1 rounded-lg flex-wrap">
              {timeRangeOptions.map(opt => (<button key={opt.label} onClick={() => handleTimeRangeChange(opt.value)} className={`${baseButtonClass} ${timeRangeInMs === opt.value ? activeButtonClass : inactiveButtonClass}`}>{opt.label}</button>))}
            </div>
          </div>
          {timeRangeInMs !== 'all' && (
            <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
                <ActionButton onClick={handleGoToStart} disabled={isAtStart}>{'<< 맨 앞으로'}</ActionButton>
                <ActionButton onClick={handlePreviousChunk} disabled={isAtStart}>{'< 이전'}</ActionButton>
                <span className="text-slate-300 font-mono bg-slate-900/50 px-3 py-1.5 rounded-md text-xs whitespace-nowrap">{viewMemo.currentWindowDisplay}</span>
                <ActionButton onClick={handleNextChunk} disabled={isAtEnd}>{'다음 >'}</ActionButton>
                <ActionButton onClick={handleGoToEnd} disabled={isAtEnd}>{'맨 뒤로 >>'}</ActionButton>
            </div>
          )}
          
          <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-4 mb-4">
              <h4 className="w-full text-md font-semibold text-slate-200 mb-1">채널 선택:</h4>
              {parsedData.channels.map(channel => (
                <button
                  key={channel.id}
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={`${baseButtonClass} ${selectedChannelId === channel.id ? activeButtonClass : inactiveButtonClass}`}
                >
                  {channel.name} ({channel.id})
                </button>
              ))}
          </div>

          {selectedChannel && selectedChannelIndex !== -1 && (
            <div className="space-y-6">
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h4 className="text-lg font-semibold text-slate-100">{selectedChannel.name} ({selectedChannel.id})</h4>
                            <p className="text-sm text-slate-400">단위: {selectedChannel.unit.replace(/\[|\]/g, '')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {channelAnalysis[selectedChannel.id]?.results && channelAnalysis[selectedChannel.id].results.length > 0 && (
                                <ActionButton
                                    onClick={() => handleResetAnalysis(selectedChannel.id)}
                                    variant="danger"
                                    className="text-xs !py-1.5 !px-2"
                                    title="이 그래프의 모든 분석 결과 지우기"
                                >
                                    분석 초기화
                                </ActionButton>
                            )}
                            <ActionButton
                                onClick={() => toggleAnalysisMode(selectedChannel.id)}
                                variant={channelAnalysis[selectedChannel.id]?.isAnalyzing ? 'primary' : 'secondary'}
                                className="text-xs !py-1.5 !px-3"
                            >
                                {getAnalysisButtonText(channelAnalysis[selectedChannel.id])}
                            </ActionButton>
                        </div>
                    </div>
                    <Graph 
                        data={viewMemo.filteredData || []} 
                        channelIndex={selectedChannelIndex} 
                        channelInfo={selectedChannel} 
                        onPan={handleFinePan} 
                        showMajorTicks={timeRangeInMs !== 'all'} 
                        yMinMaxOverall={yMinMaxPerChannel[selectedChannelIndex]}
                        isAnalyzing={channelAnalysis[selectedChannel.id]?.isAnalyzing || false}
                        onPointSelect={(point) => handlePointSelect(selectedChannel.id, point)}
                        selection={channelAnalysis[selectedChannel.id]?.selection || null}
                        analysisResults={channelAnalysis[selectedChannel.id]?.results || []}
                    />
                </div>
                
                <div>
                    <h4 className="text-lg font-semibold text-slate-100 mb-2">분석 결과 ({channelAnalysis[selectedChannel.id]?.results?.length || 0} / 15)</h4>
                    <div className="overflow-x-auto bg-slate-900/50 rounded-lg border border-slate-700 max-h-96">
                        <table className="min-w-full text-sm text-left">
                            <thead className="bg-slate-700/50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 font-medium text-slate-300">No.</th>
                                    <th className="px-4 py-2 font-medium text-slate-300">시작 시간</th>
                                    <th className="px-4 py-2 font-medium text-slate-300">종료 시간</th>
                                    <th className="px-4 py-2 font-medium text-slate-300 text-right">최대값</th>
                                    <th className="px-4 py-2 font-medium text-slate-300 text-right">최소값</th>
                                    <th className="px-4 py-2 font-medium text-slate-300 text-right">차이</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700">
                                {(channelAnalysis[selectedChannel.id]?.results?.length || 0) > 0 ? (
                                    channelAnalysis[selectedChannel.id].results.map((result, idx) => (
                                        <tr key={result.id} className="hover:bg-slate-800">
                                            <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                                            <td className="px-4 py-2 text-slate-300 whitespace-nowrap">{result.startTime.toLocaleString()}</td>
                                            <td className="px-4 py-2 text-slate-300 whitespace-nowrap">{result.endTime.toLocaleString()}</td>
                                            <td className="px-4 py-2 text-green-400 font-mono text-right">{result.max.toFixed(3)}</td>
                                            <td className="px-4 py-2 text-red-400 font-mono text-right">{result.min.toFixed(3)}</td>
                                            <td className="px-4 py-2 text-sky-400 font-mono text-right">{result.diff.toFixed(3)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="text-center py-4 text-slate-500">
                                            '범위 분석' 버튼을 눌러 구간을 선택하세요.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CsvGraphPage;
