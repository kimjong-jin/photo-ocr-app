/**
 * ExtraPhotoModal.tsx  (v2)
 * 추가 사진자료 전용 모달 — 기존 P1~P5와 완전히 분리
 *
 * UI 변경:
 *  - 유형 드롭다운 제거 → 태그 버튼 [기록부][교정값][참고자료][기타]
 *  - 버튼 클릭 → 해당 텍스트가 코멘트 입력란에 자동 설정
 *  - [기타] 클릭 → 입력란 포커스 (직접 입력)
 *  - KTL 전송 활성화
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import type { ExtraPhotoItem, ExtraPhotoType } from '../shared/types';
import { cacheExtraPhotos, loadCachedExtraPhotos, clearCachedPhotos } from '../services/photoCacheService';
import { generateExtraPhotoA4Pages } from '../services/imageStampingService';
import { sendExtraPhotosToClaydox } from '../services/claydoxApiService';

// 프리셋 레이블 (기타는 직접 입력)
const PRESET_LABELS: { label: string; type: ExtraPhotoType; freeInput: boolean }[] = [
  { label: '기록부',   type: '기록부',   freeInput: false },
  { label: '교정값',   type: '교정값',   freeInput: false },
  { label: '참고자료', type: '참고자료', freeInput: false },
  { label: '기타',     type: '기타',     freeInput: true  },
];

const genUID = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ─── 아이콘 ─────────────────────────────────────────────────────────────────
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ─── Props ───────────────────────────────────────────────────────────────────
export interface ExtraPhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptNumber: string;
  itemName: string;
  /** 현재 이 접수번호의 추가 사진 목록 */
  photos: ExtraPhotoItem[];
  onPhotosChange: (photos: ExtraPhotoItem[]) => void;
  /** PageContainer에서 내려오는 사용자명/현장명 (KTL 전송용) */
  userName?: string;
  siteLocation?: string;
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────
const ExtraPhotoModal: React.FC<ExtraPhotoModalProps> = ({
  isOpen, onClose, receiptNumber, itemName, photos, onPhotosChange,
  userName = '', siteLocation = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [isGeneratingA4, setIsGeneratingA4] = useState(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState(false);
  const [isSending, setIsSending]             = useState(false);
  const [isCacheRestoring, setIsCacheRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err' | 'progress'; text: string } | null>(null);
  const [cacheExists, setCacheExists] = useState(false);
  const [a4PreviewUrls, setA4PreviewUrls] = useState<string[]>([]);
  const [showA4Preview, setShowA4Preview] = useState(false);
  const [localItemName, setLocalItemName] = useState(itemName); // A4 헤더 항목명 (수정 가능)

  // 모달 열릴 때 캐시 확인
  useEffect(() => {
    if (!isOpen) return;
    setA4PreviewUrls([]);
    setShowA4Preview(false);
    setStatusMsg(null);
    setLocalItemName(itemName); // 모달 열릴 때 prop값으로 초기화
    if (photos.length === 0) {
      loadCachedExtraPhotos(receiptNumber).then(cached => {
        setCacheExists(cached.length > 0);
      }).catch(() => setCacheExists(false));
    } else {
      setCacheExists(false);
    }
  }, [isOpen, receiptNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // IndexedDB 자동 캐시
  const syncCache = useCallback(async (updated: ExtraPhotoItem[]) => {
    try {
      if (updated.length === 0) {
        await clearCachedPhotos(receiptNumber, 'EXTRA');
      } else {
        await cacheExtraPhotos(receiptNumber, updated.map(p => ({
          uid: p.uid,
          file: p.file,
          mimeType: p.file.type || 'image/jpeg',
          photoType: p.photoType,
          comment: p.comment,
        })));
      }
    } catch (e) {
      console.error('[ExtraPhotoModal] 캐시 저장 실패:', e);
    }
  }, [receiptNumber]);

  // ─── 캐시 복원 ────────────────────────────────────────────────────────────
  const handleRestoreFromCache = async () => {
    setIsCacheRestoring(true);
    try {
      const cached = await loadCachedExtraPhotos(receiptNumber);
      if (cached.length === 0) { setStatusMsg({ type: 'err', text: '복원할 캐시가 없습니다.' }); setCacheExists(false); return; }
      const restored: ExtraPhotoItem[] = cached.map((c, i) => ({
        uid: c.uid, receiptNumber,
        photoType: c.photoType as ExtraPhotoType,
        comment: c.comment, file: c.file,
        previewUrl: URL.createObjectURL(c.file),
        order: i,
      }));
      onPhotosChange(restored);
      setCacheExists(false);
      setStatusMsg({ type: 'ok', text: `캐시에서 ${restored.length}장 복원했습니다.` });
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: `복원 실패: ${e.message}` });
    } finally {
      setIsCacheRestoring(false);
    }
  };

  // ─── 사진 추가 ────────────────────────────────────────────────────────────
  const MAX_PHOTOS = 30;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setStatusMsg({ type: 'err', text: `최대 ${MAX_PHOTOS}장까지만 추가할 수 있습니다.` });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const allowed = files.slice(0, remaining);
    const skipped = files.length - allowed.length;

    const newItems: ExtraPhotoItem[] = allowed.map((file, i) => ({
      uid: genUID(), receiptNumber,
      photoType: '기타' as ExtraPhotoType,
      comment: '',
      file, previewUrl: URL.createObjectURL(file),
      order: photos.length + i,
    }));
    const updated = [...photos, ...newItems];
    onPhotosChange(updated);
    await syncCache(updated);

    if (skipped > 0) {
      setStatusMsg({ type: 'err', text: `최대 ${MAX_PHOTOS}장 제한으로 ${skipped}장이 제외됐습니다.` });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── 사진 삭제 ────────────────────────────────────────────────────────────
  const handleDelete = async (uid: string) => {
    const target = photos.find(p => p.uid === uid);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const updated = photos.filter(p => p.uid !== uid).map((p, i) => ({ ...p, order: i }));
    onPhotosChange(updated);
    await syncCache(updated);
  };

  // ─── 태그 버튼 클릭 (프리셋 → 코멘트 입력란에 설정) ─────────────────────
  const handlePresetClick = (uid: string, preset: typeof PRESET_LABELS[number]) => {
    let nextComment: string;
    if (preset.freeInput) {
      // 기타: 기존 코멘트 유지하되 입력란 포커스
      nextComment = photos.find(p => p.uid === uid)?.comment ?? '';
      // preventScroll: 포커스 시 브라우저가 입력란으로 자동 스크롤하며 튀는 것 방지
      setTimeout(() => { commentRefs.current[uid]?.focus({ preventScroll: true }); commentRefs.current[uid]?.select(); }, 50);
    } else {
      nextComment = preset.label;
    }
    const updated = photos.map(p =>
      p.uid === uid ? { ...p, photoType: preset.type, comment: nextComment } : p
    );
    onPhotosChange(updated);
    // 포커스 후 캐시 저장은 blur에서
  };

  // ─── 코멘트 직접 입력 ─────────────────────────────────────────────────────
  const handleCommentChange = (uid: string, comment: string) => {
    onPhotosChange(photos.map(p => p.uid === uid ? { ...p, comment } : p));
  };

  const handleCommentBlur = async () => { await syncCache(photos); };

  // ─── A4 미리보기 ──────────────────────────────────────────────────────────
  const handleGenerateA4 = async () => {
    if (photos.length === 0) { setStatusMsg({ type: 'err', text: '사진이 없습니다.' }); return; }
    setIsGeneratingA4(true); setStatusMsg(null);
    try {
      const pages = await generateExtraPhotoA4Pages(
        photos.map(p => ({ file: p.file, photoType: p.photoType, comment: p.comment })),
        { receiptNumber, itemName: localItemName }
      );
      setA4PreviewUrls(pages);
      setShowA4Preview(true);
      setStatusMsg({ type: 'ok', text: `A4 ${pages.length}페이지 생성. 클릭하면 다운로드됩니다.` });
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: `A4 생성 실패: ${e.message}` });
    } finally { setIsGeneratingA4(false); }
  };

  // ─── ZIP 다운로드 ─────────────────────────────────────────────────────────
  const handleDownloadZip = async () => {
    if (photos.length === 0) { setStatusMsg({ type: 'err', text: '사진이 없습니다.' }); return; }
    setIsGeneratingZip(true); setStatusMsg(null);
    try {
      const zip = new JSZip();
      const sanitize = (s: string) => s.replace(/[/\\:?*"<>|]/g, '');
      photos.forEach((p, i) => {
        const ext = p.file.type === 'image/png' ? 'png' : 'jpg';
        const label = sanitize(p.comment || String(i + 1)).slice(0, 30) || String(i + 1);
        zip.file(`${String(i + 1).padStart(2, '0')}_${label}.${ext}`, p.file);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${receiptNumber}_추가사진자료_원본.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setStatusMsg({ type: 'ok', text: `원본 ZIP ${photos.length}장 다운로드 완료.` });
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: `ZIP 생성 실패: ${e.message}` });
    } finally { setIsGeneratingZip(false); }
  };

  // ─── KTL 전송 ─────────────────────────────────────────────────────────────
  const handleKtlSend = async () => {
    if (photos.length === 0) { setStatusMsg({ type: 'err', text: '전송할 사진이 없습니다.' }); return; }
    setIsSending(true); setStatusMsg(null);
    try {
      const result = await sendExtraPhotosToClaydox(
        receiptNumber, photos, userName, itemName, siteLocation,
        (msg) => setStatusMsg({ type: 'progress', text: msg })
      );
      setStatusMsg({ type: 'ok', text: result.message });
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: `전송 실패: ${e.message}` });
    } finally { setIsSending(false); }
  };

  // ─── 닫기 ─────────────────────────────────────────────────────────────────
  const handleClose = () => {
    setShowA4Preview(false); setA4PreviewUrls([]); setStatusMsg(null); onClose();
  };

  if (!isOpen) return null;
  const isBusy = isGeneratingA4 || isGeneratingZip || isSending || isCacheRestoring;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="relative w-full max-w-2xl max-h-[94vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── 헤더 */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-slate-700/70 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">📎 추가 사진자료</h2>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span className="text-sky-400 font-medium">{receiptNumber}</span>
              {itemName && (
                <>
                  <span className="text-slate-600">/</span>
                  <input
                    type="text"
                    value={localItemName}
                    onChange={(e) => setLocalItemName(e.target.value)}
                    title="A4 용지 항목명 — 직접 수정 가능 (예: TN, TP)"
                    className="bg-transparent border-b border-dashed border-slate-600 text-slate-300 text-xs focus:outline-none focus:border-sky-400 w-28 px-0.5"
                  />
                  <span className="text-slate-600 text-[10px]">✎</span>
                </>
              )}
            </p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors mt-0.5" aria-label="닫기">
            <XIcon />
          </button>
        </div>

        {/* ── 캐시 복원 배너 */}
        {cacheExists && photos.length === 0 && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-indigo-900/40 border border-indigo-600/50 rounded-lg flex items-center justify-between gap-3 shrink-0">
            <p className="text-xs text-indigo-300">📂 이전에 저장된 추가 사진 캐시가 있습니다.</p>
            <button onClick={handleRestoreFromCache} disabled={isBusy}
              className="shrink-0 text-xs px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50">
              {isCacheRestoring ? '복원 중...' : '복원'}
            </button>
          </div>
        )}

        {/* ── 상태 메시지 */}
        {statusMsg && (
          <p className={`mx-4 mt-2 text-xs px-3 py-1.5 rounded-md shrink-0 ${
            statusMsg.type === 'ok'       ? 'bg-green-900/40 text-green-300 border border-green-700/40' :
            statusMsg.type === 'progress' ? 'bg-sky-900/40 text-sky-300 border border-sky-700/40' :
                                            'bg-red-900/40 text-red-300 border border-red-700/40'
          }`}>
            {statusMsg.type === 'ok' ? '✅ ' : statusMsg.type === 'progress' ? '⏳ ' : '❌ '}
            {statusMsg.text}
          </p>
        )}

        {/* ── 사진 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <div className="text-4xl mb-3">📷</div>
              <p className="text-sm">추가 사진자료가 없습니다.</p>
              <p className="text-xs mt-1">아래 "사진 추가" 버튼으로 등록하세요.</p>
            </div>
          ) : (
            photos.map((photo, idx) => (
              <div key={photo.uid} className="flex gap-3 items-start p-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl">
                {/* 썸네일 */}
                <div className="shrink-0 relative">
                  <img src={photo.previewUrl} alt={`사진 ${idx + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-slate-600/50" />
                  <span className="absolute -top-1.5 -left-1.5 text-[10px] font-bold bg-slate-700 text-slate-300 rounded-full w-5 h-5 flex items-center justify-center border border-slate-600">
                    {idx + 1}
                  </span>
                </div>

                {/* 입력 영역 */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  {/* 프리셋 태그 버튼 */}
                  <div className="flex gap-1 flex-wrap">
                    {PRESET_LABELS.map(preset => {
                      const isActive = photo.photoType === preset.type && (preset.freeInput || photo.comment === preset.label);
                      return (
                        <button
                          key={preset.type}
                          onClick={() => handlePresetClick(photo.uid, preset)}
                          disabled={isBusy}
                          className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors disabled:opacity-40 ${
                            isActive
                              ? 'bg-sky-600 text-white border-sky-500'
                              : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600 hover:text-white'
                          }`}
                        >
                          {preset.label}{preset.freeInput ? ' ✎' : ''}
                        </button>
                      );
                    })}
                  </div>

                  {/* 코멘트 입력 (클릭 프리셋 후 직접 수정 가능) */}
                  <input
                    ref={(el) => { commentRefs.current[photo.uid] = el; }}
                    type="text"
                    value={photo.comment}
                    onChange={(e) => handleCommentChange(photo.uid, e.target.value)}
                    onBlur={() => handleCommentBlur()}
                    placeholder="직접 입력하거나 위 버튼을 클릭하세요"
                    disabled={isBusy}
                    className="w-full text-xs py-1.5 px-2.5 bg-slate-700 border border-slate-600 rounded-md text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-50"
                  />
                </div>

                {/* 삭제 버튼 */}
                <button onClick={() => handleDelete(photo.uid)} disabled={isBusy}
                  className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40 mt-0.5"
                  aria-label="이 사진 삭제">
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── A4 미리보기 */}
        {showA4Preview && a4PreviewUrls.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-700/70 space-y-2 shrink-0 max-h-64 overflow-y-auto">
            <p className="text-xs font-medium text-slate-400">📄 A4 미리보기 ({a4PreviewUrls.length}페이지) — 클릭 시 다운로드</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {a4PreviewUrls.map((url, i) => (
                <img key={i} src={url} alt={`A4 페이지 ${i + 1}`}
                  className="h-48 w-auto rounded-lg border border-slate-600/50 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = url; a.download = `${receiptNumber}_추가사진자료_A4_${i + 1}.jpg`; a.click();
                  }}
                  title={`페이지 ${i + 1} 다운로드`}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── 하단 액션 */}
        <div className="px-4 py-3 border-t border-slate-700/70 shrink-0 space-y-2">
          {/* 사진 추가 */}
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={handleFileSelect} disabled={isBusy || photos.length >= MAX_PHOTOS} />
            <button onClick={() => fileInputRef.current?.click()}
              disabled={isBusy || photos.length >= MAX_PHOTOS}
              className="w-full py-2 text-sm font-medium rounded-xl border-2 border-dashed border-slate-600 text-slate-400 hover:border-sky-500 hover:text-sky-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {photos.length >= MAX_PHOTOS
                ? `✋ 최대 ${MAX_PHOTOS}장 도달`
                : `+ 사진 추가 (${photos.length}/${MAX_PHOTOS}장)`}
            </button>
          </div>

          {/* A4 / ZIP / KTL 전송 */}
          <div className="grid grid-cols-3 gap-2">
            {/* A4 미리보기 */}
            <button onClick={handleGenerateA4} disabled={isBusy || photos.length === 0}
              className="py-2 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-0.5">
              {isGeneratingA4
                ? <span className="animate-pulse">생성 중…</span>
                : <><span className="text-base">📄</span><span>A4 미리보기</span></>}
            </button>

            {/* ZIP 다운로드 */}
            <button onClick={handleDownloadZip} disabled={isBusy || photos.length === 0}
              className="py-2 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-0.5">
              {isGeneratingZip
                ? <span className="animate-pulse">압축 중…</span>
                : <><span className="text-base">📦</span><span>원본 ZIP</span></>}
            </button>

            {/* KTL 전송 */}
            <button onClick={handleKtlSend} disabled={isBusy || photos.length === 0}
              className="py-2 text-xs font-medium rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-0.5">
              {isSending
                ? <span className="animate-pulse text-[10px]">전송 중…</span>
                : <><span className="text-base">📡</span><span>KTL 전송</span></>}
            </button>
          </div>

          <p className="text-[10px] text-slate-600 text-center">
            Claydox: A4 JPEG + 원본 ZIP → /uploadfiles | LABVIEW_RECEIPTNO: {receiptNumber}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ExtraPhotoModal;
