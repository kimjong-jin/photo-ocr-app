import type { ParsedCsvData, ChannelInfo, DataPoint } from '../types/csvGraph';

// ---------- small CSV helper (handles quoted commas) ----------
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

const normalizeHeader = (value: string): string => {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/^"|"$/g, '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
};

const normalizeLoose = (value: string): string => {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/^"|"$/g, '')
    .trim()
    .toUpperCase();
};

const isHeaderLikeTimeValue = (value: string): boolean => {
  const v = normalizeHeader(value);
  return (
    v === 'TIME' ||
    v === 'DATE' ||
    v === 'DATE&TIME' ||
    v === 'DATETIME' ||
    v === 'TIMESTAMP'
  );
};

const parseTimestamp = (timestampStr: string): Date | null => {
  const s = String(timestampStr ?? '').replace(/^"|"$/g, '').trim();
  if (!s) return null;

  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 20000 && serial < 100000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const ms = serial * 24 * 60 * 60 * 1000;
      const dt = new Date(excelEpoch.getTime() + ms);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  let normalized = s
    .replace(/\//g, '-')
    .replace(/\./g, '-')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized
    .replace(/오전\s*/i, 'AM ')
    .replace(/오후\s*/i, 'PM ');

  let dt = new Date(normalized.replace(' ', 'T'));
  if (!isNaN(dt.getTime())) return dt;

  dt = new Date(normalized);
  if (!isNaN(dt.getTime())) return dt;

  // YYYY-MM-DD HH:mm[:ss][.sss][ AM/PM]
  let m = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,6}))?\s*(AM|PM)?$/i
  );
  if (m) {
    let [, yy, mm, dd, hh, mi, ss = '0', frac = '0', ampm] = m;
    let hour = Number(hh);

    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'AM' && hour === 12) hour = 0;
      if (upper === 'PM' && hour < 12) hour += 12;
    }

    dt = new Date(
      Number(yy),
      Number(mm) - 1,
      Number(dd),
      hour,
      Number(mi),
      Number(ss),
      Number(frac.slice(0, 3).padEnd(3, '0'))
    );
    if (!isNaN(dt.getTime())) return dt;
  }

  // YY-MM-DD HH:mm[:ss][.sss][ AM/PM]
  m = normalized.match(
    /^(\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,6}))?\s*(AM|PM)?$/i
  );
  if (m) {
    let [, yy, mm, dd, hh, mi, ss = '0', frac = '0', ampm] = m;
    const fullYear = Number(yy) >= 70 ? 1900 + Number(yy) : 2000 + Number(yy);
    let hour = Number(hh);

    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'AM' && hour === 12) hour = 0;
      if (upper === 'PM' && hour < 12) hour += 12;
    }

    dt = new Date(
      fullYear,
      Number(mm) - 1,
      Number(dd),
      hour,
      Number(mi),
      Number(ss),
      Number(frac.slice(0, 3).padEnd(3, '0'))
    );
    if (!isNaN(dt.getTime())) return dt;
  }

  // HH:mm[:ss][.sss][ AM/PM]
  m = normalized.match(
    /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,6}))?\s*(AM|PM)?$/i
  );
  if (m) {
    let [, hh, mi, ss = '0', frac = '0', ampm] = m;
    let hour = Number(hh);

    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'AM' && hour === 12) hour = 0;
      if (upper === 'PM' && hour < 12) hour += 12;
    }

    const today = new Date();
    dt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hour,
      Number(mi),
      Number(ss),
      Number(frac.slice(0, 3).padEnd(3, '0'))
    );
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
};

const parseNumberCell = (raw: string): number | null => {
  const cleaned = String(raw ?? '')
    .replace(/^"|"$/g, '')
    .trim()
    .replace(/,/g, '')
    .replace(/^\+/, '');

  if (cleaned === '') return null;

  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : null;
};

type ChannelCandidate = ChannelInfo & {
  aliases: string[];
};

export const parseGraphtecCsv = (csvContent: string, fileName: string): ParsedCsvData => {
  const lines = csvContent.split(/\r?\n/);

  const channels: ChannelCandidate[] = [];
  const data: DataPoint[] = [];
  let measurementRange: number | undefined = undefined;

  let state: 'idle' | 'amp' | 'data' = 'idle';
  let dataHeaderCols: string[] = [];
  let ampHeaderFound = false;

  let foundAmpSection = false;
  let foundDataSection = false;
  let sawAnyDataLikeLine = false;
  let firstFailedTimestampValue: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\uFEFF/g, '');
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // span 탐색
    if (measurementRange === undefined) {
      const cols = splitCsvLine(line);
      const spanIndex = cols.findIndex((c) => normalizeLoose(c).includes('SPAN'));
      if (spanIndex !== -1 && spanIndex + 1 < cols.length) {
        const rangeValue = parseFloat(cols[spanIndex + 1]);
        if (!isNaN(rangeValue)) {
          measurementRange = parseFloat(Math.floor(rangeValue).toPrecision(15));
        }
      }
    }

    // 섹션 전환
    if (/^AMP\s*settings/i.test(trimmedLine)) {
      state = 'amp';
      ampHeaderFound = false;
      foundAmpSection = true;
      continue;
    }

    if (/^Data\b/i.test(trimmedLine)) {
      state = 'data';
      foundDataSection = true;
      dataHeaderCols = [];
      continue;
    }

    if (/^Calc\s*settings/i.test(trimmedLine)) {
      state = 'idle';
      continue;
    }

    // AMP settings 파싱
    if (state === 'amp') {
      if (!ampHeaderFound) {
        const lowered = normalizeLoose(trimmedLine);
        if (
          lowered.includes('CH') &&
          (lowered.includes('SIGNALNAME') || lowered.includes('SIGNAL NAME'))
        ) {
          ampHeaderFound = true;
        }
        continue;
      }

      const cols = splitCsvLine(line);
      if (cols.length < 2) continue;

      const rawCh = cols[0]?.trim() || '';
      const signalName = cols[1]?.trim() || '';
      const unit = cols[9]?.trim() || cols[cols.length - 1]?.trim() || '';

      const chMatch = rawCh.match(/^ch\s*(\d+)$/i);
      if (!chMatch) continue;

      const chNum = chMatch[1];
      const chId = `CH${Number(chNum)}`;

      const aliases = [
        chId,
        `Ch${Number(chNum)}`,
        `ch${Number(chNum)}`,
        `CS_${Number(chNum)}`,
        `CS_${String(Number(chNum)).padStart(2, '0')}`,
        signalName,
      ]
        .filter(Boolean)
        .map((v) => v.trim());

      channels.push({
        id: chId,
        name: signalName || chId,
        unit,
        aliases,
      });

      continue;
    }

    // Data 파싱
    if (state === 'data') {
      const cols = splitCsvLine(line);
      if (cols.length === 0) continue;

      // 헤더 찾기
      if (dataHeaderCols.length === 0) {
        const candidateCols = cols.map((h) => h.replace(/"/g, '').trim());
        const normalizedCols = candidateCols.map(normalizeHeader);

        const hasTimeHeader =
          normalizedCols.includes('DATE&TIME') ||
          normalizedCols.includes('DATETIME') ||
          normalizedCols.includes('TIMESTAMP') ||
          (normalizedCols.includes('DATE') && normalizedCols.includes('TIME'));

        if (hasTimeHeader) {
          dataHeaderCols = candidateCols;
        }

        continue;
      }

      sawAnyDataLikeLine = true;

      const normalizedHeaders = dataHeaderCols.map(normalizeHeader);

      const dateTimeIdx = normalizedHeaders.findIndex(
        (h) => h === 'DATE&TIME' || h === 'DATETIME' || h === 'TIMESTAMP'
      );
      const dateIdx = normalizedHeaders.findIndex((h) => h === 'DATE');
      const timeIdx = normalizedHeaders.findIndex((h) => h === 'TIME');

      // 반복 헤더 / 보조 헤더 행 스킵
      if (
        (dateTimeIdx !== -1 && isHeaderLikeTimeValue(String(cols[dateTimeIdx] ?? ''))) ||
        (dateIdx !== -1 &&
          timeIdx !== -1 &&
          isHeaderLikeTimeValue(String(cols[dateIdx] ?? '')) &&
          isHeaderLikeTimeValue(String(cols[timeIdx] ?? '')))
      ) {
        continue;
      }

      let timestamp: Date | null = null;
      let failedValue = '';

      if (dateTimeIdx !== -1 && dateTimeIdx < cols.length) {
        failedValue = String(cols[dateTimeIdx] ?? '');
        timestamp = parseTimestamp(cols[dateTimeIdx]);
      } else if (dateIdx !== -1 && timeIdx !== -1 && dateIdx < cols.length && timeIdx < cols.length) {
        failedValue = `${String(cols[dateIdx] ?? '')} ${String(cols[timeIdx] ?? '')}`.trim();
        timestamp = parseTimestamp(failedValue);
      }

      if (!timestamp) {
        if (failedValue) {
          firstFailedTimestampValue = firstFailedTimestampValue ?? failedValue;
        }
        continue;
      }

      // AMP settings 없을 때 Data 헤더에서 채널 추론
      if (channels.length === 0) {
        normalizedHeaders.forEach((header, idx) => {
          if (
            /^CH\d+$/i.test(header) ||
            /^CS_\d+$/i.test(header) ||
            /^CS_\d{2}$/i.test(header)
          ) {
            const rawHeader = dataHeaderCols[idx]?.trim();
            if (!rawHeader) return;

            channels.push({
              id: rawHeader,
              name: rawHeader,
              unit: '',
              aliases: [
                rawHeader,
                rawHeader.replace(/^CH/i, 'CS_'),
              ].filter(Boolean),
            });
          }
        });
      }

      const values: (number | null)[] = channels.map((ch) => {
        const aliasSet = new Set(
          [ch.id, ch.name, ...(ch.aliases || [])]
            .filter(Boolean)
            .map(normalizeHeader)
        );

        let colIndex = normalizedHeaders.findIndex((h) => aliasSet.has(h));

        if (colIndex === -1) {
          for (let i = 0; i < normalizedHeaders.length; i++) {
            const h = normalizedHeaders[i];

            for (const alias of aliasSet) {
              const chMatch = alias.match(/^CH(\d+)$/);
              const csMatch = alias.match(/^CS_(\d+)$/);

              if (chMatch && h === `CS_${Number(chMatch[1])}`) {
                colIndex = i;
                break;
              }
              if (csMatch && h === `CH${Number(csMatch[1])}`) {
                colIndex = i;
                break;
              }
              if (csMatch && h === `CS_${String(Number(csMatch[1])).padStart(2, '0')}`) {
                colIndex = i;
                break;
              }
            }

            if (colIndex !== -1) break;
          }
        }

        if (colIndex !== -1 && colIndex < cols.length) {
          return parseNumberCell(cols[colIndex]);
        }

        return null;
      });

      data.push({ timestamp, values });
    }
  }

  if (!foundDataSection) {
    throw new Error('Data 섹션을 찾지 못했습니다.');
  }

  if (dataHeaderCols.length === 0) {
    throw new Error('Data 헤더를 찾지 못했습니다. DATE&TIME / DATETIME / TIMESTAMP / DATE+TIME 형식을 확인하세요.');
  }

  if (channels.length === 0) {
    if (foundAmpSection) {
      throw new Error('AMP settings는 찾았지만 채널 행을 읽지 못했습니다. CH 형식 또는 헤더 구조를 확인하세요.');
    }
    throw new Error('채널을 찾지 못했습니다. Data 헤더에 CH1 또는 CS_1 같은 채널 컬럼이 있는지 확인하세요.');
  }

  if (data.length === 0) {
    if (sawAnyDataLikeLine) {
      throw new Error(`데이터 행은 찾았지만 유효한 시간값이 없습니다. 첫 실패값: ${firstFailedTimestampValue ?? '알 수 없음'}`);
    }
    throw new Error('데이터 행을 찾지 못했습니다.');
  }

  const finalChannels: ChannelInfo[] = channels.map(({ id, name, unit }) => ({
    id,
    name,
    unit,
  }));

  return {
    channels: finalChannels,
    data,
    fileName,
    measurementRange,
  };
};
