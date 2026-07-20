/**
 * fieldApplication.ts — 현장적용계수시험 적합/부적합 판정.
 * calculator-main/src/precision.js 의 fieldApplication() 1:1 이식 (엑셀 Version11 SSOT).
 * parser.work "현장계수 수분석"에서 실험실값(lab)+현장값(site)으로 항목별 적합/부적합 산출.
 *
 * ⚠️ 계산 로직은 계산기 원본과 반드시 동일해야 함. 임의 수정 금지 — 바꿀 땐 precision.js와 함께.
 */

export type FieldParam = 'TOC' | 'TN' | 'TP' | 'SS' | 'COD' | 'PH';

/** 수분석 엑셀 C열 항목명 → 현장적용계수 파라미터 코드 */
export const ITEM_TO_PARAM: Record<string, FieldParam> = {
  '총유기탄소': 'TOC',
  '총질소': 'TN',
  '총인': 'TP',
  '부유물질': 'SS',
  '화학적산소요구량': 'COD',
  '수소이온농도': 'PH',
};

export interface FieldResult {
  parameter: string;
  labMean: number;
  siteMean: number;
  limit: number | null;
  useRate: boolean;
  meanFi: number;
  meanRate: number;
  fi?: number;
  rate?: number;
  dischargeRate?: number;
  discharge?: number;
  useDischarge?: boolean;
  highVariability?: boolean;
  auto: boolean;
  pass: boolean | null;
  note?: string;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return n;
};

// precision.js mean()과 동일: 유한값만(0 포함), 없으면 0
function mean(arr: number[]): number {
  const a = arr.filter(v => (Number.isFinite(v) && v !== 0) || v === 0);
  if (!a.length) return 0;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

const FIELD_RULES: Record<string, { threshold: number; absLimit: number; rateLimit: number }> = {
  TN:  { threshold: 10,  absLimit: 1.5,  rateLimit: 15 },
  TP:  { threshold: 0.4, absLimit: 0.06, rateLimit: 15 },
  SS:  { threshold: 5,   absLimit: 1.0,  rateLimit: 20 },
  COD: { threshold: 20,  absLimit: 3.0,  rateLimit: 15 },
};

/**
 * @param parameter TOC/TN/TP/SS/COD/PH
 * @param labVals   실험실값 [Ai1,Ai2,Ai3,Ai4]
 * @param siteVals  현장값 [Ci1,Ci2] (측정값1/측정값2)
 * @param opts      { discharge?: TOC 배출기준, highVariability?: 변동성 큰 시료 }
 */
export function fieldApplication(
  parameter: string,
  labVals: Array<number | string | null | undefined>,
  siteVals: Array<number | string | null | undefined>,
  opts: { discharge?: number | string; highVariability?: boolean } = {}
): FieldResult {
  const param = String(parameter).toUpperCase();
  const L = labVals.map(num);
  const S = siteVals.map(num);

  const cleanLabVals = L.filter(v => Number.isFinite(v));
  const cleanSiteVals = S.filter(v => Number.isFinite(v));

  const labMean = mean(cleanLabVals);
  const siteMean = mean(cleanSiteVals);

  const r1Vals = [L[0], L[1]].filter(v => Number.isFinite(v));
  const r2Vals = [L[2], L[3]].filter(v => Number.isFinite(v));

  const hasTwoRounds = r2Vals.length > 0;
  const r1Ai = mean(r1Vals);
  const r2Ai = hasTwoRounds ? mean(r2Vals) : r1Ai;

  const ci1 = cleanSiteVals[0] !== undefined ? cleanSiteVals[0] : 0;
  const ci2 = hasTwoRounds ? (cleanSiteVals[1] !== undefined ? cleanSiteVals[1] : ci1) : ci1;

  const fi1 = Math.abs(r1Ai - ci1);
  const fi2 = Math.abs(r2Ai - ci2);
  const meanFi = hasTwoRounds ? (fi1 + fi2) / 2 : fi1;

  const rate1 = r1Ai > 0 ? (fi1 / r1Ai) * 100 : (r1Ai === 0 && fi1 === 0 ? 0 : Infinity);
  const rate2 = r2Ai > 0 ? (fi2 / r2Ai) * 100 : (r2Ai === 0 && fi2 === 0 ? 0 : Infinity);
  const meanRate = hasTwoRounds ? (rate1 + rate2) / 2 : rate1;

  if (param === 'TOC') {
    const discharge = Number(opts.discharge) || 0;
    const highVar = !!opts.highVariability;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const fi = r2(meanFi);
    const rate = r1(meanRate);

    if (highVar) {
      const pass = rate <= 15.0 && fi <= 0.5;
      return { parameter: param, labMean, siteMean, limit: 15, useRate: true,
        meanFi, meanRate, fi, rate, discharge, useDischarge: false, highVariability: true, auto: false, pass };
    }
    if (discharge > 0 && labMean < discharge / 2) {
      const dischargeRate = r1((fi / discharge) * 100);
      return { parameter: param, labMean, siteMean, limit: 15, useRate: false,
        meanFi, meanRate, fi, rate, dischargeRate, discharge, useDischarge: true, highVariability: false, auto: false, pass: dischargeRate <= 15 };
    }
    let limit: number, useRate: boolean, pass: boolean;
    if (labMean <= 3.0) { limit = 0.45; useRate = false; pass = fi <= 0.45; }
    else { limit = 15; useRate = true; pass = rate <= 15; }
    return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, fi, rate,
      useDischarge: false, highVariability: false, auto: false, pass };
  }

  if (param === 'PH') {
    const limit = 0.20;
    const fi = Math.round(meanFi * 100) / 100;
    return { parameter: param, labMean, siteMean, limit, useRate: false, meanFi, meanRate, fi, auto: false, pass: fi <= limit };
  }

  const rule = FIELD_RULES[param];
  if (!rule) return { parameter: param, labMean, siteMean, limit: null, useRate: false, meanFi, meanRate,
    auto: false, pass: null, note: '현장적용계수 기준 미정의' };

  const fi = Math.round(meanFi * 100) / 100;
  const rate = Math.round(meanRate * 10) / 10;
  const useRate = labMean >= rule.threshold;
  const limit = useRate ? rule.rateLimit : rule.absLimit;
  const pass = useRate ? rate <= rule.rateLimit : fi <= rule.absLimit;
  return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, fi, rate, auto: false, pass };
}

/** 판정 → 표시용 라벨 { text, ok } */
export function verdictLabel(r: FieldResult | null): { text: string; ok: boolean | null } {
  if (!r || r.pass === null) return { text: '—', ok: null };
  return { text: r.pass ? '적합' : '부적합', ok: r.pass };
}
