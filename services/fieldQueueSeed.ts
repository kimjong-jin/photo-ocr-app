/**
 * fieldQueueSeed.ts — P2(수질분석)/P3(현장계수) KTL 전송 시 현장값(측정값1·2)을 현장계수 수분석 큐로 seed.
 *
 * P2·P3 둘 다 '현장'이고, 둘 중 최신 전송이 큐의 현장값을 갱신한다(백엔드 upsert가 COALESCE 보존).
 * ⚠️ KTL/Claydox 전송 코드(claydoxApiService)는 안 건드림 — 전송 성공 직후 별도로 이 함수만 호출.
 * 매칭키 = base 접수번호 + 항목명. -N(항목순번)은 안 씀.
 */
import type { ExtractedEntry } from '../shared/types';
import { ocrToFields, saveItemToCalcData, splitReceipt } from './verdictApi';

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
      if (e.identifierTP === '현장1P') v1 = (e.valueTP ?? '').trim();
      if (e.identifierTP === '현장2P') v2 = (e.valueTP ?? '').trim();
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
    const receipt_no = normalizeReceiptBase(args.receiptNumber);
    if (!receipt_no) return; // 접수번호 없으면 그냥 제외
    const week_key = currentWeekKey();
    const entries = items.map(item => {
      const { v1, v2 } = siteVals(item, args.ocrData);
      return {
        receipt_no, item, site_name: args.siteName || '', manager: args.userName || '',
        site_val1: v1, site_val2: v2,
        toc_std: item === '총유기탄소' ? (args.tocStd || '') : '',
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
