import React, { useState, useCallback, useRef, useEffect } from 'react';
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

    // Fallback for older browsers where ResizeObserver may be undefined
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
    // Fit canvas to CSS size and scale for HiDPI
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

    // Prepare channel data (filter nulls, ensure time order)
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
    if (minTimestamp === maxTimestamp) maxTimestamp = minTimestamp + 1; // avoid divide-by-zero

    const yValues = channelData.map((d) => d.value);
    let yMin = Math.min(...yValues);
    let yMax = Math.max(...yValues);
    const yRange = yMax - yMin || 1;
    yMin -= yRange * 0.1;
    yMax += yRange * 0.1;

    const mapX = (ts: number) => padding.left + ((ts - minTimestamp) / (maxTimestamp - minTimestamp)) * graphWidth;
    const mapY = (val: number) => padding.top + graphHeight - ((val - yMin) / (yMax - yMin)) * graphHeight;

    // Grid & labels
    ctx.strokeStyle = '#334155'; // slate-700
    ctx.fillStyle = '#94a3b8'; // slate-400
    ctx.font = '10px Inter, system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", sans-serif';
    ctx.lineWidth = 1;

    // Y-axis grid
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

    // X-axis grid
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

    // Data line
    ctx.strokeStyle = '#38bdf8'; // sky-500
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    channelData.forEach((d, i) => {
      const x = mapX(d.timestamp.getTime());
      const y = mapY(d.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Tooltip / crosshair
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

        // Vertical line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + graphHeight);
        ctx.stroke();

        // Circle on point
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Tooltip
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

// ---------- Parser for Graphtec-like CSV ----------
const parseGraphtecCsv = (csvContent: string, fileName: string): ParsedCsvData => {
  const lines = csvContent.split(/\r?\n/);
  const channels: ChannelInfo[] = [];
  const data: DataPoint[] = [];

  let state: 'idle' | 'amp' | 'data' = 'idle';
  let dataHeaderCols: string[] = [];
  let ampHeaderFound = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\uFEFF/g, ''); // strip BOM if present
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // section switches
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
        if (trimmedLine.startsWith('CH,Signal name')) ampHeaderFound = true;
      } else {
        const cols = splitCsvLine(line);
        if (cols[0]?.startsWith('CH') && !isNaN(parseInt(cols[0].substring(2))) && cols.length > 9) {
          channels.push({ id: cols[0], name: cols[1], unit: cols[9] });
        }
      }
    } else if (state === 'data') {
      if (dataHeaderCols.length === 0 && trimmedLine.includes('Date&Time')) {
        dataHeaderCols = splitCsvLine(trimmedLine);
      } else if (dataHeaderCols.length > 0) {
        // heuristic: data rows often start with index number; don't strictly require it
        const cols = splitCsvLine(line);
        const timeColIndex = dataHeaderCols.indexOf('Date&Time');
        if (timeColIndex === -1 || timeColIndex >= cols.length) continue;

        const timestampStr = cols[timeColIndex];
        // Normalize common formats (e.g., 2025/08/28 12:34:56.789)
        const normalized = timestampStr
          .replace(/\//g, '-')
          .replace(/\s+/, 'T');
        const timestamp = new Date(normalized);
        if (isNaN(timestamp.getTime())) continue;

        const values: (number | null)[] = [];
        channels.forEach((ch) => {
          const colIndex = dataHeaderCols.indexOf(ch.id);
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
    throw new Error('CSV 파일 형식이 올바르지 않거나 지원되지 않는 형식입니다. (AMP settings/Data 섹션 확인)');
  }

  return { channels, data, fileName };
};

// ---------- Page ----------
const CsvGraphPage: React.FC = () => {
  const [parsedData, setParsedData] = useState<ParsedCsvData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setParsedData(null);

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
    reader.onerror = () => {
      setError('파일을 읽는 데 실패했습니다.');
      setIsLoading(false);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleClear = () => {
    setParsedData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full max-w-7xl mx-auto bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">CSV 그래프 (P6)</h2>

      <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 flex flex-col sm:flex-row gap-4">
        <div className="flex-grow">
          <label htmlFor="csv-upload" className="block text-sm font-medium text-slate-300 mb-1">
            데이터 파일 선택 (CSV, TXT)
          </label>
          <input
            ref={fileInputRef}
            id="csv-upload"
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-500 file:text-white hover:file:bg-sky-600 disabled:opacity-50"
            disabled={isLoading}
          />
        </div>
        <div className="flex-shrink-0 self-end">
          <ActionButton onClick={handleClear} variant="secondary" disabled={isLoading || !parsedData}>
            초기화
          </ActionButton>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Spinner />
          <span className="ml-3 text-slate-300">파일을 분석 중입니다...</span>
        </div>
      )}
      {error && <p className="text-red-400 text-center p-4 bg-red-900/30 rounded-md">{error}</p>}

      {parsedData && (
        <>
          <h3 className="text-xl font-semibold text-slate-100">
            그래프 분석: <span className="text-sky-400">{parsedData.fileName}</span>
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {parsedData.channels.map((channel, index) => (
              <div key={channel.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                <h4 className="text-lg font-semibold text-slate-100">
                  {channel.name} ({channel.id})
                </h4>
                <p className="text-sm text-slate-400 mb-2">단위: {channel.unit.replace(/\[|\]/g, '')}</p>
                <Graph data={parsedData.data} channelIndex={index} channelInfo={channel} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CsvGraphPage;
