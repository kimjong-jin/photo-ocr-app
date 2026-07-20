import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fieldApplication, ITEM_TO_PARAM, verdictLabel } from '../services/fieldApplication';
import { exportFieldExcel } from '../services/fieldExcel';
import { normalizeReceiptBase } from '../services/fieldQueueSeed';

/**
 * 현장계수 수분석 큐 — 주(週) 단위 한 장 표.
 * 매칭키 = base 접수번호 + 항목명. 상태(대기/분석중/분석완료/재검사), 확인=큐 제거, 4주 자동정리.
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
  lab_data: string; verdict: string; week_key: string; status: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 월요일 시작 ~ 일요일 끝 (월~일 한 주)
const mondayOf = (d: Date) => { const x = new Date(d); const w = x.getDay(); x.setDate(x.getDate() + (w === 0 ? -6 : 1 - w)); x.setHours(0, 0, 0, 0); return x; };
const weekKeyOf = (monday: Date) => { const sun = new Date(monday); sun.setDate(sun.getDate() + 6); return `${fmt(monday)}~${fmt(sun)}`; };

const STATUS_STYLE: Record<string, string> = {
  '대기': 'text-slate-400 bg-slate-700/40',
  '분석중': 'text-amber-300 bg-amber-500/15',
  '분석완료': 'text-green-300 bg-green-500/15',
  '재검사': 'text-red-300 bg-red-500/20',
};
const STATUS_CYCLE = ['대기', '분석중', '분석완료', '재검사'];

// 카톡 축약 항목명 → 큐 항목명(매칭키)
const ABBR_TO_ITEM: Record<string, string> = {
  TOC: '총유기탄소', TN: '총질소', TP: '총인', SS: '부유물질', COD: '화학적산소요구량',
};
type KakaoEntry = { receipt_no: string; item: string; site_name: string; manager: string; labVals: number[] };

// 카톡 메시지(수분석 결과) 파싱 → base 접수번호+항목별 실험실값
function parseKakao(text: string): KakaoEntry[] {
  const out: KakaoEntry[] = [];
  let manager = '', site = '', receipt = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^담당자\s*[:：]\s*(.+)$/))) { manager = m[1].trim(); continue; }
    if ((m = line.match(/^현장명\s*[:：]\s*(.+)$/))) { site = m[1].trim(); continue; }
    if ((m = line.match(/^접수번호\s*[:：]\s*(.+)$/))) { receipt = normalizeReceiptBase(m[1].trim()); continue; }
    // 항목 줄:  TOC: 1-1 [1.234], 1-2 [1.235], 2-1 [...], 2-2 [...]
    if ((m = line.match(/^(TOC|TN|TP|SS|COD)\s*[:：]\s*(.+)$/i))) {
      const abbr = m[1].toUpperCase();
      const item = ABBR_TO_ITEM[abbr];
      if (!item || !receipt) continue;
      // [숫자] 를 등장 순서대로 (1-1,1-2,2-1,2-2)
      const vals = [...m[2].matchAll(/\[\s*([\d.]+)\s*\]/g)].map(x => Number(x[1])).filter(v => Number.isFinite(v));
      if (!vals.length) continue;
      out.push({ receipt_no: receipt, item, site_name: site, manager, labVals: vals });
    }
  }
  return out;
}

// 실험실값(lab_data JSON) + 현장값으로 적합/부적합 계산
function cellVerdict(cell: Row): { text: string; ok: boolean | null } {
  const param = ITEM_TO_PARAM[cell.item];
  if (!param) return { text: '—', ok: null };
  let labVals: any[] = [];
  try { const p = JSON.parse(cell.lab_data || '{}'); labVals = Array.isArray(p) ? p : (p.labVals || p.vals || []); }
  catch { labVals = []; }
  if (!labVals.length) return { text: '—', ok: null };
  const r = fieldApplication(param, labVals, [cell.site_val1, cell.site_val2], { discharge: cell.toc_std });
  return verdictLabel(r);
}

interface Props { isOpen: boolean; onClose: () => void; }

export const FieldAnalysisModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const weekKey = useMemo(() => weekKeyOf(monday), [monday]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/field-queue?week=${encodeURIComponent(weekKey)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '조회 실패');
      setRows(d.rows || []);
    } catch (e: any) { setErr(e.message); setRows([]); }
    finally { setLoading(false); }
  }, [weekKey]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  // 접수번호별 그룹 (행 = 접수번호, 열 = 항목)
  const grouped = useMemo(() => {
    const map = new Map<string, { receipt_no: string; site_name: string; manager: string; items: Record<string, Row> }>();
    for (const r of rows) {
      if (!map.has(r.receipt_no)) map.set(r.receipt_no, { receipt_no: r.receipt_no, site_name: r.site_name, manager: r.manager, items: {} });
      map.get(r.receipt_no)!.items[r.item] = r;
    }
    return [...map.values()];
  }, [rows]);

  const setStatus = async (receipt_no: string, item: string, status: string) => {
    await fetch(`/api/field-queue?op=status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receipt_no, item, status }) });
    load();
  };
  const bulkStatus = async (status: string) => {
    if (!window.confirm(`이번 주 전체를 '${status}'(으)로 변경할까요?`)) return;
    await fetch(`/api/field-queue?op=status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week_key: weekKey, status }) });
    load();
  };
  const confirmReceipt = async (g: { receipt_no: string; items: Record<string, Row> }) => {
    // 확인 = 그 접수번호의 모든 항목 큐에서 제거
    for (const it of Object.values(g.items)) {
      await fetch(`/api/field-queue`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receipt_no: it.receipt_no, item: it.item }) });
    }
    load();
  };
  const ingestKakao = async () => {
    const entries = parseKakao(pasteText);
    if (!entries.length) { setPasteMsg('파싱된 항목이 없습니다. (접수번호/항목 줄 확인)'); return; }
    const payload = entries.map(e => ({
      receipt_no: e.receipt_no, item: e.item, site_name: e.site_name, manager: e.manager,
      lab_data: JSON.stringify(e.labVals), status: '분석중', week_key: weekKey,
    }));
    setPasteMsg('저장 중…');
    try {
      const r = await fetch(`/api/field-queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: payload }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || '저장 실패');
      setPasteMsg(`✔ ${d.saved}건 저장 (제외 ${d.skipped})`);
      setPasteText(''); setShowPaste(false); load();
    } catch (e: any) { setPasteMsg('오류: ' + e.message); }
  };

  const cleanupConfirmed = async () => {
    await fetch(`/api/field-queue`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week_key: weekKey, confirmedOnly: true }) });
    load();
  };

  const doneCount = rows.filter(r => r.status === '분석완료').length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
        <h2 className="text-base font-bold text-slate-100">🧪 현장계수 수분석</h2>
        <div className="flex-1" />
        <button onClick={() => { setShowPaste(s => !s); setPasteMsg(''); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30">💬 카톡 붙여넣기</button>
        <button onClick={() => exportFieldExcel(rows, weekKey)} disabled={!rows.length} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600/25 text-green-300 hover:bg-green-600/35 disabled:opacity-40">⬇ 엑셀</button>
        <button onClick={cleanupConfirmed} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600">확인건 정리</button>
        <button onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-600 text-white hover:bg-slate-500">✕ 닫기</button>
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

      {/* 카톡 붙여넣기 패널 */}
      {showPaste && (
        <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-700 shrink-0 space-y-2">
          <p className="text-[11px] text-slate-400">수분석 결과 카톡 메시지를 붙여넣으세요. (접수번호=base, 항목별 실험실값 파싱 → 이번 주 큐에 저장)</p>
          <textarea
            value={pasteText} onChange={e => setPasteText(e.target.value)}
            placeholder={'담당자: 홍길동\n현장명: ○○처리장\n접수번호: 25-000000\n결과:\nTOC: 1-1 [1.234], 1-2 [1.235], 2-1 [1.240], 2-2 [1.238]\nTN: 1-1 [10.1], ...'}
            className="w-full h-32 bg-slate-800 border border-slate-600 rounded-lg p-2 text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-yellow-500"
          />
          <div className="flex items-center gap-2">
            <button onClick={ingestKakao} className="text-xs font-bold px-4 py-1.5 rounded-lg bg-yellow-500 text-slate-900 hover:bg-yellow-400">큐에 넣기</button>
            <span className="text-[11px] text-slate-400">{pasteMsg}</span>
          </div>
        </div>
      )}

      {/* 일괄 상태 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/40 border-b border-slate-700 shrink-0 flex-wrap">
        <span className="text-[11px] text-slate-400 font-semibold">일괄</span>
        <button onClick={() => bulkStatus('분석중')} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-600 text-amber-300">전부 분석중</button>
        <button onClick={() => bulkStatus('분석완료')} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-600 text-green-300">전부 분석완료</button>
        <button onClick={() => bulkStatus('대기')} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-600 text-slate-300">전부 대기</button>
      </div>

      {/* 표 */}
      <div className="flex-1 overflow-auto p-3">
        {loading && <p className="text-center text-slate-400 text-sm py-8">불러오는 중…</p>}
        {err && <p className="text-center text-red-400 text-sm py-8">오류: {err}</p>}
        {!loading && !err && grouped.length === 0 && <p className="text-center text-slate-500 text-sm py-8">이번 주 항목이 없습니다.</p>}
        {!loading && grouped.length > 0 && (
          <table className="w-full min-w-[720px] text-xs border-collapse">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left px-2 py-2 sticky top-0 bg-slate-800">접수번호</th>
                <th className="text-left px-2 py-2 sticky top-0 bg-slate-800">업체명</th>
                <th className="px-2 py-2 sticky top-0 bg-slate-800">담당</th>
                {ITEMS.map(it => <th key={it.short} className="px-2 py-2 sticky top-0 bg-slate-800">{it.short}</th>)}
                <th className="px-2 py-2 sticky top-0 bg-slate-800">확인</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(g => {
                const anyRow = Object.values(g.items)[0];
                return (
                  <tr key={g.receipt_no} className="border-t border-slate-700/60 hover:bg-slate-800/40">
                    <td className="px-2 py-2 font-mono font-bold text-slate-200 whitespace-nowrap">{g.receipt_no}</td>
                    <td className="px-2 py-2 font-semibold text-slate-100">{g.site_name}</td>
                    <td className="px-2 py-2 text-center text-slate-400">{g.manager}</td>
                    {ITEMS.map(it => {
                      const cell = g.items[it.name];
                      if (!cell) return <td key={it.short} className="px-2 py-2 text-center text-slate-600">–</td>;
                      return (
                        <td key={it.short} className="px-2 py-1.5 text-center">
                          <div className="font-mono font-bold text-slate-100 leading-tight">{cell.site_val1 || '·'}</div>
                          <div className="font-mono text-slate-400 leading-tight">{cell.site_val2 || '·'}</div>
                          {it.short === 'TOC' && cell.toc_std && <div className="mt-0.5 text-[9px] font-bold text-orange-300 bg-orange-500/15 rounded px-1 inline-block">기준 {cell.toc_std}</div>}
                          {(() => { const v = cellVerdict(cell); return v.ok !== null ? (
                            <div className={`mt-0.5 text-[10px] font-extrabold ${v.ok ? 'text-green-400' : 'text-red-400'}`}>{v.ok ? '✔ 적합' : '✘ 부적합'}</div>
                          ) : null; })()}
                          <button
                            onClick={() => { const cur = STATUS_CYCLE.indexOf(cell.status); setStatus(cell.receipt_no, cell.item, STATUS_CYCLE[(cur + 1) % STATUS_CYCLE.length]); }}
                            className={`mt-1 block mx-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[cell.status] || STATUS_STYLE['대기']}`}
                          >{cell.status}</button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => confirmReceipt(g)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/15 text-green-300 hover:bg-green-500/25">✓ 확인</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
