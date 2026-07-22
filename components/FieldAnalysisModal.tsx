import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { computeFieldVerdicts, computeStandardVerdicts, storeStdVerdict, splitReceipt } from '../services/verdictApi';
import { exportFieldExcel } from '../services/fieldExcel';

/**
 * 현장계수 수분석 큐 — 주(週) 단위 한 장 표.
 * 매칭키 = base 접수번호 + 항목명. 상태 2가지(대기/분석완료, lab 유무로 자동), 확인=큐 제거, 4주 자동정리.
 * 데이터: /api/field-queue (→ Mac Studio :3333 field_queue).
 */

const ITEMS = [
  { name: '총유기탄소', short: 'TOC' },
  { name: '총질소', short: 'T-N' },
  { name: '총인', short: 'T-P' },
  { name: '부유물질', short: 'SS' },
  { name: '화학적산소요구량', short: 'COD' },
];

type Row = {
  receipt_no: string; item: string; site_name: string; manager: string;
  site_val1: string; site_val2: string; toc_std: string;
  lab_data: string; detail: string; verdict: string; std_verdict: string; week_key: string; status: string;
  comment?: string;   // base 접수번호 수분석 메모(위치도우미 입력, GET에서 병합)
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 월요일 시작 ~ 일요일 끝 (월~일 한 주)
const mondayOf = (d: Date) => { const x = new Date(d); const w = x.getDay(); x.setDate(x.getDate() + (w === 0 ? -6 : 1 - w)); x.setHours(0, 0, 0, 0); return x; };
const weekKeyOf = (monday: Date) => { const sun = new Date(monday); sun.setDate(sun.getDate() + 6); return `${fmt(monday)}~${fmt(sun)}`; };

// 상태 2가지만: 수분석 카톡(lab) 도착 → 분석완료, 없으면 대기(=분석대기). 자동 도출(수동 변경 없음).
const STATUS_STYLE: Record<string, string> = {
  '대기': 'text-slate-400 bg-slate-700/40',
  '분석완료': 'text-green-300 bg-green-500/15',
};
const rowStatus = (r: { lab_data?: string }) => (r.lab_data && r.lab_data.trim() ? '분석완료' : '대기');

// 실험실값(lab_data JSON) + 현장값으로 적합/부적합 계산
interface Props { isOpen: boolean; onClose: () => void; }

export const FieldAnalysisModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  // 현장적용 판정 = 계산기 API 결과 맵 (parser는 계산 안 함). key = `${receipt_no}|${item}`
  const [verdicts, setVerdicts] = useState<Map<string, any>>(new Map());
  // 표준용액 정도검사 요약 { pass:'ok'|'bad'|'', failed:[약어] } — field_queue 저장분 or calc_data 계산.
  const [stdMap, setStdMap] = useState<Map<string, { pass: string; failed: string[] }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const weekKey = useMemo(() => weekKeyOf(monday), [monday]);

  // cell → 최종 판정. 표준용액(정도검사) ∧ 현장적용. 하나라도 부적합이면 부적합, 둘 다 적합이어야 적합.
  const cellVerdict = useCallback((cell: Row): { final: boolean | null; fieldOk: boolean | null; std: { pass: string; failed: string[] } | null } => {
    const key = `${cell.receipt_no}|${cell.item}`;
    const fv = verdicts.get(key);
    const fieldOk: boolean | null = fv ? (fv.pass === null || fv.pass === undefined ? null : !!fv.pass) : null;
    const std = stdMap.get(key) || null;
    const stdBad = std?.pass === 'bad', stdOk = std?.pass === 'ok';
    let final: boolean | null = null;
    if (stdBad || fieldOk === false) final = false;                 // 하나라도 부적합
    else if (stdOk && fieldOk === true) final = true;               // 둘 다 적합
    return { final, fieldOk, std };
  }, [verdicts, stdMap]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/field-queue?week=${encodeURIComponent(weekKey)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '조회 실패');
      const rws: Row[] = d.rows || [];
      setRows(rws);
      // 판정: 서버가 수신 즉시 계산해 둔 verdict(우선) → 없는 행만 계산기 API로 보완.
      const map = new Map<string, any>();
      const need: Row[] = [];
      for (const r of rws) {
        const key = `${r.receipt_no}|${r.item}`;
        if (r.verdict && r.verdict.trim()) { try { map.set(key, JSON.parse(r.verdict)); continue; } catch {} }
        if (r.lab_data && r.lab_data.trim() && (r.site_val1 || r.site_val2)) need.push(r);
      }
      setVerdicts(map);
      if (need.length) computeFieldVerdicts(need as any).then(m => {
        setVerdicts(prev => { const merged = new Map(prev); m.forEach((v, k) => merged.set(k, v)); return merged; });
      }).catch(() => {});

      // 표준용액 요약: field_queue 저장분(31일) 우선 → 없는 행만 calc_data에서 계산+저장.
      const sMap = new Map<string, { pass: string; failed: string[] }>();
      const sNeed: Row[] = [];
      for (const r of rws) {
        const key = `${r.receipt_no}|${r.item}`;
        if (r.std_verdict && r.std_verdict.trim()) { try { sMap.set(key, JSON.parse(r.std_verdict)); continue; } catch {} }
        sNeed.push(r);
      }
      setStdMap(sMap);
      if (sNeed.length) computeStandardVerdicts(sNeed).then(m => {
        setStdMap(prev => { const merged = new Map(prev); m.forEach((v, k) => merged.set(k, v)); return merged; });
        // 계산된 요약은 field_queue(31일)에 저장 → calc_data 만료 후에도 표시
        m.forEach((v, k) => { const [rc, it] = k.split('|'); storeStdVerdict(splitReceipt(rc).base, it, v); });
      }).catch(() => {});
    } catch (e: any) { setErr(e.message); setRows([]); setVerdicts(new Map()); setStdMap(new Map()); }
    finally { setLoading(false); }
  }, [weekKey]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  // 접수번호별 그룹 (행 = 접수번호, 열 = 항목)
  const grouped = useMemo(() => {
    const map = new Map<string, { receipt_no: string; site_name: string; manager: string; comment: string; items: Record<string, Row> }>();
    for (const r of rows) {
      if (!map.has(r.receipt_no)) map.set(r.receipt_no, { receipt_no: r.receipt_no, site_name: r.site_name, manager: r.manager, comment: (r as any).comment || '', items: {} });
      const grp = map.get(r.receipt_no)!;
      grp.items[r.item] = r;
      if ((r as any).comment && !grp.comment) grp.comment = (r as any).comment;
    }
    return [...map.values()];
  }, [rows]);


  const doneCount = rows.filter(r => rowStatus(r) === '분석완료').length;

  // 한 항목 셀 내용(현장값·실험값·배출기준·판정·상태) — 표/카드 공용
  const cellInner = (cell: Row, it: { short: string; name: string }) => {
    let lab: number[] = [];
    try { const p = JSON.parse(cell.lab_data || '[]'); lab = (Array.isArray(p) ? p : (p.labVals || p.vals || [])).map(Number).filter((n: number) => Number.isFinite(n)); } catch {}
    const suffix = cell.detail ? (cell.detail.startsWith(cell.receipt_no) ? cell.detail.slice(cell.receipt_no.length) : cell.detail) : '';
    const v = cellVerdict(cell);
    const reasons: string[] = [];
    if (v.std?.pass === 'bad') reasons.push(...(v.std.failed || []).map((f: string) => `${f}(부)`));
    if (v.fieldOk === false) reasons.push('현장(부)');
    return (
      <>
        {suffix && <div className="text-[10px] font-mono font-bold text-sky-400 leading-none mb-1" title={cell.detail}>{suffix}</div>}
        <div className="text-[8px] text-slate-500 leading-none">현장</div>
        <div className="font-mono text-[11px] text-slate-100 leading-tight">{cell.site_val1 || '·'} <span className="text-slate-500">/</span><br />{cell.site_val2 || '·'}</div>
        {lab.length > 0 && (<>
          <div className="text-[8px] text-slate-500 leading-none mt-0.5">실험</div>
          <div className="font-mono text-[10px] text-amber-200/90 leading-tight">{lab.slice(0, 2).join(' ')}</div>
          {lab.length > 2 && <div className="font-mono text-[10px] text-amber-200/90 leading-tight">{lab.slice(2, 4).join(' ')}</div>}
        </>)}
        {it.short === 'TOC' && cell.toc_std && <div className="mt-0.5 text-[9px] font-bold text-orange-300 bg-orange-500/15 rounded px-1 inline-block">기준 {cell.toc_std}</div>}
        {v.final !== null && (<div className={`mt-0.5 text-[10px] font-extrabold ${v.final ? 'text-green-400' : 'text-red-400'}`}>{v.final ? '✔ 최종 적합' : '✘ 최종 부적합'}</div>)}
        {reasons.length > 0 && (<div className="text-[9px] font-bold text-red-400 leading-tight">{reasons.join(' ')}</div>)}
        {v.final === null && v.std?.pass === 'ok' && v.fieldOk === null && (<div className="text-[9px] text-slate-500 leading-tight">표준 적합·현장대기</div>)}
        <span className={`mt-1 block mx-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[rowStatus(cell)]}`}>{rowStatus(cell)}</span>
      </>
    );
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9998] bg-slate-950 flex flex-col" role="dialog" aria-modal="true">
      {/* 헤더 (모바일: 아이콘만) */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-800 border-b border-slate-700 shrink-0">
        <h2 className="text-sm sm:text-base font-bold text-slate-100 whitespace-nowrap">🧪 <span className="hidden sm:inline">현장계수 수분석</span></h2>
        <div className="flex-1" />
        <button onClick={() => exportFieldExcel(rows, weekKey, verdicts)} disabled={!rows.length} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-green-600/25 text-green-300 hover:bg-green-600/35 disabled:opacity-40" title="엑셀 다운로드">⬇<span className="hidden sm:inline ml-1">엑셀</span></button>
        <button onClick={onClose} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-600 text-white hover:bg-slate-500" title="닫기">✕</button>
      </div>

      {/* 주간 네비 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 border-b border-slate-700 shrink-0">
        <button onClick={() => setMonday(d => { const x = new Date(d); x.setDate(x.getDate() - 7); return x; })} className="w-8 h-8 rounded-lg bg-slate-700 text-slate-200 text-lg">‹</button>
        <div className="flex-1 text-center">
          <div className="text-sm font-bold text-slate-100">{weekKey.replace('~', '  ~  ')}</div>
          <div className="text-[11px] text-slate-400">이번 주 {rows.length}건 · 완료 {doneCount}</div>
        </div>
        <button onClick={() => setMonday(d => { const x = new Date(d); x.setDate(x.getDate() + 7); return x; })} className="w-8 h-8 rounded-lg bg-slate-700 text-slate-200 text-lg">›</button>
      </div>

      {/* 상태는 자동(카톡 수분석 도착=분석완료, 없으면 대기) — 수동 일괄변경 없음 */}

      {/* 표(데스크탑) · 카드(모바일 세로) */}
      <div className="flex-1 overflow-auto">
        {loading && <p className="text-center text-slate-400 text-sm py-8">불러오는 중…</p>}
        {err && <p className="text-center text-red-400 text-sm py-8">오류: {err}</p>}
        {!loading && !err && grouped.length === 0 && <p className="text-center text-slate-500 text-sm py-8">이번 주 항목이 없습니다.</p>}

        {/* 데스크탑: 한 장 표 */}
        {!loading && grouped.length > 0 && (
          <div className="hidden sm:block p-3">
            <table className="w-full min-w-[720px] text-xs border-collapse table-fixed">
              <thead>
                <tr className="text-slate-400 text-[11px]">
                  <th className="text-left px-1.5 py-2 sticky top-0 bg-slate-800 w-[86px]">접수번호</th>
                  <th className="text-left px-1.5 py-2 sticky top-0 bg-slate-800 w-[92px]">업체명</th>
                  <th className="px-1 py-2 sticky top-0 bg-slate-800 w-[46px]">담당자</th>
                  {ITEMS.map(it => <th key={it.short} className="px-1 py-2 sticky top-0 bg-slate-800 w-[70px]">{it.short}</th>)}
                </tr>
              </thead>
              <tbody>
                {grouped.map(g => (
                  <React.Fragment key={g.receipt_no}>
                    <tr className="border-t border-slate-700/60 hover:bg-slate-800/40">
                      <td className="px-1.5 py-2 font-mono font-bold text-[10px] text-slate-200 whitespace-nowrap align-top">{g.receipt_no}</td>
                      <td className="px-1.5 py-2 font-semibold text-[10px] text-slate-100 leading-tight break-words align-top">{g.site_name}</td>
                      <td className="px-1 py-2 text-center text-[11px] text-slate-300 whitespace-nowrap align-top">{g.manager}</td>
                      {ITEMS.map(it => {
                        const cell = g.items[it.name];
                        if (!cell) return <td key={it.short} className="px-1 py-2 text-center text-slate-600 align-top">–</td>;
                        return <td key={it.short} className="px-1 py-1.5 text-center align-top">{cellInner(cell, it)}</td>;
                      })}
                    </tr>
                    <tr className="border-b border-slate-700/40">
                      <td colSpan={3 + ITEMS.length} className="px-2 pb-2 pt-0 text-[10px]">
                        <span className="inline-block rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-amber-900"><span className="font-semibold text-amber-700">📝 수분석:</span> {g.comment?.trim() ? <span className="whitespace-pre-wrap break-words">{g.comment}</span> : <span className="text-amber-600/70">-</span>}</span>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 모바일 세로: 카드 */}
        {!loading && grouped.length > 0 && (
          <div className="sm:hidden p-2.5 space-y-2.5">
            {grouped.map(g => (
              <div key={g.receipt_no} className="rounded-xl bg-slate-800/60 border border-slate-700 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[13px] text-slate-100 leading-tight">{g.receipt_no}</div>
                    <div className="text-[12px] text-slate-300 leading-tight mt-0.5 break-words">{g.site_name} <span className="text-slate-500">· {g.manager}</span></div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                  {ITEMS.filter(it => g.items[it.name]).map(it => (
                    <div key={it.short} className="rounded-lg bg-slate-900/60 border border-slate-700/60 px-1 py-1.5 text-center">
                      <div className="text-[10px] font-bold text-slate-400 mb-0.5">{it.short}</div>
                      {cellInner(g.items[it.name], it)}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11px] border-t border-slate-700/50 pt-1.5">
                  <span className="text-slate-500">📝 수분석:</span> {g.comment?.trim() ? <span className="text-amber-200 whitespace-pre-wrap">{g.comment}</span> : <span className="text-slate-600">-</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
