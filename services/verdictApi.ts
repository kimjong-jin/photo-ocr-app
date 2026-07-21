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
 *    응답시간 = ST→EN 시간차(초, CSV에 지정). pH/DO→resp, TU/Cl→resp_sec. ST/EN 없으면 VerdictButton에서 수동 입력(폴백).
 */
export function csvToFields(aiAnalysisResult: Record<string, any> | null | undefined, sensorType: string): Record<string, string> | null {
  const type = String(sensorType).toUpperCase();
  const ai = aiAnalysisResult || {};
  const fields: Record<string, string> = {};
  const put = (key: string, label: string) => {
    const v = ai[label.toLowerCase()]?.value;
    if (v != null && String(v).trim() !== '') fields[key] = String(v);
  };

  // 응답시간 = ST→EN 시간차(초). CsvDisplay와 동일 계산(realTimestamp 우선). ST/EN 미지정 시 null.
  const respSec = (() => {
    const st = ai['st'], en = ai['en'];
    if (!st || !en) return null;
    const stT = new Date(st.realTimestamp || st.timestamp).getTime();
    const enT = new Date(en.realTimestamp || en.timestamp).getTime();
    if (!Number.isFinite(stT) || !Number.isFinite(enT)) return null;
    return Math.round((enT - stT) / 1000);
  })();

  if (type === 'SS' || type === 'TU' || type === 'CL') {
    for (const k of ['z1','z2','z3','z4','z5','z6','z7','s1','s2','s3','s4','s5','s6','s7','m1','m2','m3']) put(k, k);
    put('ci1', '현장1'); put('ci2', '현장2');
    // 먹는물(TU/Cl) 응답시간: 계산기 resp_sec(초 직접). SS는 응답시간 검사 없음.
    if ((type === 'TU' || type === 'CL') && respSec != null) fields.resp_sec = String(respSec);
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
    if (respSec != null) fields.resp = String(respSec);   // 응답시간(초, ≤30) = ST→EN
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
    if (respSec != null) fields.resp = String(respSec);   // 응답시간(초, ≤120) = ST→EN
    return fields;
  }

  return null;   // 그 외 미지원
}

// 접수번호 정규화(전각→반각·하이픈 통일·공백 제거) — P1/P2/P4/P5 저장 키를 동일하게 맞춤.
export function normReceipt(s: string): string {
  return String(s || '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－—–−]/g, '-').replace(/[\s　]/g, '').trim();
}
// 접수번호 → base(앞3파트) + 세부번호(4번째, 없으면 null). 25-000000-01-1 → base '25-000000-01', 세부 1.
export function splitReceipt(receipt: string): { base: string; detailNo: number | null } {
  const norm = normReceipt(receipt);
  const parts = norm.split('-');
  if (parts.length >= 4) {
    const n = parseInt(parts[3], 10);
    return { base: parts.slice(0, 3).join('-'), detailNo: Number.isFinite(n) ? n : null };
  }
  return { base: norm, detailNo: null };
}
// 탭의 세부번호(계산기 subNoOf와 동일): subNo 또는 label 끝번호(CODE-N).
const tabSubNo = (t: any) => Number(t?.subNo) || parseInt(String(t?.label || '').split('-').pop() || '', 10) || 0;

/**
 * 전송 시 우리 측정값을 계산기 calc_data(:3333)에 저장. **우리 전송이 정본** — 고객 계산은 중간 테스트일 뿐.
 * 저장은 항상 base 접수번호(고객 레코드와 병합). 접수번호에 세부번호(-N)가 있으면 그 **슬롯(subNo)**에
 * 우리 항목을 배치 — 고객이 그 슬롯에 다른 항목을 뒀어도 우리 항목으로 **교체**(값·code·label 덮음).
 * 세부번호 없으면 항목코드로 매칭(폴백). range·fdis 등은 항목이 같을 때만 보존.
 * @returns 저장 성공 여부
 */
export async function saveItemToCalcData(p: {
  receiptNo: string; userName: string; siteName?: string;
  code: string; fields: Record<string, any>;
}): Promise<boolean> {
  const { base: receiptNo, detailNo } = splitReceipt(p.receiptNo);
  if (!receiptNo || !p.userName) return false;
  const code = String(p.code).toUpperCase();

  // 1) 기존 calc_data 로드(base 키 — 고객 입력과 병합)
  let data: any = { tabs: [], activeId: '', fields: {}, maxSubNo: 0 };
  let ownerUser = '', ownerSite = '';   // 기존 레코드 소유자(고객) — 있으면 유지(담당자가 항목 추가해도 소유자 안 바뀜)
  try {
    const res = await fetch(`${CALC_API}?receiptNo=${encodeURIComponent(receiptNo)}`);
    if (res.ok) { const d = await res.json(); if (d?.data?.tabs) data = d.data; ownerUser = d?.userName || ''; ownerSite = d?.siteName || ''; }
  } catch { /* 없으면 신규 */ }
  if (!Array.isArray(data.tabs)) data.tabs = [];
  if (!data.fields || typeof data.fields !== 'object') data.fields = {};

  // 2) 탭 선택
  let tab: any;
  let codeChanged = false;
  if (detailNo != null) {
    // 세부번호 슬롯으로 키잉 — 우리 전송이 슬롯의 항목을 정함
    tab = data.tabs.find((t: any) => tabSubNo(t) === detailNo);
    if (tab) {
      if (String(tab.code).toUpperCase() !== code) {   // 고객이 다른 항목을 뒀으면 교체
        tab.code = code; tab.label = `${code}-${detailNo}`; tab.pass = '';
        data.fields[tab.id] = {};                       // 항목 바뀌면 이전(고객) 값 폐기
        codeChanged = true;
      }
    } else {
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      tab = { id, code, label: `${code}-${detailNo}`, pass: '', subNo: detailNo };
      data.tabs.push(tab); data.fields[id] = {};
      data.maxSubNo = Math.max(Number(data.maxSubNo) || 0, detailNo);
    }
    data.tabs.sort((a: any, b: any) => tabSubNo(a) - tabSubNo(b));   // 세부번호 오름차순 표시
    data.activeId = tab.id;
  } else {
    // 세부번호 없음 → 항목코드 매칭(폴백)
    tab = data.tabs.find((t: any) => String(t.code).toUpperCase() === code);
    if (!tab) {
      const subNo = (Number(data.maxSubNo) || data.tabs.length) + 1;
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      tab = { id, code, label: `${code}-${subNo}`, pass: '', subNo };
      data.tabs.push(tab); data.maxSubNo = subNo; data.fields[id] = {};
      if (!data.activeId) data.activeId = id;
    }
  }

  // 3) 우리 값으로 덮기(빈 값은 안 덮음). 항목 교체 시엔 fields가 이미 비워져 순수 우리 값만.
  const merged: Record<string, any> = codeChanged ? {} : { ...(data.fields[tab.id] || {}) };
  for (const [k, v] of Object.entries(p.fields)) if (v != null && String(v).trim() !== '') merged[k] = String(v);
  data.fields[tab.id] = merged;

  // 4) 판정도 계산해 탭에 저장(단일 출처 API). 실패해도 데이터 저장은 진행.
  //    표준용액 정도검사 결과(ok/bad)면 현장계수 큐(field_queue, 31일)에도 요약 저장 — calc_data(10일) 만료 후에도 표시.
  try {
    const vd = await callVerdict(code, merged);
    tab.pass = vd.pass;
    const itemName = CODE_TO_ITEM_NAME[code];
    if (itemName && (vd.pass === 'ok' || vd.pass === 'bad')) {
      storeStdVerdict(receiptNo, itemName, stdSummary(vd));   // best-effort, 존재하는 행만 UPDATE
    }
  } catch { /* 판정은 나중에 계산기에서 */ }

  // 5) 업서트 저장(base 키로 덮어쓰기). 소유자(userName)는 기존 고객 유지, 없으면 담당자(우리) 이름으로 신규.
  try {
    const res = await fetch(CALC_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptNo, userName: ownerUser || p.userName, siteName: ownerSite || p.siteName || '', data, ttlDays: 10 }),
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

// 항목명(한글) ↔ 계산기 code
const ITEM_NAME_TO_CODE: Record<string, string> = {
  '총유기탄소': 'TOC', '총질소': 'TN', '총인': 'TP', '부유물질': 'SS', '화학적산소요구량': 'COD',
};
const CODE_TO_ITEM_NAME: Record<string, string> = {
  TOC: '총유기탄소', TN: '총질소', TP: '총인', SS: '부유물질', COD: '화학적산소요구량',
};

// 정도검사 체크 라벨 → 짧은 약어(반/제드/스드/직/응/온/포). 현장적용계수는 표준용액 요약에서 제외(null).
function shortTestName(label: string): string | null {
  const s = String(label || '');
  if (s.includes('현장적용')) return null;
  if (s.includes('반복성')) return '반';
  if (s.includes('제로드리프트')) return '제드';
  if (s.includes('스팬드리프트')) return '스드';
  if (s.includes('드리프트')) return '드';
  if (s.includes('직선성')) return '직';
  if (s.includes('응답')) return '응';
  if (s.includes('온도')) return '온';
  if (s.includes('포도당')) return '포';
  return null;
}
// 판정 결과 → 표준용액 요약 { pass:'ok'|'bad'|'', failed:[시험명] }. 현장적용 제외한 종합.
export function stdSummary(v: { pass: 'ok' | 'bad' | ''; checks?: { label: string; pass: boolean | null }[] }): { pass: string; failed: string[] } {
  const failed: string[] = []; const seen = new Set<string>();
  for (const c of v.checks || []) {
    const nm = shortTestName(c.label);
    if (nm && c.pass === false && !seen.has(nm)) { seen.add(nm); failed.push(nm); }
  }
  return { pass: v.pass, failed };
}

// 표준용액 요약을 field_queue(31일)에 저장 — 존재하는 행만 UPDATE(신규 생성 안 함). best-effort.
export async function storeStdVerdict(receiptBase: string, itemName: string, summary: { pass: string; failed: string[] }): Promise<void> {
  try {
    await fetch('/api/field-queue?op=std', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt_no: receiptBase, item: itemName, std_verdict: JSON.stringify(summary) }),
    });
  } catch { /* best-effort */ }
}

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

// ── P4(먹는물, DrinkingWaterPage) OCR → 계산기 fields ──────────────────────
// 식별자 Z1~Z5/S1~S5/M/응답. TU=value, Cl=valueTP(같은 행 공유). 먹는물은 z/s/m + resp_sec(초).
const DW_DIVIDERS = new Set(['Z 2시간 시작 - 종료', '드리프트 완료', '반복성 완료']);
function dwIdToKey(id: string): string | null {
  const s = String(id || '').trim().toUpperCase();
  const m = s.match(/^([ZS])([1-5])$/); if (m) return m[1].toLowerCase() + m[2];
  if (s === 'M') return 'm1';
  return null;
}
function parseRespSeconds(v: any): string | null {
  if (v == null || String(v).trim() === '') return null;
  try { const a = JSON.parse(v); if (Array.isArray(a) && a.length) { const s = Number(a[0]); return Number.isFinite(s) ? String(s) : null; } } catch { /* not json */ }
  const n = String(v).match(/-?\d+(?:\.\d+)?/)?.[0];
  return n != null ? n : null;
}
/** P4 먹는물 ocrData → 계산기 fields. which='TU'는 value, 'CL'은 valueTP. 응답→resp_sec(초). */
export function drinkingWaterToFields(ocrData: any[] | null | undefined, which: 'TU' | 'CL'): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const e of ocrData || []) {
    const id = e?.identifier;
    if (!id || DW_DIVIDERS.has(id)) continue;
    const val = which === 'TU' ? e.value : e.valueTP;
    if (String(id).startsWith('응답')) {
      const secs = parseRespSeconds(val);
      if (secs != null) fields.resp_sec = secs;
      continue;
    }
    const key = dwIdToKey(id);
    if (key && val != null && String(val).trim() !== '') fields[key] = String(val).trim();
  }
  return fields;
}

/** P4 전송 성공 시 TU·Cl 측정값을 계산기 calc_data에 저장(우리 분석 우선). selectedItem = TU/CL·TU·Cl. */
export async function saveDrinkingWaterToCalcData(p: {
  receiptNo: string; userName: string; siteName?: string; selectedItem: string; ocrData: any[] | null | undefined;
}): Promise<void> {
  const sel = String(p.selectedItem || '').toUpperCase().replace(/\s/g, '');
  const sides: Array<'TU' | 'CL'> = sel === 'TU/CL' ? ['TU', 'CL'] : sel === 'TU' ? ['TU'] : sel === 'CL' ? ['CL'] : [];
  // MULTI(TU/CL)는 세부 한 개에 두 항목이 못 들어가니 base로 code매칭(별도 탭). 단일은 세부 슬롯 그대로.
  const rcpt = sides.length > 1 ? splitReceipt(p.receiptNo).base : p.receiptNo;
  for (const which of sides) {
    const fields = drinkingWaterToFields(p.ocrData, which);
    if (!Object.keys(fields).length) continue;
    try { await saveItemToCalcData({ receiptNo: rcpt, userName: p.userName, siteName: p.siteName || '', code: which, fields }); } catch { /* best-effort */ }
  }
}

// 측정범위 텍스트("0 ~ 100 mg/L", "100 NTU" 등) → 계산용 range 숫자(최댓값). 못 뽑으면 null.
export function parseRangeValue(text: string | null | undefined): string | null {
  if (!text) return null;
  const nums = String(text).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const max = Math.max(...nums.map(Number).filter(Number.isFinite));
  return Number.isFinite(max) ? String(max) : null;
}

// P1 mainItemKey/항목코드 → 계산 대상 code(들). MULTI 분리. pH/DO는 범위 고정이라 제외.
const ITEMKEY_TO_CALC: Record<string, string[]> = {
  TOC: ['TOC'], TN: ['TN'], TP: ['TP'], COD: ['COD'], SS: ['SS'], TU: ['TU'], CL: ['CL'],
  'TU/CL': ['TU', 'CL'], 'TN/TP': ['TN', 'TP'],
};

/**
 * P1(구조검사) "측정범위확인" → calc_data range 저장. range는 계산(드리프트/반복성 %)에 직접 들어감.
 * 해당 접수번호의 각 항목 탭에 range만 병합(측정값 등 기존값 보존). pH/DO는 범위 고정이라 제외.
 * ⚠️ MULTI(TU/CL·TN/TP)는 단일 범위 문자열을 두 항목에 동일 적용(best-effort) — 단위 다르면 계산기에서 정정.
 */
export async function saveRangeToCalcData(p: {
  receiptNo: string; userName: string; siteName?: string; itemKey: string; rangeText: string;
}): Promise<void> {
  const range = parseRangeValue(p.rangeText);
  if (!range) return;
  const key = String(p.itemKey || '').toUpperCase().replace(/\s/g, '');
  const codes = ITEMKEY_TO_CALC[key];
  if (!codes) return;   // PH/DO 등 제외
  // MULTI는 base로 code매칭(별도 탭), 단일은 세부 슬롯 그대로.
  const rcpt = codes.length > 1 ? splitReceipt(p.receiptNo).base : p.receiptNo;
  for (const code of codes) {
    try {
      await saveItemToCalcData({ receiptNo: rcpt, userName: p.userName, siteName: p.siteName || '', code, fields: { range } });
    } catch { /* best-effort */ }
  }
}

/**
 * 현장계수 행들의 표준용액 정도검사 요약을 계산기 calc_data에서 계산(모달 폴백 — 저장분 없을 때).
 * base 접수번호별로 calc_data 로드→항목 탭 fields→verdict API→ {pass, failed:[약어]}.
 * @returns Map<`${receipt_no}|${item}`, {pass, failed}|null>
 */
export async function computeStandardVerdicts(rows: { receipt_no: string; item: string }[]): Promise<Map<string, { pass: string; failed: string[] }>> {
  const map = new Map<string, { pass: string; failed: string[] }>();
  // base별 calc_data 로드(중복 제거)
  const bases = new Map<string, any>();
  for (const r of rows) {
    const base = splitReceipt(r.receipt_no).base;
    if (!bases.has(base)) bases.set(base, undefined);
  }
  await Promise.all([...bases.keys()].map(async base => {
    try {
      const res = await fetch(`${CALC_API}?receiptNo=${encodeURIComponent(base)}`);
      if (res.ok) { const d = await res.json(); bases.set(base, d?.data || null); }
    } catch { /* skip */ }
  }));
  // 항목별 fields 수집
  const items: { key: string; code: string; fields: Record<string, any> }[] = [];
  for (const r of rows) {
    const code = ITEM_NAME_TO_CODE[r.item];
    if (!code) continue;
    const data = bases.get(splitReceipt(r.receipt_no).base);
    if (!data?.tabs?.length) continue;
    const tab = data.tabs.find((t: any) => String(t.code).toUpperCase() === code);
    if (!tab) continue;
    const fields = data.fields?.[tab.id];
    if (!fields) continue;
    items.push({ key: `${r.receipt_no}|${r.item}`, code, fields });
  }
  if (!items.length) return map;
  try {
    const res = await fetch(VERDICT_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map(i => ({ code: i.code, fields: i.fields })) }),
    });
    const data = await res.json();
    if (data?.results) items.forEach((it, i) => {
      const v = data.results[i];
      if (v && (v.pass === 'ok' || v.pass === 'bad')) map.set(it.key, stdSummary(v));
    });
  } catch { /* 실패 시 빈 맵 */ }
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
