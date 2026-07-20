/**
 * fieldExcel.ts — 현장계수 수분석 큐 → 엑셀 다운로드.
 * 원본 "수분석" 파일을 참고해 재현: 전체(판정 요약) + 항목별(TOC/T-N/T-P/SS/COD 판정) + to claydox(전송양식).
 *
 * ⚠️ 원본의 심층 분석칸(여지무게·적정량·검정곡선 등 실험실 raw)은 parser.work 큐에 없는 데이터라
 *    재현 대상이 아니다. 큐가 가진 것(접수번호·항목·현장값·실험실값·담당자·판정)으로 만든다.
 */
import * as XLSX from 'xlsx';
import { fieldApplication, ITEM_TO_PARAM, verdictLabel } from './fieldApplication';

export interface FieldRow {
  receipt_no: string; item: string; site_name: string; manager: string;
  site_val1: string; site_val2: string; toc_std: string; lab_data: string; status: string;
}

const ITEM_ORDER = ['총유기탄소', '총질소', '총인', '부유물질', '화학적산소요구량'];
const ITEM_SHEET: Record<string, string> = { 총유기탄소: 'TOC', 총질소: 'T-N', 총인: 'T-P', 부유물질: 'SS', 화학적산소요구량: 'COD' };

function labVals(row: FieldRow): number[] {
  try { const p = JSON.parse(row.lab_data || '[]'); return (Array.isArray(p) ? p : (p.labVals || p.vals || [])).map(Number).filter((v: number) => Number.isFinite(v)); }
  catch { return []; }
}

function calc(row: FieldRow) {
  const param = ITEM_TO_PARAM[row.item];
  const lv = labVals(row);
  if (!param || !lv.length) return null;
  return fieldApplication(param, lv, [row.site_val1, row.site_val2], { discharge: row.toc_std });
}

/** 큐 rows → 워크북 → 파일 다운로드 */
export function exportFieldExcel(rows: FieldRow[], weekKey: string): void {
  const wb = XLSX.utils.book_new();
  const sorted = [...rows].sort((a, b) =>
    (ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item)) || a.receipt_no.localeCompare(b.receipt_no));

  // ── 전체(판정 요약) ──
  const allAoa: any[][] = [
    ['■ 현장계수 수분석 결과', '', '', '', '', '', '', '', '', ''],
    [`주차: ${weekKey}`, '', '', '', '', '', '', '', '', ''],
    ['NO', '분석항목', '업체명', '접수번호', '측정값1', '측정값2', '실험실평균', '오차(Fi)', '기준', '판정'],
  ];
  sorted.forEach((r, i) => {
    const res = calc(r);
    const v = verdictLabel(res);
    allAoa.push([
      i + 1, r.item, r.site_name, r.receipt_no, r.site_val1, r.site_val2,
      res ? Number(res.labMean.toFixed(4)) : '', res?.fi ?? '',
      res ? `${res.useRate ? res.limit + '%' : res.limit + 'mg/L'}` : '', v.text,
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allAoa), '전체');

  // ── 항목별 판정 시트 ──
  for (const item of ITEM_ORDER) {
    const itemRows = sorted.filter(r => r.item === item);
    if (!itemRows.length) continue;
    const aoa: any[][] = [
      [`${item} — 현장적용계수 판정`],
      [`주차: ${weekKey}`],
      ['시료번호', '업체명', '접수번호', '측정값1', '측정값2', '실험실1-1', '1-2', '2-1', '2-2', '실험실평균', '오차(Fi)', '오차율(%)', '기준', '판정'],
    ];
    itemRows.forEach((r, i) => {
      const res = calc(r); const v = verdictLabel(res); const lv = labVals(r);
      aoa.push([
        i + 1, r.site_name, r.receipt_no, r.site_val1, r.site_val2,
        lv[0] ?? '', lv[1] ?? '', lv[2] ?? '', lv[3] ?? '',
        res ? Number(res.labMean.toFixed(4)) : '', res?.fi ?? '', res?.rate ?? '',
        res ? (res.useRate ? res.limit + '%' : res.limit + 'mg/L') : '', v.text,
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), ITEM_SHEET[item]);
  }

  // ── to claydox (전송양식: 순번·분야·항목·업체·접수번호·1-1·1-2·2-1·2-2·(빈)·담당자) ──
  const claydox: any[][] = [];
  const perItemNo: Record<string, number> = {};
  sorted.forEach(r => {
    const lv = labVals(r);
    perItemNo[r.item] = (perItemNo[r.item] || 0) + 1;
    claydox.push([perItemNo[r.item], '수질분야', r.item, r.site_name, r.receipt_no,
      lv[0] ?? '', lv[1] ?? '', lv[2] ?? '', lv[3] ?? '', '', r.manager]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(claydox), 'to claydox');

  const safeWeek = weekKey.replace(/[^\d~-]/g, '');
  XLSX.writeFile(wb, `현장계수_수분석_${safeWeek}.xlsx`);
}
