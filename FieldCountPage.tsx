import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo as BaseImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { extractTextFromImage } from './services/geminiService';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import JSZip from 'jszip';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { Type } from '@google/genai';
import { PhotoLogJob as BasePhotoLogJob, ExtractedEntry as BaseExtractedEntry } from './PhotoLogPage';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';
import { dataURLtoBlob, generateStampedImage } from './services/imageStampingService';

type KtlApiCallStatus = 'idle' | 'success' | 'error';
type JobPhoto = BasePhotoLogJob['photos'][number];
type ExtractedEntry = BaseExtractedEntry;

interface RawEntrySingle { time: string; value: string; }
interface RawEntryTnTp { time: string; value_tn?: string; value_tp?: string; }
type RawEntryUnion = RawEntrySingle | RawEntryTnTp;

interface FieldCountPageProps {
  userName: string;
  jobs: BasePhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<BasePhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

// helpers
const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const sanitizeFilenameComponent = (s: string) => (s || '').replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
const mimeToExt = (mime: string) => {
  const t = (mime || '').toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  return 'jpg';
};

const generateIdentifierSequence = (ocrData: ExtractedEntry[] | null): string => {
  if (!ocrData) return '';
  const excludedBases = ['현장'];
  const baseOf = (id?: string) => {
    if (!id) return null;
    let b = id.replace(/[0-9]/g, '');
    if (b.endsWith('P')) b = b.slice(0, -1);
    if (!b || excludedBases.includes(b)) return null;
    return b;
  };
  let seq = '';
  for (const e of ocrData) {
    const a = baseOf(e.identifier); if (a) seq += a;
    const b = baseOf(e.identifierTP); if (b) seq += b;
  }
  return seq;
};

const generatePromptForFieldCount = (receiptNum: string, siteLoc: string, item: string) => {
  let p = `제공된 측정 장비의 이미지를 분석해주세요.\n컨텍스트:\n- 접수번호: ${receiptNum}\n- 현장/위치: ${siteLoc}\n- 항목/파라미터: ${item || '현장 계수 값'}`;
  if (item === 'TN/TP') {
    p += `\n- 이미지에서 TN 및 TP 각각의 시간 및 값 쌍을 추출해주세요. "value_tn"과 "value_tp" 필드를 사용하세요.`;
    p += `\n\n중요 규칙:\n1. 두 값 모두 있으면 둘 다 포함\n2. 한 값만 보이면 해당 키만 포함(다른 키는 생략)\n3. 값은 숫자만`;
    p += `\n\n예시:\n[\n  {"time":"2025/07/10 10:00","value_tn":"15.3","value_tp":"1.2"},\n  {"time":"2025/07/10 11:00","value_tn":"12.1"}\n]`;
  } else {
    p += `\n\n예시:\n[\n  {"time":"2025/07/10 10:00","value":"15.3"}\n]`;
  }
  p += `\n\n지침:\n- 반드시 유효한 JSON 배열만 응답\n- 값 필드는 숫자만, 단위/주석 제외\n- 없으면 []`;
  return p;
};

const FieldCountPage: React.FC<FieldCountPageProps> = ({
  userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob
}) => {
  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId) || null, [jobs, activeJobId]);

  const [isLoading, setIsLoading] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState(false);
  const [isKtlPreflightModalOpen, setKtlPreflightModalOpen] = useState(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(-1);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ocrControlsKtlStatus: KtlApiCallStatus = useMemo(() => {
    if (!activeJob) return 'idle';
    return (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error')
      ? activeJob.submissionStatus
      : 'idle';
  }, [activeJob]);

  useEffect(() => {
    if (!activeJob) return;
    const n = activeJob.photos.length;
    if (n > 0) {
      if (currentImageIndex < 0 || currentImageIndex >= n) setCurrentImageIndex(0);
    } else if (currentImageIndex !== -1) setCurrentImageIndex(-1);
  }, [activeJob, currentImageIndex]);

  const updateActiveJob = useCallback((updater: (job: BasePhotoLogJob) => BasePhotoLogJob) => {
    if (!activeJobId) return;
    setJobs(prev => prev.map(j => j.id === activeJobId ? updater(j) : j));
  }, [activeJobId, setJobs]);

  const resetActiveJobData = useCallback(() => {
    updateActiveJob(j => ({
      ...j, photos: [], photoComments: {}, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined
    }));
    setCurrentImageIndex(-1);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setProcessingError(null);
  }, [updateActiveJob]);

  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!activeJob || activeJob.photos.length === 0) return [];
    const sanitizedItem = sanitizeFilenameComponent(activeJob.selectedItem === 'TN/TP' ? 'TN_TP' : activeJob.selectedItem);
    const base = `${activeJob.receiptNumber}_${sanitizeFilenameComponent(siteLocation)}_${sanitizedItem}`;
    const ext = mimeToExt(activeJob.photos[0].mimeType);
    return [`${base}_composite.${ext}`, `${base}_Compression.zip`];
  }, [activeJob, siteLocation]);

  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;
    const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData);
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence,
      pageType: 'FieldCount',
    };
    return generateKtlJsonForPreview(payload, activeJob.selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

  const handleImagesSet = useCallback((files: BaseImageInfo[]) => {
    if (files.length === 0 && activeJob?.photos?.length) return;
    const withUid: JobPhoto[] = files.map(img => ({ ...img, uid: self.crypto.randomUUID() }));
    updateActiveJob(job => {
      const existing = job.photos || [];
      const all = [...existing, ...withUid];
      const uniq = new Map<string, JobPhoto>();
      all.forEach(img => {
        const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
        if (!uniq.has(key)) uniq.set(key, img);
      });
      return { ...job, photos: Array.from(uniq.values()), processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);
  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    const info: JobPhoto = { file, base64, mimeType, uid: self.crypto.randomUUID() };
    updateActiveJob(job => {
      const arr = [...(job.photos || []), info];
      setCurrentImageIndex(arr.length - 1);
      return { ...job, photos: arr, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setIsCameraOpen(false);
    setProcessingError(null);
  }, [updateActiveJob]);

  const handleDeleteImage = useCallback((idx: number) => {
    if (!activeJob || idx < 0 || idx >= activeJob.photos.length) return;
    const delUid = activeJob.photos[idx].uid;
    updateActiveJob(job => {
      const photos = job.photos.filter((_, i) => i !== idx);
      const comments = { ...job.photoComments }; delete comments[delUid];
      return { ...job, photos, photoComments: comments, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleExtractText = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) { setProcessingError('먼저 이미지를 선택해주세요.'); return; }
    setIsLoading(true); setProcessingError(null);
    updateActiveJob(j => ({ ...j, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined }));
    try {
      if (!(import.meta as any).env.VITE_API_KEY) throw new Error('VITE_API_KEY 환경 변수가 설정되지 않았습니다.');
      const schema = activeJob.selectedItem === 'TN/TP'
        ? { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value_tn: { type: Type.STRING }, value_tp: { type: Type.STRING } }, required: ['time'] } }
        : { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value: { type: Type.STRING } }, required: ['time', 'value'] } };
      const results = await Promise.allSettled(
        activeJob.photos.map(async (image) => {
          let raw = '';
          try {
            const prompt = generatePromptForFieldCount(activeJob.receiptNumber, siteLocation, activeJob.selectedItem);
            raw = await extractTextFromImage(image.base64, image.mimeType, prompt, { responseMimeType: 'application/json', responseSchema: schema });
            return JSON.parse(raw) as RawEntryUnion[];
          } catch (e: any) {
            const reason = e instanceof SyntaxError ? `JSON parsing failed: ${e.message}. AI: ${raw}` : e.message;
            throw new Error(reason);
          }
        })
      );
      const ok = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<RawEntryUnion[]>[];
      const all = ok.flatMap(r => r.value);
      const normalize = (t: string) => {
        if (!t) return '';
        const s = t.replace(/-/g, '/');
        const m = s.match(/(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2})/);
        return m ? m[1] : s;
      };
      const map = new Map<string, RawEntryUnion>();
      all.forEach(e => {
        const key = normalize(e.time);
        if (!map.has(key)) map.set(key, { ...e, time: key });
        else {
          const ex = map.get(key)!;
          if ('value' in e) {
            const exS = ex as RawEntrySingle, cur = e as RawEntrySingle;
            if (cur.value && !(exS as any).value) (exS as any).value = cur.value;
          } else {
            const exT = ex as RawEntryTnTp, cur = e as RawEntryTnTp;
            if (cur.value_tn && !exT.value_tn) exT.value_tn = cur.value_tn;
            if (cur.value_tp && !exT.value_tp) exT.value_tp = cur.value_tp;
          }
        }
      });
      const finalData: ExtractedEntry[] = Array.from(map.values()).sort((a,b)=>a.time.localeCompare(b.time)).map(e => {
        if ('value' in e) return { id: self.crypto.randomUUID(), time: e.time, value: (e as RawEntrySingle).value || '' };
        const t = e as RawEntryTnTp;
        return { id: self.crypto.randomUUID(), time: t.time, value: t.value_tn || '', valueTP: t.value_tp };
      });
      updateActiveJob(j => ({ ...j, processedOcrData: finalData }));
      if (results.some(r => r.status === 'rejected')) setProcessingError('일부 이미지를 처리하지 못했습니다.');
    } catch (err: any) {
      setProcessingError(err.message || '데이터 추출 중 오류 발생');
    } finally {
      setIsLoading(false);
    }
  }, [activeJob, siteLocation, updateActiveJob]);

  const handleEntryChange = (id: string, field: keyof ExtractedEntry, value: string | undefined) => {
    updateActiveJob(j => ({ ...j, processedOcrData: (j.processedOcrData || []).map(e => e.id === id ? { ...e, [field]: value } : e), submissionStatus: 'idle', submissionMessage: undefined }));
  };

  const handleAddEntry = useCallback(() => {
    updateActiveJob(j => ({ ...j, processedOcrData: [...(j.processedOcrData || []), { id: self.crypto.randomUUID(), time: '', value: '', valueTP: j.selectedItem === 'TN/TP' ? '' : undefined }], submissionStatus: 'idle', submissionMessage: undefined }));
  }, [updateActiveJob]);

  const handleReorderRows = useCallback((src: string, dst?: string) => {
    if (!activeJob || !activeJob.processedOcrData) return;
    const data = [...activeJob.processedOcrData];
    const srcIdx: number[] = [];
    if (src.includes('-')) {
      const [s, e] = src.split('-').map(v => parseInt(v.trim(), 10) - 1);
      if (!isNaN(s) && !isNaN(e) && s <= e) for (let i = s; i <= e; i++) srcIdx.push(i);
    } else {
      const i = parseInt(src.trim(), 10) - 1; if (!isNaN(i)) srcIdx.push(i);
    }
    const uniq = [...new Set(srcIdx)].sort((a,b)=>b-a);
    if (uniq.length===0 || uniq.some(i=>i<0||i>=data.length)) { alert('유효하지 않은 행 번호입니다.'); return; }
    const moved = uniq.map(i=>data[i]).reverse();
    uniq.forEach(i=>data.splice(i,1));
    let target = data.length;
    if (dst && dst.trim()) {
      const t = parseInt(dst.trim(), 10) - 1;
      if (!isNaN(t) && t >= 0 && t <= data.length) target = t;
      else { alert(`새 위치 번호가 잘못되었습니다. 1~${data.length + 1}`); return; }
    }
    data.splice(target, 0, ...moved);
    updateActiveJob(j => ({ ...j, processedOcrData: data, submissionStatus: 'idle', submissionMessage: undefined }));
  }, [activeJob, updateActiveJob]);

  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !ktlJsonPreview) { alert('KTL 전송 조건이 충족되지 않았습니다.'); return; }
    setKtlPreflightData({
      jsonPayload: ktlJsonPreview,
      fileNames: hypotheticalKtlFileNamesForPreview,
      context: { receiptNumber: activeJob.receiptNumber, siteLocation, selectedItem: activeJob.selectedItem, userName }
    });
    setKtlPreflightModalOpen(true);
  }, [activeJob, userName, siteLocation, ktlJsonPreview, hypotheticalKtlFileNamesForPreview]);

  // ★ 전송: composite=스탬프 적용본, ZIP=모든 원본(무가공)
  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false);

    try {
      // payload: 사진이 없어도 JSON만 전송 가능
      const payload: ClaydoxPayload = {
        receiptNumber: activeJob?.receiptNumber || '',
        siteLocation,
        item: activeJob?.selectedItem || '',
        updateUser: userName,
        ocrData: activeJob?.processedOcrData || [],
        pageType: 'FieldCount',
      };

      // 파일 준비
      const filesToSend: File[] = [];
      const uploadNames: string[] = [];

      if (activeJob && activeJob.photos.length > 0) {
        const sanitizedSite = sanitizeFilenameComponent(siteLocation);
        const sanitizedItem = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
        const base = `${activeJob.receiptNumber}_${sanitizedSite}_${sanitizedItem}`;

        // ✅ composite: 첫 장 스탬프 적용(가공본)
        const first = activeJob.photos[0];
        const stampedDataUrl = await generateStampedImage(
          first.base64,
          first.mimeType,
          activeJob.receiptNumber,
          siteLocation,
          '', // FieldCount는 별도 details 없음
          activeJob.selectedItem,
          undefined
        );
        const compositeMime = stampedDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        const compositeExt = compositeMime === 'image/png' ? 'png' : 'jpg';
        const compositeBlob = dataURLtoBlob(stampedDataUrl);
        const compositeFile = new File([compositeBlob], `${base}_composite.${compositeExt}`, { type: compositeMime });
        filesToSend.push(compositeFile);
        uploadNames.push(compositeFile.name);

        // ✅ ZIP: 모든 원본(무가공)
        const zip = new JSZip();
        for (const image of activeJob.photos) {
          const raw = `data:${image.mimeType};base64,${image.base64}`;
          zip.file(`${base}_${sanitizeFilenameComponent(image.file.name)}`, dataURLtoBlob(raw));
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipBlob], `${base}_Compression.zip`, { type: 'application/zip' });
        filesToSend.push(zipFile);
        uploadNames.push(zipFile.name);
      }

      updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: '전송 중...' }));
      const res = await sendToClaydoxApi(payload, filesToSend, activeJob?.selectedItem || '', uploadNames);
      updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: res.message }));
    } catch (e: any) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${e.message}` }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob]);

  const handleBatchSendToKtl = async () => {
    const targets = jobs.filter(j => j.processedOcrData && j.processedOcrData.length > 0); // 사진 없어도 JSON만 전송 가능
    if (targets.length === 0) { alert('전송할 작업이 없습니다.'); return; }

    setIsSendingToClaydox(true);
    setBatchSendProgress(`(0/${targets.length}) 작업 처리 시작...`);
    setJobs(prev => prev.map(j => targets.find(t => t.id === j.id) ? { ...j, submissionStatus: 'sending', submissionMessage: '대기 중...' } : j));

    for (let i = 0; i < targets.length; i++) {
      const job = targets[i];
      setBatchSendProgress(`(${i + 1}/${targets.length}) '${job.receiptNumber}' 전송 중...`);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionMessage: '파일 생성 및 전송 중...' } : j));
      try {
        const payload: ClaydoxPayload = {
          receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem,
          updateUser: userName, ocrData: job.processedOcrData!, pageType: 'FieldCount'
        };

        const filesToSend: File[] = [];
        const uploadNames: string[] = [];

        if (job.photos.length > 0) {
          const base = `${job.receiptNumber}_${sanitizeFilenameComponent(siteLocation)}_${sanitizeFilenameComponent(job.selectedItem.replace('/', '_'))}`;

          // ✅ composite: 첫 장 스탬프 적용(가공본)
          const first = job.photos[0];
          const stampedDataUrl = await generateStampedImage(
            first.base64,
            first.mimeType,
            job.receiptNumber,
            siteLocation,
            '',
            job.selectedItem,
            undefined
          );
          const compositeMime = stampedDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
          const compositeExt = compositeMime === 'image/png' ? 'png' : 'jpg';
          const compositeBlob = dataURLtoBlob(stampedDataUrl);
          const compositeFile = new File([compositeBlob], `${base}_composite.${compositeExt}`, { type: compositeMime });
          filesToSend.push(compositeFile);
          uploadNames.push(compositeFile.name);

          // ✅ ZIP: 모든 원본(무가공)
          const zip = new JSZip();
          for (const image of job.photos) {
            const raw = `data:${image.mimeType};base64,${image.base64}`;
            zip.file(`${base}_${sanitizeFilenameComponent(image.file.name)}`, dataURLtoBlob(raw));
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const zipFile = new File([zipBlob], `${base}_Compression.zip`, { type: 'application/zip' });
          filesToSend.push(zipFile);
          uploadNames.push(zipFile.name);
        }

        const res = await sendToClaydoxApi(payload, filesToSend, job.selectedItem, uploadNames);
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'success', submissionMessage: res.message || '전송 성공' } : j));
      } catch (e: any) {
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${e.message}` } : j));
      }
    }

    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  };

  const isControlsDisabled = isLoading || isSendingToClaydox || isCameraOpen || !!batchSendProgress;
  const representativeImageData = activeJob && currentImageIndex !== -1 ? activeJob.photos[currentImageIndex] : null;

  const StatusIndicator: React.FC<{ status: BasePhotoLogJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };

  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">현장 계수 (P2)</h2>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id} className={`p-2.5 rounded-md transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex-grow cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                    <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>{job.receiptNumber} / {job.selectedItem}</span>
                  </div>
                  <button onClick={(e)=>{e.stopPropagation(); onDeleteJob(job.id);}} className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0" title="이 작업 삭제" aria-label={`'${job.receiptNumber}' 작업 삭제`}>
                    <TrashIcon/>
                  </button>
                </div>
                <div className="mt-1 text-right cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                  <StatusIndicator status={job.submissionStatus} message={job.submissionMessage}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!activeJob && jobs.length > 0 && <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>}
      {!activeJob && jobs.length === 0 && <p className="text-center text-slate-400 p-4">시작하려면 '공통 정보 및 작업 관리' 섹션에서 작업을 추가하세요.</p>}

      {activeJob && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          {isCameraOpen ? (
            <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
          ) : (
            <>
              <ImageInput onImagesSet={handleImagesSet} onOpenCamera={handleOpenCamera} isLoading={isControlsDisabled} ref={fileInputRef} selectedImageCount={activeJob.photos.length} />
              {representativeImageData && (
                <ImagePreview
                  imageBase64={representativeImageData.base64}
                  fileName={representativeImageData.file.name}
                  mimeType={representativeImageData.mimeType}
                  receiptNumber={activeJob.receiptNumber}
                  siteLocation={siteLocation}
                  item={activeJob.selectedItem}
                  /* 오버레이 혼동 방지를 위해 OFF */
                  showOverlay={false}
                  totalSelectedImages={activeJob.photos.length}
                  currentImageIndex={currentImageIndex}
                  onDelete={() => handleDeleteImage(currentImageIndex)}
                />
              )}
              <ThumbnailGallery images={activeJob.photos} currentIndex={currentImageIndex} onSelectImage={setCurrentImageIndex} onDeleteImage={handleDeleteImage} disabled={isControlsDisabled} />
            </>
          )}
          <OcrControls
            onExtract={handleExtractText}
            onClear={resetActiveJobData}
            isExtractDisabled={isControlsDisabled || activeJob.photos.length === 0}
            isClearDisabled={isControlsDisabled || activeJob.photos.length === 0}
            onInitiateSendToKtl={handleInitiateSendToKtl}
            isClaydoxDisabled={isControlsDisabled || !activeJob.processedOcrData || activeJob.processedOcrData.length === 0 || activeJob.submissionStatus === 'sending'}
            isSendingToClaydox={isSendingToClaydox || (activeJob?.submissionStatus === 'sending')}
            ktlApiCallStatus={ocrControlsKtlStatus}
          />
          <OcrResultDisplay
            ocrData={activeJob.processedOcrData}
            error={processingError}
            isLoading={isLoading}
            contextProvided={true}
            hasImage={activeJob.photos.length > 0}
            selectedItem={activeJob.selectedItem}
            onEntryIdentifierChange={(id, val) => handleEntryChange(id, 'identifier', val)}
            onEntryIdentifierTPChange={(id, val) => handleEntryChange(id, 'identifierTP', val)}
            onEntryTimeChange={(id, val) => handleEntryChange(id, 'time', val)}
            onEntryPrimaryValueChange={(id, val) => handleEntryChange(id, 'value', val)}
            onEntryValueTPChange={(id, val) => handleEntryChange(id, 'valueTP', val)}
            onAddEntry={handleAddEntry}
            onReorderRows={handleReorderRows}
            availableIdentifiers={TN_IDENTIFIERS}
            tnIdentifiers={TN_IDENTIFIERS}
            tpIdentifiers={TP_IDENTIFIERS}
            rawJsonForCopy={JSON.stringify(activeJob.processedOcrData, null, 2)}
            ktlJsonToPreview={ktlJsonPreview}
            timeColumnHeader="측정 시간"
          />
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
          <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
          <p className="text-sm text-slate-400">이 페이지의 모든 유효한 작업(데이터가 있는)을 KTL로 전송합니다.</p>
          {batchSendProgress && (
            <div className="p-3 bg-slate-700/50 rounded-md text-sky-300 text-sm flex items-center gap-2">
              <Spinner size="sm" />
              <span>{batchSendProgress}</span>
            </div>
          )}
          <ActionButton
            onClick={handleBatchSendToKtl}
            disabled={isControlsDisabled || jobs.filter(j => j.processedOcrData && j.processedOcrData.length > 0).length === 0}
            fullWidth
            variant="secondary"
            className="bg-teal-600 hover:bg-teal-500"
          >
            {isSendingToClaydox ? '전송 중...' : `이 페이지의 모든 작업 전송 (${jobs.filter(j => j.processedOcrData && j.photos.length >= 0).length}건)`}
          </ActionButton>
        </div>
      )}

      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal isOpen={isKtlPreflightModalOpen} onClose={() => setKtlPreflightModalOpen(false)} onConfirm={handleSendToClaydoxConfirmed} preflightData={ktlPreflightData} />
      )}
    </div>
  );
};

export default FieldCountPage;
