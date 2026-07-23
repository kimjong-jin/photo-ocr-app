import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ocrToFields, callVerdict, loadCalcFields, saveItemToCalcData, type VerdictResult } from '../services/verdictApi';

// 정도검사 체크 라벨 → 짧은 약어(반/제드/스드/직/응/온/포/현장)
const checkAbbr = (label: string): string => {
  const s = String(label || '');
  if (s.includes('현장적용')) return '현장';
  if (s.includes('반복성')) return '반';
  if (s.includes('제로드리프트')) return '제드';
  if (s.includes('스팬드리프트')) return '스드';
  if (s.includes('드리프트')) return '드';
  if (s.includes('직선성')) return '직';
  if (s.includes('응답')) return '응';
  if (s.includes('온도')) return '온';
  if (s.includes('포도당')) return '포';
  return s.slice(0, 2);
};

/**
 * 계산하기 버튼 — P2/P5 OCR 데이터로 정도검사 적합/부적합을 계산기 API(aicalc.work/api/verdict)에서 받아 표시.
 * 계산 로직은 계산기(단일 출처)에 있고, 여기선 데이터 매핑 + 호출 + 표시만 한다.
 */
interface Props {
  ocrData: any[] | null | undefined;
  selectedItem: string;      // TOC/TN/TP/COD/SS ...
  receiptNumber: string;
  userName: string;
  /** P5 등에서 이미 만든 fields를 직접 넘길 때(선택) */
  fieldsOverride?: Record<string, any>;
}

const ITEM_CODE: Record<string, string> = {
  TOC: 'TOC', TN: 'TN', TP: 'TP', COD: 'COD', SS: 'SS', PH: 'PH', DO: 'DO', TU: 'TU', CL: 'CL',
};
// 측정범위(range)가 판정에 필요한 항목(기본형·먹는물). pH/DO 는 range 불필요.
const NEEDS_RANGE = new Set(['TOC', 'TN', 'TP', 'COD', 'SS', 'TU', 'CL']);

export const VerdictButton: React.FC<Props> = ({ ocrData, selectedItem, receiptNumber, userName, fieldsOverride }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState<VerdictResult | null>(null);   // 자동 계산(계산하기 안 눌러도) 컴팩트 표시용

  const code = ITEM_CODE[String(selectedItem || '').toUpperCase()] || String(selectedItem || '').toUpperCase();

  // 자동 판정용 fields(프롬프트 없이). ocrData/fieldsOverride 바뀌면 재계산.
  const baseFields = useMemo(
    () => (fieldsOverride ? { ...fieldsOverride } : ocrToFields(ocrData, selectedItem)),
    [fieldsOverride, ocrData, selectedItem],
  );
  const fieldsKey = useMemo(() => JSON.stringify(baseFields), [baseFields]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuto(null);
      const fields: Record<string, any> = { ...baseFields };
      if (Object.keys(fields).length < 3) return;                 // 데이터 부족 시 자동표시 안 함
      if (NEEDS_RANGE.has(code) && (fields.range == null || fields.range === '')) {
        const calc = receiptNumber ? await loadCalcFields(receiptNumber, userName, code) : null;
        if (calc?.range) fields.range = calc.range; else return;   // 범위 없으면 프롬프트 없이 skip(계산하기로 유도)
      }
      try { const v = await callVerdict(code, fields); if (!cancelled) setAuto(v); } catch { /* 조용히 */ }
    })();
    return () => { cancelled = true; };
  }, [fieldsKey, code, receiptNumber, userName]);

  // 컴팩트 칩: 시험별 적/부(약어). 반복성 저/고 등 같은 약어는 부(false) 우선으로 합침.
  const chips = useMemo(() => {
    if (!auto) return [] as { abbr: string; ok: boolean }[];
    const m = new Map<string, boolean>();
    for (const c of auto.checks || []) {
      if (c.pass == null) continue;
      const a = checkAbbr(c.label);
      if (c.pass === false) m.set(a, false);
      else if (!m.has(a)) m.set(a, true);
    }
    return [...m.entries()].map(([abbr, ok]) => ({ abbr, ok }));
  }, [auto]);

  const run = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      let fields: Record<string, any> = fieldsOverride ? { ...fieldsOverride } : ocrToFields(ocrData, selectedItem);
      // range(측정범위)는 OCR에 없음 → 계산기 calc_data에서 먼저 읽고, 없으면 입력받음. pH/DO는 range 불필요.
      if (NEEDS_RANGE.has(code) && (fields.range == null || fields.range === '')) {
        const calc = receiptNumber ? await loadCalcFields(receiptNumber, userName, code) : null;
        if (calc?.range) fields.range = calc.range;
        else {
          const r = window.prompt(`측정범위(range)를 입력하세요 — ${code} 정도검사 계산에 필요합니다.`, '');
          if (r == null || r.trim() === '') { setBusy(false); return; }
          fields.range = r.trim();
          // P1에서 측정범위가 안 왔을 때 직접 입력한 값 → calc_data(DB)에 저장.
          // 다음부턴 loadCalcFields가 같은 접수번호·항목으로 찾아 재질문 안 함(P2~P5 공통). best-effort.
          if (receiptNumber) {
            saveItemToCalcData({ receiptNo: receiptNumber, userName, code, fields: { range: fields.range } })
              .catch(() => { /* 저장 실패해도 이번 계산은 진행 */ });
          }
        }
      }
      // pH/DO 응답시간은 보통 ST→EN(CSV 지정)에서 자동 계산됨. ST/EN 미지정 등으로 비었을 때만 수동 입력(폴백).
      if ((code === 'PH' || code === 'DO') && (fields.resp == null || fields.resp === '')) {
        const lim = code === 'PH' ? '30초' : '120초';
        const rr = window.prompt(`응답시간(초) — ${code} 기준 ≤${lim}. (ST·EN이 지정돼 있으면 자동 계산됩니다. 없으면 입력, 모르면 비워두고 확인)`, '');
        if (rr && rr.trim()) fields.resp = rr.trim();
      }
      const v = await callVerdict(code, fields);
      setResult(v);
    } catch (e: any) { setErr(e.message || '계산 실패'); }
    finally { setBusy(false); }
  };

  const passLabel = (p: string) => p === 'ok' ? '전 항목 적합' : p === 'bad' ? '부적합 항목 있음' : '데이터 입력 필요';
  const passColor = (p: string) => p === 'ok' ? 'text-green-400' : p === 'bad' ? 'text-red-400' : 'text-amber-400';

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        onClick={run}
        disabled={busy || (!ocrData?.length && !fieldsOverride)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600/25 text-indigo-300 hover:bg-indigo-600/40 disabled:opacity-40"
        title="정도검사 적합/부적합 계산 (계산기)"
      >{busy ? '계산 중…' : '🧮 계산하기'}</button>

      {/* 계산하기 안 눌러도 자동으로 작게 표시 — 시험별 적/부(약어) + 종합 */}
      {auto && chips.length > 0 && (
        <span className="flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-[9px] font-bold leading-none max-w-[180px]">
          <span className={auto.pass === 'ok' ? 'text-green-400' : auto.pass === 'bad' ? 'text-red-400' : 'text-amber-400'}>
            {auto.pass === 'ok' ? '적합' : auto.pass === 'bad' ? '부적합' : '미완'}
          </span>
          {chips.map(c => (
            <span key={c.abbr} className={c.ok ? 'text-green-400/80' : 'text-red-400'}>{c.abbr}({c.ok ? '적' : '부'})</span>
          ))}
        </span>
      )}

      {(result || err) && createPortal(
        <div className="fixed inset-0 z-[9997] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={e => { if (e.target === e.currentTarget) { setResult(null); setErr(''); } }}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[85vh] overflow-auto shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 sticky top-0 bg-slate-900">
              <h3 className="text-sm font-bold text-slate-100">🧮 {code} 정도검사 판정</h3>
              <button onClick={() => { setResult(null); setErr(''); }} className="text-slate-400 hover:text-white text-xs px-2 py-1">✕</button>
            </div>
            {err && <p className="text-red-400 text-sm p-5">{err}</p>}
            {result && (
              <div className="p-5">
                <div className={`text-center text-lg font-extrabold mb-4 ${passColor(result.pass)}`}>
                  {result.pass === 'ok' ? '✔ ' : result.pass === 'bad' ? '✘ ' : '· '}{passLabel(result.pass)}
                </div>
                <div className="space-y-1.5">
                  {result.checks.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-3 py-2">
                      <span className="text-slate-300">{c.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">{typeof c.value === 'number' ? c.value.toFixed(2) : String(c.value ?? '—')}</span>
                        <span className={`font-bold ${c.pass === true ? 'text-green-400' : c.pass === false ? 'text-red-400' : 'text-slate-500'}`}>
                          {c.pass === true ? '적합' : c.pass === false ? '부적합' : '—'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {result.field && (
                  <div className="mt-3 text-xs text-center text-slate-400">
                    현장적용계수: <span className={result.field.pass ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{result.field.pass ? '적합' : '부적합'}</span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">(현장적용은 정도검사 종합엔 미포함 — 수분석값과 별도 대조)</span>
                  </div>
                )}
                <p className="mt-4 text-[10px] text-center text-slate-600">계산: 계산기(aicalc.work) 단일 출처 · 고시 개정 시 계산기 엑셀만 갱신</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
};
