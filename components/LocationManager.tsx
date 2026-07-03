import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LocationEntry,
  getAllLocations,
  saveLocation,
  deleteLocation,
  getCurrentPosition,
  reverseGeocode,
  isValidReceiptId,
  getServerStatus,
} from '../services/locationService';
import { buildMapLinks } from '../services/mapLinks';

interface LocationManagerProps {
  onSelectLocation?: (entry: LocationEntry) => void;
}

const PinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

export const LocationManager: React.FC<LocationManagerProps> = ({ onSelectLocation }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [serverStatus, setServerStatus] = useState<'server' | 'local' | 'checking'>('checking');

  // 편집 폼
  const [editId, setEditId] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);

  const [isGettingGps, setIsGettingGps] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 데이터 로드 ──────────────────────────────────────────────
  const loadLocations = useCallback(async () => {
    const [all, status] = await Promise.all([getAllLocations(), getServerStatus()]);
    setLocations(all);
    setServerStatus(status);
  }, []);

  // 초기 로드
  useEffect(() => { loadLocations(); }, [loadLocations]);

  // 패널 열릴 때 폴링 시작 (10초 간격 실시간 동기화)
  useEffect(() => {
    if (isOpen) {
      loadLocations();
      pollRef.current = setInterval(loadLocations, 10_000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOpen, loadLocations]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setConfirmDeleteId(null);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ── 폼 초기화 ────────────────────────────────────────────────
  const resetForm = () => {
    setEditId('');
    setEditAddress('');
    setEditingOriginalId(null);
    setStatusMsg(null);
  };

  // ── 목록 클릭 → 편집 모드 ────────────────────────────────────
  const handleEditEntry = (loc: LocationEntry) => {
    setEditId(loc.id);
    setEditAddress(loc.address);
    setEditingOriginalId(loc.id);
    setStatusMsg(null);
    setConfirmDeleteId(null);
  };

  // ── GPS로 주소 자동 채우기 ───────────────────────────────────
  const handleFillGps = async () => {
    setIsGettingGps(true);
    setStatusMsg(null);
    try {
      const { lat, lng } = await getCurrentPosition();
      const address = await reverseGeocode(lat, lng);
      setEditAddress(address);
      setStatusMsg({ type: 'ok', text: `📡 GPS: ${address}` });
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: '📍 GPS 불가 — 주소를 직접 입력하세요.' });
    } finally {
      setIsGettingGps(false);
    }
  };

  // ── 저장 (신규 or 수정) ──────────────────────────────────────
  const handleSave = async () => {
    const id = editId.trim();
    const address = editAddress.trim();
    if (!id) { setStatusMsg({ type: 'err', text: '접수번호를 입력하세요.' }); return; }
    if (!isValidReceiptId(id)) { setStatusMsg({ type: 'err', text: '형식: 26-031078-01 또는 26-031078-01-1' }); return; }
    if (!address) { setStatusMsg({ type: 'err', text: '주소를 입력하세요.' }); return; }

    try {
      // 접수번호가 변경된 경우 기존 항목 삭제
      if (editingOriginalId && editingOriginalId !== id) {
        await deleteLocation(editingOriginalId);
      }
      await saveLocation({ id, address, lat: 0, lng: 0, savedAt: Date.now() });
      await loadLocations();
      setStatusMsg({ type: 'ok', text: `✅ 저장: ${id}` });
      resetForm();
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: `저장 실패: ${e.message}` });
    }
  };

  // ── 삭제 ─────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    await deleteLocation(id);
    await loadLocations();
    setConfirmDeleteId(null);
    if (editingOriginalId === id) resetForm();
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* 헤더 버튼 */}
      <button
        onClick={() => { setIsOpen(v => !v); setConfirmDeleteId(null); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all border ${
          isOpen ? 'bg-slate-700 border-slate-600 text-white' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`}
        title="위치 관리"
      >
        <PinIcon />
        <span style={{ color: locations.length > 0 ? '#f87171' : undefined }}>
          📍{locations.length > 0 ? ` ${locations.length}` : ''}
        </span>
      </button>

      {/* 드롭다운 패널 */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 bg-slate-900/98 backdrop-blur-md border border-slate-700/70 rounded-xl shadow-2xl p-3 space-y-3"
          style={{ width: '340px' }}
        >
          {/* 헤더 + 서버 상태 */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">📍 위치 저장 목록</p>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              serverStatus === 'server'
                ? 'bg-green-900/60 text-green-400 border border-green-700/50'
                : serverStatus === 'local'
                  ? 'bg-amber-900/60 text-amber-400 border border-amber-700/50'
                  : 'bg-slate-800 text-slate-500'
            }`}>
              {serverStatus === 'server' ? '🟢 서버 연동' : serverStatus === 'local' ? '🟡 로컬 저장' : '⏳'}
            </span>
          </div>

          {/* ── 편집 폼 ── */}
          <div className="space-y-1.5 p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
            <p className="text-[10px] text-slate-500 font-semibold">
              {editingOriginalId ? `✏️ 수정 중: ${editingOriginalId}` : '➕ 새 위치 저장'}
            </p>

            {/* 접수번호 */}
            <input
              type="text"
              value={editId}
              onChange={e => { setEditId(e.target.value); setStatusMsg(null); }}
              placeholder="접수번호 예) 26-031078-01-1"
              className="w-full text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
            />

            {/* 주소 입력 + GPS 버튼 */}
            <div className="flex gap-1">
              <input
                type="text"
                value={editAddress}
                onChange={e => { setEditAddress(e.target.value); setStatusMsg(null); }}
                placeholder="주소 직접 입력 또는 GPS ▶"
                className="flex-1 min-w-0 text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handleFillGps}
                disabled={isGettingGps}
                className="shrink-0 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sky-300 border border-slate-600 transition-colors whitespace-nowrap"
                title="GPS 자동 입력"
              >
                {isGettingGps ? '...' : '📡GPS'}
              </button>
            </div>

            {/* 상태 메시지 */}
            {statusMsg && (
              <p className={`text-[10px] px-1 ${statusMsg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {statusMsg.text}
              </p>
            )}

            {/* 저장 / 취소 */}
            <div className="flex gap-1.5 pt-0.5">
              <button
                onClick={handleSave}
                disabled={!editId.trim() || !editAddress.trim()}
                className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
              >
                {editingOriginalId ? '💾 수정 저장' : '📍 저장'}
              </button>
              {editingOriginalId && (
                <button
                  onClick={resetForm}
                  className="px-3 text-xs font-semibold py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  취소
                </button>
              )}
            </div>
          </div>

          {/* ── 저장된 위치 목록 ── */}
          {locations.length === 0 ? (
            <p className="text-center text-[11px] text-slate-600 py-3">저장된 위치가 없습니다.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {locations.map(loc => (
                <div
                  key={loc.id}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-colors ${
                    editingOriginalId === loc.id
                      ? 'bg-sky-900/30 border-sky-600/50'
                      : 'bg-slate-800/60 border-slate-700/40 hover:border-slate-600/60'
                  }`}
                >
                  {/* 클릭 → 현재 작업 GPS 주소 적용 */}
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => { onSelectLocation?.(loc); setIsOpen(false); }}
                    title="클릭 → 현재 작업에 이 위치 적용"
                  >
                    <p className={`text-[11px] font-bold truncate ${editingOriginalId === loc.id ? 'text-sky-300' : 'text-sky-400'}`}>
                      {loc.id}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{loc.address || '주소 없음'}</p>
                  </button>

                  {/* 지도 교차검증: 카카오·네이버·구글 (좌표 있으면 정확한 핀) */}
                  {(loc.address || loc.siteName) && (() => {
                    const m = buildMapLinks({ address: loc.address, lat: loc.lat, lng: loc.lng, name: loc.siteName });
                    const cls = 'shrink-0 px-1 py-0.5 rounded text-[9px] font-bold leading-none';
                    const stop = (e: React.MouseEvent) => e.stopPropagation();
                    return (
                      <div className="shrink-0 flex items-center gap-0.5" onClick={stop}>
                        <a href={m.kakao} target="_blank" rel="noopener noreferrer" onClick={stop} title="카카오맵에서 보기" className={`${cls} bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/40`}>카</a>
                        <a href={m.naver} target="_blank" rel="noopener noreferrer" onClick={stop} title="네이버맵에서 보기" className={`${cls} bg-green-500/20 text-green-300 hover:bg-green-500/40`}>네</a>
                        <a href={m.google} target="_blank" rel="noopener noreferrer" onClick={stop} title="구글맵에서 보기" className={`${cls} bg-blue-500/20 text-blue-300 hover:bg-blue-500/40`}>구</a>
                      </div>
                    );
                  })()}

                  {/* 수정 버튼 */}
                  <button
                    onClick={() => handleEditEntry(loc)}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      editingOriginalId === loc.id ? 'text-sky-400 bg-sky-900/40' : 'text-slate-500 hover:text-sky-400'
                    }`}
                    title="수정"
                  >
                    <EditIcon />
                  </button>

                  {/* 삭제 버튼 */}
                  <button
                    onClick={() => handleDelete(loc.id)}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      confirmDeleteId === loc.id
                        ? 'bg-red-600 text-white'
                        : 'text-slate-600 hover:text-red-400'
                    }`}
                    title={confirmDeleteId === loc.id ? '한 번 더 클릭하면 삭제' : '삭제'}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
