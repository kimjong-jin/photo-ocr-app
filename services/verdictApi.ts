// services/verdictApi.ts
// 정도검사 판정 = 계산기(aicalc.work)의 /api/verdict 호출. parser는 계산 로직을 갖지 않는다(단일 출처).
// 고시 개정 시 계산기 엑셀만 갱신 → 이 호출 결과 자동 반영. parser는 손 안 댐.

const VERDICT_API = 'https://aicalc.work/api/verdict';
// 계산기 calc_data(접수번호별 fields/tabs) 조회·저장은 parser의 /api/calc-data 프록시 경유(→ Mac Studio :3333 /api/calc).
const CALC_API = '/api/calc-data';

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

/**
 * P5(CsvGraphPage) aiAnalysisResult → 계산기 fields. aiAnalysisResult 키는 label.toLowerCase(), 값 = {value}.
 *
 * 매핑 근거 = 계산기 precision-ui.js 필드 정의(반복성/드리프트/직선성/온도보상)와 P5 라벨 구조 1:1 대조.
 *  · SS·TU·Cl(기본형/먹는물): z/s/m 직결 + 현장1→ci1, 현장2→ci2
 *  · pH: (A)=직선성(pH4·7·10 ×3) / (B)=반복성(7,4,7,4,7,4) / (C)=드리프트(7블록=제로, 4블록=스팬) / 4_T=온도보상
 *  · DO: (A)_S=반복성 / Z_=제로드리프트 / S_=스팬드리프트 / 20_S·30_S=온도보상
 *    ※ 드리프트 초기/최종: P5 관례상 "앞3=최종(2h)·뒤3=초기" (현장 확인). 판정은 |최종−초기|라 순서 무관하나 라벨은 정확히.
 *    pH·DO 응답시간은 P5 그래프에 없어 별도 입력(VerdictButton) → 미입력 시 종합은 '미완성', 개별 시험은 표시됨.
 */
export function csvToFields(aiAnalysisResult: Record<string, any> | null | undefined, sensorType: string): Record<string, string> | null {
  const type = String(sensorType).toUpperCase();
  const ai = aiAnalysisResult || {};
  const fields: Record<string, string> = {};
  const put = (key: string, label: string) => {
    const v = ai[label.toLowerCase()]?.value;
    if (v != null && String(v).trim() !== '') fields[key] = String(v);
  };

  if (type === 'SS' || type === 'TU' || type === 'CL') {
    for (const k of ['z1','z2','z3','z4','z5','z6','z7','s1','s2','s3','s4','s5','s6','s7','m1','m2','m3']) put(k, k);
    put('ci1', '현장1'); put('ci2', '현장2');
    return fields;
  }

  if (type === 'PH') {
    // 직선성 (A) — pH4·7·10 각 3회
    put('phm4a', '(A)_4_1'); put('phm4b', '(A)_4_2'); put('phm4c', '(A)_4_3');
    put('phm7a', '(A)_7_1'); put('phm7b', '(A)_7_2'); put('phm7c', '(A)_7_3');
    put('phm10a', '(A)_10_1'); put('phm10b', '(A)_10_2'); put('phm10c', '(A)_10_3');
    // 반복성 (B) — pH7 3회 + pH4 3회
    put('ph7a', '(B)_7_1'); put('ph7b', '(B)_7_2'); put('ph7c', '(B)_7_3');
    put('ph4a', '(B)_4_1'); put('ph4b', '(B)_4_2'); put('ph4c', '(B)_4_3');
    // 드리프트 (C) — 7블록=제로(pH7), 4블록=스팬(pH4). 앞3=최종(2h), 뒤3=초기.
    put('phzf1', '(C)_7_1'); put('phzf2', '(C)_7_2'); put('phzf3', '(C)_7_3');
    put('phzi1', '(C)_7_4'); put('phzi2', '(C)_7_5'); put('phzi3', '(C)_7_6');
    put('phsf1', '(C)_4_1'); put('phsf2', '(C)_4_2'); put('phsf3', '(C)_4_3');
    put('phsi1', '(C)_4_4'); put('phsi2', '(C)_4_5'); put('phsi3', '(C)_4_6');
    // 온도보상 — pH4 버퍼 10~30℃
    put('pht10', '4_10'); put('pht15', '4_15'); put('pht20', '4_20'); put('pht25', '4_25'); put('pht30', '4_30');
    return fields;
  }

  if (type === 'DO') {
    put('dos1', '(A)_S1'); put('dos2', '(A)_S2'); put('dos3', '(A)_S3');   // 반복성(S 3회)
    // 제로드리프트 Z_ / 스팬드리프트 S_ — 앞3=최종(2h), 뒤3=초기
    put('dozf1', 'Z_1'); put('dozf2', 'Z_2'); put('dozf3', 'Z_3');
    put('dozi1', 'Z_4'); put('dozi2', 'Z_5'); put('dozi3', 'Z_6');
    put('dosf1', 'S_1'); put('dosf2', 'S_2'); put('dosf3', 'S_3');
    put('dosi1', 'S_4'); put('dosi2', 'S_5'); put('dosi3', 'S_6');
    // 온도보상 20℃·30℃ 각 3회
    put('dot20a', '20_S_1'); put('dot20b', '20_S_2'); put('dot20c', '20_S_3');
    put('dot30a', '30_S_1'); put('dot30b', '30_S_2'); put('dot30c', '30_S_3');
    return fields;
  }

  return null;   // 그 외 미지원
}

/**
 * 전송(P2/P5) 시 우리 측정값을 계산기 calc_data(:3333, 접수번호)에 자동 저장.
 * 같은 접수번호의 해당 항목(code) 탭에 우리 값을 덮어씀(우리 분석 우선). 다른 항목 탭·range 등은 보존.
 * @returns 저장 성공 여부
 */
export async function saveItemToCalcData(p: {
  receiptNo: string; userName: string; siteName?: string;
  code: string; fields: Record<string, any>;
}): Promise<boolean> {
  if (!p.receiptNo || !p.userName) return false;
  const code = String(p.code).toUpperCase();

  // 1) 기존 calc_data 로드(있으면 병합 대상)
  let data: any = { tabs: [], activeId: '', fields: {}, maxSubNo: 0 };
  try {
    const res = await fetch(`${CALC_API}?receiptNo=${encodeURIComponent(p.receiptNo)}`);
    if (res.ok) { const d = await res.json(); if (d?.data?.tabs) data = d.data; }
  } catch { /* 없으면 신규 */ }
  if (!Array.isArray(data.tabs)) data.tabs = [];
  if (!data.fields || typeof data.fields !== 'object') data.fields = {};

  // 2) 같은 code 탭 찾기 / 없으면 생성
  let tab = data.tabs.find((t: any) => String(t.code).toUpperCase() === code);
  if (!tab) {
    const subNo = (Number(data.maxSubNo) || data.tabs.length) + 1;
    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    tab = { id, code, label: `${code}-${subNo}`, pass: '', subNo };
    data.tabs.push(tab); data.maxSubNo = subNo; data.fields[id] = {};
    if (!data.activeId) data.activeId = id;
  }

  // 3) 우리 값으로 덮기(빈 값은 안 덮음 → 기존 range/fdis 보존)
  const merged: Record<string, any> = { ...(data.fields[tab.id] || {}) };
  for (const [k, v] of Object.entries(p.fields)) if (v != null && String(v).trim() !== '') merged[k] = String(v);
  data.fields[tab.id] = merged;

  // 4) 판정도 계산해 탭에 저장(단일 출처 API). 실패해도 데이터 저장은 진행.
  try { const vd = await callVerdict(code, merged); tab.pass = vd.pass; } catch { /* 판정은 나중에 계산기에서 */ }

  // 5) 업서트 저장(덮어쓰기)
  try {
    const res = await fetch(CALC_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptNo: p.receiptNo, userName: p.userName, siteName: p.siteName || '', data, ttlDays: 10 }),
    });
    return res.ok;
  } catch { return false; }
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
export async function loadCalcFields(receiptNo: string, userName: string, code?: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${CALC_API}?receiptNo=${encodeURIComponent(receiptNo)}`);
    if (!res.ok) return null;
    const d = await res.json();
    // calc_data.data = { tabs, activeId, fields:{tabId:{...}} }
    const data = d?.data || d;
    if (!data?.tabs?.length || !data?.fields) return null;
    // code 지정 시 해당 항목 탭, 없으면 activeId/첫 탭
    const want = code ? String(code).toUpperCase() : null;
    const tab = (want && data.tabs.find((t: any) => String(t.code).toUpperCase() === want))
      || data.tabs.find((t: any) => t.id === data.activeId)
      || data.tabs[0];
    return tab ? (data.fields[tab.id] || null) : null;
  } catch { return null; }
}
