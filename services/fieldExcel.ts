/**
 * fieldExcel.ts — 현장계수 수분석 큐 → 엑셀 다운로드.
 * 원본 "수분석" 파일을 참고해 재현: 전체(판정 요약) + 항목별(TOC/T-N/T-P/SS/COD 판정) + to claydox(전송양식).
 *
 * ⚠️ 원본의 심층 분석칸(여지무게·적정량·검정곡선 등 실험실 raw)은 parser.work 큐에 없는 데이터라
 *    재현 대상이 아니다. 큐가 가진 것(접수번호·항목·현장값·실험실값·담당자·판정)으로 만든다.
 */
import * as XLSX from 'xlsx';

export interface FieldRow {
  receipt_no: string; item: string; site_name: string; manager: string;
  site_val1: string; site_val2: string; toc_std: string; lab_data: string; detail: string; status: string;
  comment?: string;   // 수분석 메모(base 접수번호 단위)
}
// 출력용 접수번호: 세부(detail, 전체 접수번호)가 있으면 그걸, 없으면 접수번호
const fullReceipt = (r: FieldRow) => r.detail && r.detail.trim() ? r.detail.trim() : r.receipt_no;

const ITEM_ORDER = ['총유기탄소', '총질소', '총인', '부유물질', '화학적산소요구량'];
const ITEM_SHEET: Record<string, string> = { 총유기탄소: 'TOC', 총질소: 'T-N', 총인: 'T-P', 부유물질: 'SS', 화학적산소요구량: 'COD' };

function labVals(row: FieldRow): number[] {
  try { const p = JSON.parse(row.lab_data || '[]'); return (Array.isArray(p) ? p : (p.labVals || p.vals || [])).map(Number).filter((v: number) => Number.isFinite(v)); }
  catch { return []; }
}

// 판정 텍스트 — 계산기 API field 결과(pass:boolean|null)에서. 계산은 parser가 안 함(단일 출처).
const verdictText = (res: any) => res == null ? '—' : res.pass === true ? '✔ 적합' : res.pass === false ? '✘ 부적합' : '—';

/**
 * 큐 rows → 워크북 → 파일 다운로드.
 * @param verdicts 계산기 API 현장적용 판정 맵 — key=`${receipt_no}|${item}`, value={labMean,fi,rate,useRate,limit,pass}|null
 *                 (services/verdictApi.computeFieldVerdicts 결과. 미제공 시 판정칸은 '—')
 */
export function exportFieldExcel(rows: FieldRow[], weekKey: string, verdicts?: Map<string, any>): void {
  const calc = (row: FieldRow) => verdicts?.get(`${row.receipt_no}|${row.item}`) ?? null;
  const wb = XLSX.utils.book_new();
  const sorted = [...rows].sort((a, b) =>
    (ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item)) || a.receipt_no.localeCompare(b.receipt_no));

  // ── 전체(판정 요약) ──
  const allAoa: any[][] = [
    ['■ 현장계수 수분석 결과', '', '', '', '', '', '', '', '', ''],
    [`주차: ${weekKey}`, '', '', '', '', '', '', '', '', ''],
    ['NO', '분석항목', '업체명', '담당자', '접수번호', '측정값1', '측정값2', '실험실평균', '오차(Fi)', '기준', '판정', '수분석메모'],
  ];
  sorted.forEach((r, i) => {
    const res = calc(r);
    allAoa.push([
      i + 1, r.item, r.site_name, r.manager, fullReceipt(r), r.site_val1, r.site_val2,
      res ? Number(res.labMean.toFixed(4)) : '', res?.fi ?? '',
      res ? `${res.useRate ? res.limit + '%' : res.limit + 'mg/L'}` : '', verdictText(res), r.comment || '',
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
      ['시료번호', '업체명', '담당자', '접수번호', '측정값1', '측정값2', '실험실1-1', '1-2', '2-1', '2-2', '실험실평균', '오차(Fi)', '오차율(%)', '기준', '판정', '수분석메모'],
    ];
    itemRows.forEach((r, i) => {
      const res = calc(r); const lv = labVals(r);
      aoa.push([
        i + 1, r.site_name, r.manager, fullReceipt(r), r.site_val1, r.site_val2,
        lv[0] ?? '', lv[1] ?? '', lv[2] ?? '', lv[3] ?? '',
        res ? Number(res.labMean.toFixed(4)) : '', res?.fi ?? '', res?.rate ?? '',
        res ? (res.useRate ? res.limit + '%' : res.limit + 'mg/L') : '', verdictText(res), r.comment || '',
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
    claydox.push([perItemNo[r.item], '수질분야', r.item, r.site_name, fullReceipt(r),
      lv[0] ?? '', lv[1] ?? '', lv[2] ?? '', lv[3] ?? '', '', r.manager]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(claydox), 'to claydox');

  const safeWeek = weekKey.replace(/[^\d~-]/g, '');
  XLSX.writeFile(wb, `현장계수_수분석_${safeWeek}.xlsx`);
}
