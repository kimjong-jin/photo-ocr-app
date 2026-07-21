// services/verdictApi.ts
// 정도검사 판정 = 계산기(aicalc.work)의 /api/verdict 호출. parser는 계산 로직을 갖지 않는다(단일 출처).
// 고시 개정 시 계산기 엑셀만 갱신 → 이 호출 결과 자동 반영. parser는 손 안 댐.

const VERDICT_API = 'https://aicalc.work/api/verdict';
// 계산기 데이터(접수번호별 fields, range 포함) 조회/저장은 parser의 /api/calc-proxy 경유(있으면). 없으면 aicalc 직접.
const CALC_API = 'https://aicalc.work/api/calcData';

export interface VerdictResult {
  ok: boolean;
  code: string;
  checks: { label: string; value: any; pass: boolean | null }[];
  pass: 'ok' | 'bad' | '';          // 정도검사 종합
  field?: { pass: boolean | null; fi?: number } | null; // 현장적용계수(있을 때)
  error?: string;
}

// P2/P3 OCR 식별자 → 계산기 fields 키. (TP는 P접미사 붙음 → 떼고 동일 키)
function idToKey(id: string | undefined): string | null {
  if (!id) return null;
  let s = String(id).trim().replace(/P$/, '');
  const m = s.match(/^([ZSM])([1-7])$/i);
  if (m) return m[1].toLowerCase() + m[2];   // Z1→z1, S3→s3, M1→m1
  if (s === '현장1') return 'ci1';           // 현장측정값 = Ci (현장적용계수 입력)
  if (s === '현장2') return 'ci2';
  return null;
}

// P2/P3 processedOcrData → 계산기 fields (측정값 부분). range/lab(ai)·resp 등은 별도로 채워야 함.
export function ocrToFields(ocrData: any[] | null | undefined, selectedItem: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const isTP = selectedItem === 'TP';
  for (const e of ocrData || []) {
    const id = isTP ? e.identifierTP : e.identifier;
    const val = isTP ? e.valueTP : e.value;
    const key = idToKey(id);
    if (key && val != null && String(val).trim() !== '') fields[key] = String(val).trim();
  }
  return fields;
}

// 판정 API 호출 (단건)
export async function callVerdict(code: string, fields: Record<string, any>): Promise<VerdictResult> {
  const res = await fetch(VERDICT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `판정 API 오류 (${res.status})`);
  return data as VerdictResult;
}

// 항목명(한글) → 계산기 code
const ITEM_NAME_TO_CODE: Record<string, string> = {
  '총유기탄소': 'TOC', '총질소': 'TN', '총인': 'TP', '부유물질': 'SS', '화학적산소요구량': 'COD',
};

export interface FieldQueueRowLite {
  receipt_no: string; item: string; site_val1: string; site_val2: string; lab_data: string; toc_std: string;
}

/**
 * 현장계수 수분석 행들의 현장적용계수 판정을 계산기 API로 배치 계산.
 * (parser는 계산 안 함 — 현장값+실험실값을 계산기 API에 넘겨 field 결과만 받음)
 * @returns Map<`${receipt_no}|${item}`, {pass, labMean, siteMean, fi, useRate, limit, ...}|null>
 */
export async function computeFieldVerdicts(rows: FieldQueueRowLite[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const items = rows.map(r => {
    const code = ITEM_NAME_TO_CODE[r.item];
    let lab: number[] = [];
    try { const p = JSON.parse(r.lab_data || '[]'); lab = (Array.isArray(p) ? p : (p.labVals || p.vals || [])).map(Number); } catch {}
    if (!code || !lab.length) return null;
    const fields: Record<string, any> = {
      ci1: r.site_val1 || '', ci2: r.site_val2 || '',
      ai1: lab[0] ?? '', ai2: lab[1] ?? '', ai3: lab[2] ?? '', ai4: lab[3] ?? '',
      fdis: r.toc_std || '',
    };
    return { code, fields, _key: `${r.receipt_no}|${r.item}` };
  });
  const valid = items.filter(Boolean) as any[];
  if (!valid.length) return map;
  try {
    const res = await fetch(VERDICT_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: valid.map(v => ({ code: v.code, fields: v.fields })) }),
    });
    const data = await res.json();
    if (data?.results) valid.forEach((v, i) => map.set(v._key, data.results[i]?.field ?? null));
  } catch { /* 실패 시 빈 맵 → 판정 미표시 */ }
  return map;
}

// 계산기 calc_data(접수번호)에서 기존 fields 조회 — range 등 이미 입력된 값 재사용용.
export async function loadCalcFields(receiptNo: string, userName: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${CALC_API}?receiptNo=${encodeURIComponent(receiptNo)}&userName=${encodeURIComponent(userName)}`);
    if (!res.ok) return null;
    const d = await res.json();
    // calc_data.data = { tabs, activeId, fields:{tabId:{...}} } — 첫 탭 fields 반환(단순화)
    const data = d?.data || d;
    if (data?.fields && data?.tabs?.[0]) return data.fields[data.tabs[0].id] || null;
    return null;
  } catch { return null; }
}
