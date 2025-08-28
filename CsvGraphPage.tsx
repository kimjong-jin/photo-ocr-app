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
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({ data, channelIndex, channelInfo, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const handleMouseLeave = () => setMousePosition(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;

    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
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

    const yValues = channelData.map((d) => d.value);
    let yMin = Math.min(...yValues);
    let yMax = Math.max(...yValues);
    const yRange = yMax - yMin || 1;
    yMin -= yRange * 0.1;
    yMax += yRange * 0.1;

    const mapX = (ts: number) => padding.left + ((ts - minTimestamp) / (maxTimestamp - minTimestamp)) * graphWidth;
    const mapY = (val: number) => padding.top + graphHeight - ((val - yMin) / (yMax - yMin)) * graphHeight;

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

    if (
      mousePosition &&
      mousePosition.x > padding.left &&
      mousePosition.x < width - padding.right &&
      mousePosition.y > padding.top &&
      mousePosition.y < height - padding.bottom
    ) {
      let closestIndex = -1;
      let minDistance = Infinity;
      const timeAtMouse = minTimestamp + ((mousePosition.x - padding.left) / graphWidth) * (maxTimestamp - minTimestamp);
      channelData.forEach((d, i) => {
        const distance = Math.abs(d.timestamp.getTime() - timeAtMouse);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
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
  }, [data, channelIndex, channelInfo, width, height, mousePosition]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
    />
  );
};

const Graph: React.FC<{ data: DataPoint[]; channelIndex: number; channelInfo: ChannelInfo }> = ({ data, channelIndex, channelInfo }) => {
  const { ref, width, height } = useResizeObserver();
  return (
    <div ref={ref} className="w-full h-80 relative">
      <GraphCanvas data={data} channelIndex={channelIndex} channelInfo={channelInfo} width={width} height={height} />
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

const CsvGraphPage: React.FC = () => {
  const [parsedData, setParsedData] = useState<ParsedCsvData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [timeRangeInMs, setTimeRangeInMs] = useState<'all' | number>('all');
  const [timeChunkIndex, setTimeChunkIndex] = useState(0);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setParsedData(null);
    setTimeRangeInMs('all');
    setTimeChunkIndex(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = (e.target?.result as string) || '';
        const parsed = parseGraphtecCsv(content, file.name);
        setParsedData(parsed);
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
    setTimeChunkIndex(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const { filteredData, maxChunks, currentWindowDisplay } = useMemo(() => {
    if (!parsedData?.data || parsedData.data.length === 0) {
      return { filteredData: [], maxChunks: 0, currentWindowDisplay: "" };
    }
    
    if (timeRangeInMs === 'all') {
      return { filteredData: parsedData.data, maxChunks: 1, currentWindowDisplay: "전체 기간" };
    }

    const sortedData = [...parsedData.data].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const minTimestamp = sortedData[0].timestamp.getTime();
    const maxTimestamp = sortedData[sortedData.length - 1].timestamp.getTime();
    const totalDuration = maxTimestamp - minTimestamp;
    const maxChunks = totalDuration > 0 ? Math.ceil(totalDuration / timeRangeInMs) : 1;

    const endTime = maxTimestamp - (timeChunkIndex * timeRangeInMs);
    const startTime = endTime - timeRangeInMs;

    const dataInWindow = parsedData.data.filter(d => {
        const time = d.timestamp.getTime();
        return time >= startTime && time < endTime;
    });

    const windowDisplay = `${new Date(startTime).toLocaleString()} ~ ${new Date(endTime).toLocaleString()}`;

    return { filteredData: dataInWindow, maxChunks, currentWindowDisplay: windowDisplay };
  }, [parsedData, timeRangeInMs, timeChunkIndex]);

  const handleTimeRangeChange = (value: 'all' | number) => {
    setTimeRangeInMs(value);
    setTimeChunkIndex(0);
  };
  const handlePreviousChunk = () => setTimeChunkIndex(prev => Math.min(prev + 1, maxChunks - 1));
  const handleNextChunk = () => setTimeChunkIndex(prev => Math.max(0, prev - 1));

  const timeRangeOptions = [
    { label: '10분', value: 10 * 60 * 1000 },
    { label: '30분', value: 30 * 60 * 1000 },
    { label: '1시간', value: 60 * 60 * 1000 },
    { label: '4시간', value: 4 * 60 * 60 * 1000 },
    { label: '6시간', value: 6 * 60 * 60 * 1000 },
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
            <div className="flex items-center space-x-2 bg-slate-700/50 p-1 rounded-lg">
              <span className="text-xs text-slate-400 font-medium px-2">시간 범위:</span>
              {timeRangeOptions.map(opt => (<button key={opt.label} onClick={() => handleTimeRangeChange(opt.value)} className={`${baseButtonClass} ${timeRangeInMs === opt.value ? activeButtonClass : inactiveButtonClass}`}>{opt.label}</button>))}
            </div>
          </div>
          {timeRangeInMs !== 'all' && (
            <div className="flex items-center justify-center gap-3 text-sm">
                <ActionButton onClick={handlePreviousChunk} disabled={timeChunkIndex >= maxChunks - 1}>{'< 이전'}</ActionButton>
                <span className="text-slate-300 font-mono bg-slate-900/50 px-3 py-1.5 rounded-md text-xs">{currentWindowDisplay}</span>
                <ActionButton onClick={handleNextChunk} disabled={timeChunkIndex <= 0}>{'다음 >'}</ActionButton>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {parsedData.channels.map((channel, index) => (
              <div key={channel.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                <h4 className="text-lg font-semibold text-slate-100">{channel.name} ({channel.id})</h4>
                <p className="text-sm text-slate-400 mb-2">단위: {channel.unit.replace(/\[|\]/g, '')}</p>
                <Graph data={filteredData || []} channelIndex={index} channelInfo={channel} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CsvGraphPage;
