/**
 * fieldQueueSeed.ts — P2(수질분석)/P3(현장계수) KTL 전송 시 현장값(측정값1·2)을 현장계수 수분석 큐로 seed.
 *
 * P2·P3 둘 다 '현장'이고, 둘 중 최신 전송이 큐의 현장값을 갱신한다(백엔드 upsert가 COALESCE 보존).
 * ⚠️ KTL/Claydox 전송 코드(claydoxApiService)는 안 건드림 — 전송 성공 직후 별도로 이 함수만 호출.
 * 매칭키 = base 접수번호 + 항목명. -N(항목순번)은 안 씀.
 */
import type { ExtractedEntry } from '../shared/types';
import { ocrToFields, saveItemToCalcData, splitReceipt, loadCalcFields } from './verdictApi';

// selectedItem 코드 → 큐 항목명(들). PH/DO 등은 대상 아님(매핑에 없으면 skip).
const CODE_TO_ITEMS: Record<string, string[]> = {
  TOC: ['총유기탄소'],
  TN: ['총질소'],
  TP: ['총인'],
  COD: ['화학적산소요구량'],
  SS: ['부유물질'],
  'TN/TP': ['총질소', '총인'], // MULTI → 두 행
};

// 접수번호 정규화: 전각→반각·하이픈 통일·공백 제거. (⚠️ -N 잘라내지 않음 — 세부번호 보존)
export function normalizeReceiptBase(str: string): string {
  if (!str) return '';
  let s = str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  s = s.replace(/[－—–−]/g, '-').replace(/[\s 　]/g, '');
  return s.trim();
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 오늘 기준 그 주(월~일) 주차 키 — 모달 weekKeyOf와 동일 포맷 */
export function currentWeekKey(now = new Date()): string {
  const mon = new Date(now); const w = mon.getDay();
  mon.setDate(mon.getDate() + (w === 0 ? -6 : 1 - w)); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  return `${fmt(mon)}~${fmt(sun)}`;
}

// 항목별 현장값(측정값1/2) 추출. 총인(TP)은 valueTP/현장1P·현장2P, 나머지는 value/현장1·현장2.
function siteVals(item: string, ocrData: ExtractedEntry[] | null | undefined): { v1: string; v2: string } {
  const isTP = item === '총인';
  let v1 = '', v2 = '';
  for (const e of ocrData || []) {
    if (isTP) {
      // 총인 현장값(Claydox 전송 기준):
      //  · MULTI(TN/TP): identifierTP='현장1P'(P붙음) → valueTP. 이 행의 일반 value는 TN값이므로 절대 안 가져옴.
      //  · 단독 TP: identifierTP 없음, identifier='현장1' → value(여기에 TP값이 들어옴).
      // 판별은 identifierTP '존재 여부'로 (valueTP가 비어도 MULTI면 TN값으로 폴백 금지).
      if (e.identifierTP === '현장1P') { const t = (e.valueTP ?? '').trim(); if (t) v1 = t; }
      else if (!e.identifierTP && e.identifier === '현장1') { const t = (e.value ?? '').trim(); if (t) v1 = t; }
      if (e.identifierTP === '현장2P') { const t = (e.valueTP ?? '').trim(); if (t) v2 = t; }
      else if (!e.identifierTP && e.identifier === '현장2') { const t = (e.value ?? '').trim(); if (t) v2 = t; }
    } else {
      if (e.identifier === '현장1') v1 = (e.value ?? '').trim();
      if (e.identifier === '현장2') v2 = (e.value ?? '').trim();
    }
  }
  return { v1, v2 };
}

export interface SeedArgs {
  receiptNumber: string;
  selectedItem: string;   // TOC/TN/TP/COD/SS/TN/TP/PH/DO...
  ocrData: ExtractedEntry[] | null | undefined;
  userName: string;       // 담당자
  siteName: string;       // 업체/현장명
  tocStd?: string;        // TOC 배출기준(있으면)
}

/**
 * 전송 성공 직후 호출. 현장값이 있는 항목만 큐에 upsert.
 * 실패해도 전송 자체엔 영향 없도록 조용히 삼킨다(throw 안 함).
 */
export async function seedFieldQueueFromSend(args: SeedArgs): Promise<void> {
  try {
    const items = CODE_TO_ITEMS[args.selectedItem];
    if (!items) return; // PH/DO 등 대상 아님
    const full = normalizeReceiptBase(args.receiptNumber);
    if (!full) return; // 접수번호 없으면 그냥 제외
    // 큐는 base 접수번호로 묶는다(26-047538-01 아래 TOC/TN/TP 한 줄). 세부번호(-1/-2/-3)는 detail에 보존.
    const _p = full.split('-');
    const receipt_no = _p.length >= 4 ? _p.slice(0, 3).join('-') : full;
    const detail = full;
    const week_key = currentWeekKey();
    // 배출기준(TOC): 이번 세션 P1값 우선 → 없으면 calc_data(P1이 전날 저장한 DB)에서 fdis 로드.
    // field_queue.toc_std(31일)에 남겨 나중에 현장적용계수 계산에 씀. P1/P2 세션 달라도 이어짐.
    let tocStd = args.tocStd || '';
    if (!tocStd && items.includes('총유기탄소')) {
      try { const cf = await loadCalcFields(args.receiptNumber, args.userName, 'TOC'); if (cf?.fdis) tocStd = String(cf.fdis); } catch { /* best-effort */ }
    }
    const entries = items.map(item => {
      const { v1, v2 } = siteVals(item, args.ocrData);
      return {
        receipt_no, item, detail, site_name: args.siteName || '', manager: args.userName || '',
        site_val1: v1, site_val2: v2,
        toc_std: item === '총유기탄소' ? tocStd : '',
        week_key,
      };
    }).filter(e => e.site_val1 || e.site_val2); // 현장값 하나도 없으면 seed 안 함
    if (!entries.length) return;
    await fetch('/api/field-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
  } catch (e) {
    console.warn('[field-seed] 큐 seed 실패(전송엔 영향 없음):', e);
  }
}

// selectedItem 코드 → 계산기 저장 대상 code(들). MULTI(TN/TP)는 두 탭으로 저장. PH/DO 등은 대상 아님.
const CODE_TO_CALC: Record<string, string[]> = {
  TOC: ['TOC'], TN: ['TN'], TP: ['TP'], COD: ['COD'], SS: ['SS'], 'TN/TP': ['TN', 'TP'],
};

/**
 * P5(CSV) 전송 시 현장값(현장1/현장2) → 현장계수 수분석 큐(field_queue) seed. **SS 만** (SS만 현장1/2 존재).
 * aiAnalysisResult 키는 소문자('현장1','현장2'), 값 `.value`. 여러번 전송 시 마지막 non-empty가 덮어씀(upsert).
 * 계산은 여기서 안 함 — 현장계수 수분석에서 수분석 카톡 오면 계산.
 */
export async function seedFieldQueueFromCsv(args: {
  receiptNumber: string; sensorType: string; aiAnalysisResult: any; userName: string; siteName: string;
}): Promise<void> {
  try {
    if (String(args.sensorType || '').toUpperCase() !== 'SS') return;   // SS만
    const full = normalizeReceiptBase(args.receiptNumber);
    if (!full) return;
    // base로 묶고 세부는 detail 보존 (seedFieldQueueFromSend와 동일 규칙)
    const _p = full.split('-');
    const receipt_no = _p.length >= 4 ? _p.slice(0, 3).join('-') : full;
    const detail = full;
    const ai = args.aiAnalysisResult || {};
    const v1 = String(ai['현장1']?.value ?? '').trim();
    const v2 = String(ai['현장2']?.value ?? '').trim();
    if (!v1 && !v2) return;
    await fetch('/api/field-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{
        receipt_no, item: '부유물질', detail, site_name: args.siteName || '', manager: args.userName || '',
        site_val1: v1, site_val2: v2, week_key: currentWeekKey(),
      }] }),
    });
  } catch (e) { console.warn('[field-seed:P5] 실패(전송엔 영향 없음):', e); }
}

/**
 * P2/P3 전송 성공 직후 호출 — 우리 값(전체 OCR)을 계산기 calc_data(:3333)에 자동 저장.
 * P2(수질)=측정값(z/s/m + 현장 ci), P3(현장계수)=현장값만(ci1/ci2). ocrToFields가 식별자에서 해당 필드만 추출.
 * "우리 전송이 정본": 세부번호 슬롯의 항목을 우리 값으로 덮음(saveItemToCalcData). MULTI 외 항목은 대상 아님.
 */
export async function saveCalcDataFromSend(args: SeedArgs): Promise<void> {
  try {
    const codes = CODE_TO_CALC[args.selectedItem];
    if (!codes) return;
    const receipt_no = normalizeReceiptBase(args.receiptNumber);
    if (!receipt_no) return;
    // MULTI(TN/TP)는 세부 슬롯 하나에 두 항목이 못 들어가니 base로 code매칭(별도 탭). 단일은 세부번호 슬롯 그대로.
    const rcpt = codes.length > 1 ? splitReceipt(receipt_no).base : receipt_no;
    for (const code of codes) {
      const fields: Record<string, any> = ocrToFields(args.ocrData as any, code);
      if (code === 'TOC' && args.tocStd) fields.fdis = args.tocStd;   // 배출기준 → 현장적용계수 판정용
      if (!Object.keys(fields).length) continue;                      // 매핑되는 측정값 없으면 skip
      await saveItemToCalcData({
        receiptNo: rcpt, userName: args.userName || '', siteName: args.siteName || '', code, fields,
      });
    }
  } catch (e) {
    console.warn('[calc-save] 전송 calc_data 저장 실패(전송엔 영향 없음):', e);
  }
}
