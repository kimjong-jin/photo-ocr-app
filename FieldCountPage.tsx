// FieldCountPage.tsx (풀버전)

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { extractTextFromImage } from './services/geminiService';
import { generateStampedImage, dataURLtoBlob, generateCompositeImage } from './services/imageStampingService';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import JSZip from 'jszip';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { PhotoLogJob, ExtractedEntry } from './PhotoLogPage';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { P2_SINGLE_ITEM_IDENTIFIERS, TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';

// ===== Types =====
type KtlApiCallStatus = 'idle' | 'success' | 'error';

interface RawEntrySingle {
  time: string;
  value: string;
}
interface RawEntryTnTp {
  time: string;
  value_tn?: string;
  value_tp?: string;
}
type RawEntryUnion = RawEntrySingle | RawEntryTnTp;

// ===== Icons =====
const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none"
       viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
       className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round"
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 
          1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 
          2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 
          5.79m14.456 0a48.108 48.108 0 
          00-3.478-.397m-12.56 0c1.153 0 
          2.24.03 3.22.077m3.22-.077L10.88 
          5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

// ===== Utils =====
const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return '';
  return component.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
};

const normalizeTime = (timeStr: string): string => {
  if (!timeStr) return '';
  const standardized = timeStr.replace(/-/g, '/');
  const match = standardized.match(/(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2})/);
  return match ? match[1] : standardized.trim();
};

const generatePromptForFieldCount = (
  receiptNum: string,
  siteLoc: string,
  item: string
): string => {
  let prompt = `제공된 측정 장비의 이미지를 분석해주세요.
컨텍스트:
- 접수번호: ${receiptNum}
- 현장/위치: ${siteLoc}
- 항목/파라미터: ${item || '현장 계수 값'}

지시사항:
- 표/디스플레이에서 측정시간과 값 쌍을 모두 추출하세요.
- 반드시 유효한 "단일 JSON 배열"만 반환하세요. (배열 밖 텍스트 금지)
- 값에는 숫자만 포함(단위/주석 제거). 데이터가 없으면 []를 반환.

예시(단일 항목):
[
  { "time": "2025/07/10 10:00", "value": "15.3" },
  { "time": "2025/07/10 11:00", "value": "12.1" }
]

예시(TN/TP):
[
  { "time": "2025/07/10 10:00", "value_tn": "15.3", "value_tp": "1.2" },
  { "time": "2025/07/10 11:00", "value_tn": "12.1" },
  { "time": "2025/07/10 12:00", "value_tp": "0.9" }
]`;

  if (item === 'TN/TP') {
    prompt += `
- 같은 시간대에 TN과 TP 값이 모두 명확하면 둘 다 포함.
- 한쪽만 있으면 있는 쪽 키만 포함하세요.`;
  }
  return prompt;
};

const generateIdentifierSequence = (ocrData: ExtractedEntry[] | null): string => {
  if (!ocrData) return '';
  let sequence = '';
  const excludedBases = ['현장'];

  const processSingleIdentifier = (idVal?: string | null): string | null => {
    if (!idVal) return null;
    let base = idVal.replace(/[0-9]/g, '');
    if (base.endsWith('P')) base = base.slice(0, -1);
    if (excludedBases.includes(base)) return null;
    return base.length > 0 ? base : null;
  };

  for (const entry of ocrData) {
    const part = processSingleIdentifier(entry.identifier as any);
    if (part) sequence += part;
    // 일부 데이터에 identifierTP가 있을 수 있음
    const tpPart = processSingleIdentifier((entry as any).identifierTP);
    if (tpPart) sequence += tpPart;
  }
  return sequence;
};

// ===== Props =====
interface FieldCountPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

// ===== Component =====
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

  // ---- Derived ----
  const ocrControlsKtlStatus: KtlApiCallStatus = useMemo(() => {
    if (!activeJob) return 'idle';
    if (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error') {
      return activeJob.submissionStatus;
    }
    return 'idle';
  }, [activeJob]);

  // ---- Effects ----
  useEffect(() => {
    if (activeJob && activeJob.photos.length > 0) {
      if (currentImageIndex < 0 || currentImageIndex >= activeJob.photos.length) {
        setCurrentImageIndex(0);
      }
    } else {
      setCurrentImageIndex(-1);
    }
  }, [activeJob, currentImageIndex]);

  // ---- Helpers ----
  const updateActiveJob = useCallback((updater: (job: PhotoLogJob) => PhotoLogJob) => {
    if (!activeJobId) return;
    setJobs(prev => prev.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);

  const resetActiveJobData = useCallback(() => {
    updateActiveJob(job => ({
      ...job,
      photos: [],
      photoComments: {},
      processedOcrData: null,
      submissionStatus: 'idle',
      submissionMessage: undefined
    }));
    setCurrentImageIndex(-1);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setProcessingError(null);
  }, [updateActiveJob]);

  // ---- Image handlers ----
  const handleImagesSet = useCallback((newlySelectedImages: ImageInfo[]) => {
    if (!activeJobId) return;
    if (newlySelectedImages.length === 0 && activeJob?.photos?.length) return;

    updateActiveJob(job => {
      const existingPhotos = job.photos || [];
      const combined = [...existingPhotos, ...newlySelectedImages];

      const uniqueImageMap = new Map<string, ImageInfo>();
      combined.forEach(img => {
        const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
        if (!uniqueImageMap.has(key)) uniqueImageMap.set(key, img);
      });
      const finalPhotos = Array.from(uniqueImageMap.values());
      if (existingPhotos.length === 0 && finalPhotos.length > 0) setCurrentImageIndex(0);

      return {
        ...job,
        photos: finalPhotos,
        processedOcrData: null,
        submissionStatus: 'idle',
        submissionMessage: undefined
      };
    });
    setProcessingError(null);
  }, [activeJob, activeJobId, updateActiveJob]);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    if (!activeJobId) return;
    updateActiveJob(job => {
      const newPhotos = [...(job.photos || []), { file, base64, mimeType }];
      return {
        ...job,
        photos: newPhotos,
        processedOcrData: null,
        submissionStatus: 'idle',
        submissionMessage: undefined
      };
    });
    setCurrentImageIndex(prev => (prev === -1 ? 0 : prev + 1));
    setIsCameraOpen(false);
    setProcessingError(null);
  }, [activeJobId, updateActiveJob]);

  const handleDeleteImage = useCallback((indexToDelete: number) => {
    if (!activeJob) return;
    if (indexToDelete < 0 || indexToDelete >= activeJob.photos.length) return;

    updateActiveJob(job => {
      const newPhotos = job.photos.filter((_, index) => index !== indexToDelete);
      return { ...job, photos: newPhotos, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });

    setCurrentImageIndex(prev => {
      if (activeJob.photos.length - 1 === 0) return -1;
      if (prev >= activeJob.photos.length - 1) return activeJob.photos.length - 2;
      if (prev > indexToDelete) return prev - 1;
      return prev;
    });

    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  // ---- OCR ----
  const handleExtractText = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      setProcessingError('먼저 이미지를 선택해주세요.');
      return;
    }
    setIsLoading(true);
    setProcessingError(null);
    updateActiveJob(j => ({ ...j, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined }));

    try {
      const prompt = generatePromptForFieldCount(activeJob.receiptNumber, siteLocation, activeJob.selectedItem);
      const config = { temperature: 0 }; // REST 버전 호환-safe

      const promises = activeJob.photos.map(async (image) => {
        let jsonStr = '';
        try {
          jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, config);
          const arr = JSON.parse(jsonStr) as RawEntryUnion[];
          return arr;
        } catch (err: any) {
          const reason = err instanceof SyntaxError ? `JSON parsing failed: ${err.message}. AI response: ${jsonStr}` : err.message;
          return Promise.reject(new Error(reason));
        }
      });

      const results = await Promise.allSettled(promises);

      const allEntries = results
        .filter((res): res is PromiseFulfilledResult<RawEntryUnion[]> => res.status === 'fulfilled')
        .flatMap(res => res.value);

      // merge by normalized time
      const uniqueByTime = new Map<string, RawEntryUnion>();
      for (const entry of allEntries) {
        const t = normalizeTime(entry.time);
        if (!t) continue;

        if (!uniqueByTime.has(t)) {
          uniqueByTime.set(t, { ...entry, time: t });
        } else {
          const existing = uniqueByTime.get(t)!;
          if (activeJob.selectedItem === 'TN/TP') {
            const ex = existing as RawEntryTnTp;
            const cur = entry as RawEntryTnTp;
            if (cur.value_tn && !ex.value_tn) ex.value_tn = cur.value_tn;
            if (cur.value_tp && !ex.value_tp) ex.value_tp = cur.value_tp;
          } else {
            const ex = existing as RawEntrySingle;
            const cur = entry as RawEntrySingle;
            if (cur.value && !ex.value) ex.value = cur.value;
          }
        }
      }

      const finalOcrData: ExtractedEntry[] = Array.from(uniqueByTime.values())
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(raw => {
          let primaryValue = '', tpValue: string | undefined;
          if (activeJob.selectedItem === 'TN/TP') {
            primaryValue = (raw as RawEntryTnTp).value_tn || '';
            tpValue = (raw as RawEntryTnTp).value_tp;
          } else {
            primaryValue = (raw as RawEntrySingle).value || '';
          }
          return {
            id: crypto.randomUUID(),
            time: raw.time,
            value: (primaryValue ?? '').trim(),
            valueTP: (tpValue ?? '').trim() || undefined
          } as ExtractedEntry;
        });

      updateActiveJob(j => ({ ...j, processedOcrData: finalOcrData }));
      if (results.some(r => r.status === 'rejected')) {
        setProcessingError('일부 이미지를 처리하지 못했습니다.');
      }
    } catch (e: any) {
      setProcessingError(e?.message || '데이터 추출 중 오류 발생');
    } finally {
      setIsLoading(false);
    }
  }, [activeJob, siteLocation, updateActiveJob]);

  const handleEntryChange = (id: string, field: keyof ExtractedEntry, value: string | undefined) => {
    updateActiveJob(j => ({
      ...j,
      processedOcrData: (j.processedOcrData || []).map(e => e.id === id ? { ...e, [field]: value } : e),
      submissionStatus: 'idle',
      submissionMessage: undefined
    }));
  };

  const handleAddEntry = useCallback(() => {
    updateActiveJob(j => {
      const newEntry: ExtractedEntry = {
        id: crypto.randomUUID(),
        time: '',
        value: '',
        valueTP: j.selectedItem === 'TN/TP' ? '' : undefined
      };
      return {
        ...j,
        processedOcrData: [...(j.processedOcrData || []), newEntry],
        submissionStatus: 'idle',
        submissionMessage: undefined
      };
    });
  }, [updateActiveJob]);

  const handleReorderRows = useCallback((sourceRowStr: string, targetRowStr?: string) => {
    if (!activeJob || !activeJob.processedOcrData) return;

    const data = [...activeJob.processedOcrData];
    const sourceIndices: number[] = [];

    if (sourceRowStr.includes('-')) {
      const [start, end] = sourceRowStr.split('-').map(s => parseInt(s.trim(), 10) - 1);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) sourceIndices.push(i);
      }
    } else {
      const idx = parseInt(sourceRowStr.trim(), 10) - 1;
      if (!isNaN(idx)) sourceIndices.push(idx);
    }

    const uniqueSource = [...new Set(sourceIndices)].sort((a, b) => b - a);
    if (uniqueSource.length === 0 || uniqueSource.some(i => i < 0 || i >= data.length)) {
      alert("유효하지 않은 행 번호입니다. 데이터 범위 내 숫자 또는 '시작-끝' 형식으로 입력하세요.");
      return;
    }

    const moved = uniqueSource.map(i => data[i]).reverse();
    uniqueSource.forEach(i => data.splice(i, 1));

    let targetIndex = data.length;
    if (targetRowStr && targetRowStr.trim()) {
      const t = parseInt(targetRowStr.trim(), 10) - 1;
      if (!isNaN(t) && t >= 0 && t <= data.length) targetIndex = t;
      else {
        alert(`새 위치 번호가 잘못되었습니다. 1부터 ${data.length + 1} 사이로 입력하세요.`);
        return;
      }
    }

    data.splice(targetIndex, 0, ...moved);

    updateActiveJob(job => ({
      ...job,
      processedOcrData: data,
      submissionStatus: 'idle',
      submissionMessage: undefined
    }));
  }, [activeJob, updateActiveJob]);

  // ---- KTL JSON Preview ----
  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!activeJob) return [];
    const sanitizedItem = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
    const baseName = `${activeJob.receiptNumber}_수질_${sanitizedItem}_현장적용계수`;
    const names: string[] = [];
    if (activeJob.photos.length > 0) {
      names.push(`${baseName}.jpg`, `${baseName}.zip`);
    }
    return names;
  }, [activeJob]);

  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;

    const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData || []);
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: siteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence,
      pageType: 'FieldCount'
    };
    return generateKtlJsonForPreview(payload, activeJob.selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !ktlJsonPreview) {
      alert('KTL 전송을 위한 조건이 충족되지 않았습니다. (작업/사진/데이터/필수정보 확인)');
      return;
    }
    setKtlPreflightData({
      jsonPayload: ktlJsonPreview,
      fileNames: hypotheticalKtlFileNamesForPreview,
      context: {
        receiptNumber: activeJob.receiptNumber,
        siteLocation: siteLocation,
        selectedItem: activeJob.selectedItem,
        userName
      }
    });
    setKtlPreflightModalOpen(true);
  }, [activeJob, ktlJsonPreview, hypotheticalKtlFileNamesForPreview, siteLocation, userName]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: 'KTL 전송을 위한 필수 데이터가 누락되었습니다.' }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: '전송 중...' }));

    try {
      const baseName = `${activeJob.receiptNumber}_수질_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}_현장적용계수`;

      const compositeDataUrl = await generateCompositeImage(
        activeJob.photos,
        { receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem },
        'image/jpeg'
      );
      const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });

      const zip = new JSZip();
      for (let i = 0; i < activeJob.photos.length; i++) {
        const imageInfo = activeJob.photos[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64, imageInfo.mimeType, activeJob.receiptNumber, siteLocation, '',
          activeJob.selectedItem, (activeJob as any).photoComments?.[imageInfo.file.name]
        );
        zip.file(`${baseName}_${i + 1}.png`, dataURLtoBlob(stampedDataUrl));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([zipBlob], `${baseName}.zip`, { type: 'application/zip' });

      const payload: ClaydoxPayload = {
        receiptNumber: activeJob.receiptNumber,
        siteLocation,
        item: activeJob.selectedItem,
        updateUser: userName,
        ocrData: activeJob.processedOcrData,
        pageType: 'FieldCount'
      };

      const response = await sendToClaydoxApi(
        payload,
        [compositeFile, zipFile],
        activeJob.selectedItem,
        [compositeFile.name, zipFile.name]
      );

      updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message || '전송 성공' }));
    } catch (error: any) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${error.message}` }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob]);

  // ---- Batch send ----
  const handleBatchSendToKtl = useCallback(async () => {
    const jobsToSend = jobs.filter(j => j.processedOcrData && j.processedOcrData.length > 0 && j.photos.length > 0);
    if (jobsToSend.length === 0) {
      alert('전송할 데이터가 있는 작업이 없습니다. 각 작업에 사진과 추출된 데이터가 있는지 확인하세요.');
      return;
    }

    setIsSendingToClaydox(true);
    setBatchSendProgress(`(0/${jobsToSend.length}) 작업 처리 시작...`);
    setJobs(prev => prev.map(j => jobsToSend.find(jts => jts.id === j.id)
      ? { ...j, submissionStatus: 'sending', submissionMessage: '대기 중...' }
      : j
    ));

    for (let i = 0; i < jobsToSend.length; i++) {
      const job = jobsToSend[i];
      setBatchSendProgress(`(${i + 1}/${jobsToSend.length}) '${job.receiptNumber}' 전송 중...`);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionMessage: '파일 생성 및 전송 중...' } : j));

      try {
        const baseName = `${job.receiptNumber}_수질_${sanitizeFilenameComponent(job.selectedItem.replace('/', '_'))}_현장적용계수`;

        const compositeDataUrl = await generateCompositeImage(
          job.photos, { receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem }, 'image/jpeg'
        );
        const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });

        const zip = new JSZip();
        for (const imageInfo of job.photos) {
          const stampedDataUrl = await generateStampedImage(
            imageInfo.base64, imageInfo.mimeType, job.receiptNumber, siteLocation, '',
            job.selectedItem, (job as any).photoComments?.[imageInfo.file.name]
          );
          zip.file(`${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`, dataURLtoBlob(stampedDataUrl));
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipBlob], `${baseName}.zip`, { type: 'application/zip' });

        const payload: ClaydoxPayload = {
          receiptNumber: job.receiptNumber,
          siteLocation,
          item: job.selectedItem,
          updateUser: userName,
          ocrData: job.processedOcrData!,
          pageType: 'FieldCount'
        };

        const response = await sendToClaydoxApi(
          payload, [compositeFile, zipFile], job.selectedItem, [compositeFile.name, zipFile.name]
        );

        setJobs(prev => prev.map(j => j.id === job.id
          ? { ...j, submissionStatus: 'success', submissionMessage: response.message || '전송 성공' }
          : j
        ));
      } catch (error: any) {
        setJobs(prev => prev.map(j => j.id === job.id
          ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}` }
          : j
        ));
      }
    }

    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  }, [jobs, setJobs, siteLocation, userName]);

  // ---- UI flags ----
  const isControlsDisabled = isLoading || isSendingToClaydox || isCameraOpen || !!batchSendProgress;
  const representativeImageData = activeJob && currentImageIndex !== -1 ? activeJob.photos[currentImageIndex] : null;

  const StatusIndicator: React.FC<{ status: PhotoLogJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };

  // ---- Render ----
  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">현장 계수 (P2)</h2>

      {/* 작업 목록 */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id}
                   className={`p-2.5 rounded-md transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex-grow cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                    <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                      {job.receiptNumber} / {job.selectedItem}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteJob(job.id); }}
                    className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0"
                    aria-label={`${job.receiptNumber} 작업 삭제`}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className="mt-1 text-right cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                  <StatusIndicator status={job.submissionStatus} message={job.submissionMessage} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!activeJob && jobs.length > 0 && (
        <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>
      )}
      {!activeJob && jobs.length === 0 && (
        <p className="text-center text-slate-400 p-4">시작하려면 '공통 정보 및 작업 관리' 섹션에서 작업을 추가하세요.</p>
      )}

      {/* 활성 작업 */}
      {activeJob && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          {isCameraOpen ? (
            <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
          ) : (
            <>
              <ImageInput
                onImagesSet={handleImagesSet}
                onOpenCamera={handleOpenCamera}
                isLoading={isControlsDisabled}
                ref={fileInputRef}
                selectedImageCount={activeJob.photos.length}
              />
              {representativeImageData && (
                <div className="self-start">
                  <ImagePreview
                    imageBase64={representativeImageData.base64}
                    fileName={representativeImageData.file.name}
                    mimeType={representativeImageData.mimeType}
                    receiptNumber={activeJob.receiptNumber}
                    siteLocation={siteLocation}
                    item={activeJob.selectedItem}
                    showOverlay={true}
                    totalSelectedImages={activeJob.photos.length}
                    currentImageIndex={currentImageIndex}
                    onDelete={() => handleDeleteImage(currentImageIndex)}
                  />
                </div>
              )}
              <ThumbnailGallery
                images={activeJob.photos}
                currentIndex={currentImageIndex}
                onSelectImage={setCurrentImageIndex}
                onDeleteImage={handleDeleteImage}
                disabled={isControlsDisabled}
              />
            </>
          )}

          <OcrControls
            onExtract={handleExtractText}
            onClear={resetActiveJobData}
            isExtractDisabled={isControlsDisabled || activeJob.photos.length === 0}
            isClearDisabled={isControlsDisabled || activeJob.photos.length === 0}
            onInitiateSendToKtl={handleInitiateSendToKtl}
            isClaydoxDisabled={isControlsDisabled || !activeJob.processedOcrData || activeJob.processedOcrData.length === 0}
            isSendingToClaydox={isSendingToClaydox || activeJob.submissionStatus === 'sending'}
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
            onEntryIdentifierTPChange={(id, val) => handleEntryChange(id, 'identifierTP' as any, val)}
            onEntryTimeChange={(id, val) => handleEntryChange(id, 'time', val)}
            onEntryPrimaryValueChange={(id, val) => handleEntryChange(id, 'value', val)}
            onEntryValueTPChange={(id, val) => handleEntryChange(id, 'valueTP', val)}
            onAddEntry={handleAddEntry}
            onReorderRows={handleReorderRows}
            availableIdentifiers={P2_SINGLE_ITEM_IDENTIFIERS}
            tnIdentifiers={TN_IDENTIFIERS}
            tpIdentifiers={TP_IDENTIFIERS}
            rawJsonForCopy={JSON.stringify(activeJob.processedOcrData, null, 2)}
            ktlJsonToPreview={ktlJsonPreview}
            timeColumnHeader="측정 시간"
          />
        </div>
      )}

      {/* 일괄 전송 섹션 */}
      {jobs.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
          <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
          <p className="text-sm text-slate-400">
            이 페이지의 유효한 모든 작업(사진+데이터 있음)을 KTL로 전송합니다. 안정적인 네트워크에서 실행하세요.
          </p>
          {batchSendProgress && (
            <div className="p-3 bg-slate-700/50 rounded-md text-sky-300 text-sm flex items-center gap-2">
              <Spinner size="sm" />
              <span>{batchSendProgress}</span>
            </div>
          )}
          <ActionButton
            onClick={handleBatchSendToKtl}
            disabled={isControlsDisabled || jobs.filter(j => j.processedOcrData && j.photos.length > 0).length === 0}
            fullWidth
            variant="secondary"
            className="bg-teal-600 hover:bg-teal-500"
          >
            {isSendingToClaydox
              ? '전송 중...'
              : `이 페이지의 모든 작업 전송 (${jobs.filter(j => j.processedOcrData && j.photos.length > 0).length}건)`}
          </ActionButton>
        </div>
      )}

      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal
          isOpen={isKtlPreflightModalOpen}
          onClose={() => setKtlPreflightModalOpen(false)}
          onConfirm={handleSendToClaydoxConfirmed}
          preflightData={ktlPreflightData}
        />
      )}
    </div>
  );
};

export default FieldCountPage;
