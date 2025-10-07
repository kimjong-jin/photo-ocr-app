import type { ParsedCsvData, ChannelInfo, DataPoint } from '../types/CsvGraph';

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


export const parseGraphtecCsv = (csvContent: string, fileName: string): ParsedCsvData => {
  const lines = csvContent.split(/\r?\n/);
  const channels: ChannelInfo[] = [];
  const data: DataPoint[] = [];
  let measurementRange: number | undefined = undefined;

  let state: 'idle' | 'amp' | 'data' = 'idle';
  let dataHeaderCols: string[] = [];
  let ampHeaderFound = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\uFEFF/g, '');
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (state === 'idle' && measurementRange === undefined) {
        const cols = splitCsvLine(line);
        const spanIndex = cols.findIndex(c => c.toLowerCase().includes('span'));
        if (spanIndex !== -1 && spanIndex + 1 < cols.length) {
            const rangeValue = parseFloat(cols[spanIndex + 1]);
            if (!isNaN(rangeValue)) {
                measurementRange = parseFloat(Math.floor(rangeValue).toPrecision(15));
            }
        }
    }

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

  return { channels, data, fileName, measurementRange };
};
