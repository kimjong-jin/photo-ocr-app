

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview, getFileExtensionFromMime } from './services/claydoxApiService';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ActionButton } from './components/ActionButton';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { generateCompositeImage, generateStampedImage, dataURLtoBlob } from './services/imageStampingService';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';
import { DrinkingWaterSnapshot } from './components/DrinkingWaterSnapshot';
import { ExtractedEntry } from './shared/types';
import PasswordModal from './components/PasswordModal';


// --- Interfaces ---
export interface DrinkingWaterJob {
id: string;
receiptNumber: string;
selectedItem: string;
details: string; // 상세 위치 (예: 배수지)
processedOcrData: ExtractedEntry[] | null;
decimalPlaces: number;
decimalPlacesCl?: number;
photos: ImageInfo[];
submissionStatus: 'idle' | 'sending' | 'success' | 'error';
submissionMessage?: string;
}

type KtlApiCallStatus = 'idle' | 'success' | 'error';

// --- Helper Functions ---
const formatSite = (site: string, details?: string) =>
  details && details.trim() ? `${site.trim()}_(${details.trim()})` : site.trim();

const getCurrentTimestampForInput = (): string => {
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hours = String(now.getHours()).padStart(2, '0');
const minutes = String(now.getMinutes()).padStart(2, '0');
return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const sanitizeFilenameComponent = (component: string): string => {
if (!component) return '';
return component.replace(/[/\\:?*\"<>|]/g, '').replace(/__+/g, '');
};

const getCurrentLocalDateTimeString = (): string => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
};

// --- Component ---
interface DrinkingWaterPageProps {
  userName: string;
  jobs: DrinkingWaterJob[];
  setJobs: React.Dispatch<React.SetStateAction<DrinkingWaterJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const CalendarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-4.5 12h22.5" />
  </svg>
);

const TableIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);


const DrinkingWaterPage: React.FC<DrinkingWaterPageProps> = ({ userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob }) => {
const [isLoading, setIsLoading] = useState<boolean>(false);
const [processingError, setProcessingError] = useState<string | null>(null);
const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
const fileInputRef = useRef<HTMLInputElement>(null);
const [currentPhotoIndexOfActiveJob, setCurrentPhotoIndexOfActiveJob] = useState<number>(-1);
const snapshotHostRef = useRef<HTMLDivElement | null>(null);
const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
const [isDateOverrideUnlocked, setIsDateOverrideUnlocked] = useState(false);
const [overrideDateTime, setOverrideDateTime] = useState('');

const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

const ocrControlsKtlStatus = useMemo<KtlApiCallStatus>(() => {
    if (!activeJob) return 'idle';
    if (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error') {
        return activeJob.submissionStatus;
    }
    return 'idle';
}, [activeJob]);
  
const updateActiveJob = useCallback((updater: (job: DrinkingWaterJob) => DrinkingWaterJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);

const resetSubmissionState = useCallback(() => {
    setProcessingError(null);
}, []);
  
useEffect(() => {
  if (activeJob && activeJob.photos.length > 0) {
      if (currentPhotoIndexOfActiveJob < 0 || currentPhotoIndexOfActiveJob >= activeJob.photos.length) {
          setCurrentPhotoIndexOfActiveJob(0);
      }
  } else {
      setCurrentPhotoIndexOfActiveJob(-1);
  }
}, [activeJob, currentPhotoIndexOfActiveJob]);

useEffect(() => {
  setIsDateOverrideUnlocked(false);
}, [activeJobId]);

const hypotheticalKtlFileNamesForPreview = useMemo(() => {
if (!activeJob) return [];

const fileNames: string[] = [];
const baseName = `${activeJob.receiptNumber}_먹는물_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}`;

if (activeJob.photos.length > 0) {
  fileNames.push(`${baseName}_composite.jpg`);
  fileNames.push(`${baseName}_압축.zip`);
}

if (activeJob.processedOcrData?.some(d => d.value.trim() !== '' || (d.valueTP && d.valueTP.trim() !== ''))) {
    fileNames.push(`${baseName}_datatable.png`);
}

return fileNames;
}, [activeJob]);

const ktlJsonPreview = useMemo(() => {
if (!activeJob || !userName || !siteLocation.trim()) return null;
const { receiptNumber, selectedItem, processedOcrData, details, decimalPlaces, decimalPlacesCl } = activeJob;

const finalSiteLocation = formatSite(siteLocation, details);

const payload: ClaydoxPayload = {
  receiptNumber,
  siteLocation: finalSiteLocation,
  item: selectedItem,
  ocrData: processedOcrData || [],
  updateUser: userName,
  pageType: 'DrinkingWater',
  maxDecimalPlaces: decimalPlaces,
  maxDecimalPlacesCl: decimalPlacesCl,
};
return generateKtlJsonForPreview(payload, selectedItem, hypotheticalKtlFileNamesForPreview);
}, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

const handleJobDetailChange = (field: keyof Pick<DrinkingWaterJob, 'decimalPlaces' | 'decimalPlacesCl' | 'details'>, value: number | string) => {
    updateActiveJob(j => ({ ...j, [field]: value, submissionStatus: 'idle', submissionMessage: undefined }));
    resetSubmissionState();
};

const handleClear = useCallback(() => {
if (!activeJobId) return;
updateActiveJob(job => {
    const clearedData = (job.processedOcrData || []).map(entry => ({
        ...entry,
        time: '',
        value: '',
        valueTP: entry.valueTP !== undefined ? '' : undefined,
    }));
    return { ...job, processedOcrData: clearedData, photos: [], submissionStatus: 'idle', submissionMessage: undefined };
});
setCurrentPhotoIndexOfActiveJob(-1);
if (fileInputRef.current) {
fileInputRef.current.value = '';
}
resetSubmissionState();
setIsDateOverrideUnlocked(false);
}, [activeJobId, resetSubmissionState, updateActiveJob]);

const handleEntryValueChange = (entryId: string, valueType: 'primary' | 'tp', newValue: string) => {
if (!activeJob || !activeJob.processedOcrData) return;

const updatedData = activeJob.processedOcrData.map(entry => {
  if (entry.id === entryId) {
    const updatedEntry = {
      ...entry,
      ...(valueType === 'primary' ? { value: newValue } : { valueTP: newValue })
    };
    const hasPrimaryValue = (valueType === 'primary' ? newValue : (entry.value || '')).trim() !== '';
    const hasTPValue = (valueType === 'tp' ? newValue : (entry.valueTP || ''))?.trim() !== '';
    
    if (hasPrimaryValue || hasTPValue) {
        if (!entry.time) {
          updatedEntry.time = getCurrentTimestampForInput();
        }
    } else {
        updatedEntry.time = '';
    }
    return updatedEntry;
  }
  return entry;
});
updateActiveJob(j => ({ ...j, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined }));
};

const handleEntryValueBlur = (entryId: string, valueType: 'primary' | 'tp') => {
if (!activeJob || !activeJob.processedOcrData) return;

const formatValue = (value: string | undefined, places: number): string => {
    if (value === null || value === undefined || value.trim() === '') return '';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toFixed(places);
};

const updatedData = activeJob.processedOcrData.map(entry => {
    if (entry.id === entryId) {
        const updatedEntry = { ...entry };
        const isResponseTime = entry.identifier?.startsWith('응답');
        
        if (!isResponseTime) { 
            if (valueType === 'primary') {
                updatedEntry.value = formatValue(entry.value, activeJob.decimalPlaces);
            } else if (valueType === 'tp' && activeJob.selectedItem === 'TU/CL') {
                updatedEntry.valueTP = formatValue(entry.valueTP, activeJob.decimalPlacesCl ?? activeJob.decimalPlaces);
            }
        }
        return updatedEntry;
    }
    return entry;
});
updateActiveJob(j => ({ ...j, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined }));
};

const handleOpenCamera = useCallback(() => {
if (!activeJobId) {
alert('먼저 사진을 추가할 작업을 선택해주세요.');
return;
}
setIsCameraOpen(true);
setProcessingError(null);
}, [activeJobId]);

const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

const handleActiveJobPhotosSet = useCallback((images: ImageInfo[]) => {
if (!activeJobId || images.length === 0) return;
updateActiveJob(job => {
    const wasInitialSet = job.photos.length === 0;
    const combined = [...job.photos, ...images];
    
    const uniqueImageMap = new Map<string, ImageInfo>();
    combined.forEach(img => {
        const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
        if (!uniqueImageMap.has(key)) {
            uniqueImageMap.set(key, img);
        }
    });
    const finalPhotos = Array.from(uniqueImageMap.values());

    if (wasInitialSet && finalPhotos.length > 0) {
        setCurrentPhotoIndexOfActiveJob(0);
    }

    return { ...job, photos: finalPhotos, submissionStatus: 'idle', submissionMessage: undefined };
});
resetSubmissionState();
}, [activeJobId, resetSubmissionState, updateActiveJob]);

const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
if (!activeJobId) return;
const capturedImageInfo: ImageInfo = { file, base64, mimeType };

let newIndex = -1;
updateActiveJob(job => {
    const newPhotos = [...job.photos, capturedImageInfo];
    newIndex = job.photos.length;
    return { ...job, photos: newPhotos, submissionStatus: 'idle', submissionMessage: undefined };
});

if (newIndex !== -1) {
  setCurrentPhotoIndexOfActiveJob(newIndex);
}
setIsCameraOpen(false);
resetSubmissionState();
}, [activeJobId, resetSubmissionState, updateActiveJob]);

const handleDeleteImage = useCallback((indexToDelete: number) => {
if (!activeJobId || indexToDelete < 0) return;

const currentJob = jobs.find(j => j.id === activeJobId);
if (!currentJob || indexToDelete >= currentJob.photos.length) return;

const newPhotos = currentJob.photos.filter((_, index) => index !== indexToDelete);

let newCurrentIndex = currentPhotoIndexOfActiveJob;
if (newPhotos.length === 0) {
    newCurrentIndex = -1;
} else if (newCurrentIndex >= newPhotos.length) {
    newCurrentIndex = newPhotos.length - 1;
} else if (newCurrentIndex > indexToDelete && newCurrentIndex > 0) {
    newCurrentIndex = newCurrentIndex - 1;
}

updateActiveJob(job => ({ ...job, photos: newPhotos, submissionStatus: 'idle', submissionMessage: undefined }));
setCurrentPhotoIndexOfActiveJob(newCurrentIndex);
resetSubmissionState();
}, [activeJobId, jobs, currentPhotoIndexOfActiveJob, resetSubmissionState, updateActiveJob]);

const handleInitiateSendToKtl = useCallback(() => {
if (!activeJob || !userName || !siteLocation.trim()) return;
if (userName === "게스트") {
alert("게스트 사용자는 KTL로 전송할 수 없습니다.");
return;
}
const hasValues = activeJob.processedOcrData?.some(entry =>
(entry.value && entry.value.trim() !== '') || (entry.valueTP && entry.valueTP.trim() !== '')
);
if (!hasValues) {
alert("전송할 입력된 데이터가 없습니다.");
return;
}
const finalSiteLocation = formatSite(siteLocation, activeJob.details);

setKtlPreflightData({
  jsonPayload: ktlJsonPreview || "JSON 미리보기를 생성할 수 없습니다.",
  fileNames: hypotheticalKtlFileNamesForPreview,
  context: {
    receiptNumber: activeJob.receiptNumber,
    siteLocation: finalSiteLocation,
    selectedItem: activeJob.selectedItem,
    userName
  }
});
setIsKtlPreflightModalOpen(true);
}, [activeJob, userName, ktlJsonPreview, siteLocation, hypotheticalKtlFileNamesForPreview]);

const handleSendToClaydoxConfirmed = useCallback(async () => {
    setIsKtlPreflightModalOpen(false);
    if (!activeJob || !userName || !siteLocation.trim()) {
        updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: "KTL 전송을 위한 필수 데이터가 누락되었습니다." }));
        return;
    }

    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "전송 중..." }));

    const finalSiteLocation = formatSite(siteLocation, activeJob.details);

    const payload: ClaydoxPayload = {
        receiptNumber: activeJob.receiptNumber,
        siteLocation: finalSiteLocation,
        item: activeJob.selectedItem,
        ocrData: activeJob.processedOcrData || [],
        updateUser: userName,
        pageType: 'DrinkingWater',
        maxDecimalPlaces: activeJob.decimalPlaces,
        maxDecimalPlacesCl: activeJob.decimalPlacesCl,
    };

    let filesToUpload: File[] = [];
    let actualKtlFileNames: string[] = [];

    try {
        let dataTableFile: File | null = null;
        if (snapshotHostRef.current) {
            const snapshotRoot = createRoot(snapshotHostRef.current);
            const renderPromise = new Promise<void>(resolve => {
                snapshotRoot.render(<DrinkingWaterSnapshot job={activeJob} siteLocation={siteLocation} />);
                setTimeout(resolve, 100); 
            });
            await renderPromise;

            const elementToCapture = document.getElementById(`snapshot-container-for-${activeJob.id}`);
            if (elementToCapture) {
                const canvas = await html2canvas(elementToCapture, {
                    backgroundColor: '#1e293b',
                    width: elementToCapture.offsetWidth,
                    height: elementToCapture.offsetHeight,
                    scale: 1.5,
                });
                const dataUrl = canvas.toDataURL('image/png');
                const blob = dataURLtoBlob(dataUrl);
                const dataTableFileName = `${activeJob.receiptNumber}_먹는물_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}_datatable.png`;
                dataTableFile = new File([blob], dataTableFileName, { type: 'image/png' });
            }
            snapshotRoot.unmount();
        }

        if (activeJob.photos.length > 0) {
            const imageInfosForComposite = activeJob.photos.map(img => ({ base64: img.base64, mimeType: img.mimeType }));
            const baseName = `${activeJob.receiptNumber}_먹는물_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}`;

            const compositeDataUrl = await generateCompositeImage(
                imageInfosForComposite,
                { receiptNumber: activeJob.receiptNumber, siteLocation: finalSiteLocation, item: activeJob.selectedItem },
                'image/jpeg'
            );
            const compositeBlob = dataURLtoBlob(compositeDataUrl);
            const compositeKtlFileName = `${baseName}_composite.jpg`;
            const compositeFile = new File([compositeBlob], compositeKtlFileName, { type: 'image/jpeg' });
            filesToUpload.push(compositeFile);
            actualKtlFileNames.push(compositeKtlFileName);

            const zip = new JSZip();
            for (let i = 0; i < activeJob.photos.length; i++) {
                const imageInfo = activeJob.photos[i];
                const stampedDataUrl = await generateStampedImage(
                    imageInfo.base64, imageInfo.mimeType, activeJob.receiptNumber, finalSiteLocation, '', activeJob.selectedItem
                );
                const stampedBlob = dataURLtoBlob(stampedDataUrl);
                const extension = 'png';
                const fileNameInZip = `${baseName}_${i + 1}.${extension}`;
                zip.file(fileNameInZip, stampedBlob);
            }

            if (Object.keys(zip.files).length > 0) {
                const zipBlob = await zip.generateAsync({ type: "blob" });
                const zipKtlFileName = `${baseName}_압축.zip`;
                const zipFile = new File([zipBlob], zipKtlFileName, { type: 'application/zip' });
                filesToUpload.push(zipFile);
                actualKtlFileNames.push(zipKtlFileName);
            }
        }

        if (dataTableFile) {
            filesToUpload.push(dataTableFile);
            actualKtlFileNames.push(dataTableFile.name);
        }

        const response = await sendToClaydoxApi(payload, filesToUpload, activeJob.selectedItem, actualKtlFileNames);
        updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message }));
    } catch (error: any) {
        updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${error.message}` }));
    }
}, [activeJob, userName, siteLocation, updateActiveJob]);

const handleOverrideDateTimeChange = useCallback((newDateTime: string) => {
    if (!activeJob || !activeJob.processedOcrData || !newDateTime) return;

    const updatedData = activeJob.processedOcrData.map(entry => {
        if (entry.time) { // Only update entries that already have a time
            return { ...entry, time: newDateTime };
        }
        return entry;
    });

    updateActiveJob(j => ({ ...j, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined }));
}, [activeJob, updateActiveJob]);

const handleDateTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDateTime = e.target.value;
    setOverrideDateTime(newDateTime);
    handleOverrideDateTimeChange(newDateTime);
};

const representativeActiveJobPhoto = useMemo(() =>
activeJob && activeJob.photos.length > 0 && currentPhotoIndexOfActiveJob !== -1
? activeJob.photos[currentPhotoIndexOfActiveJob]
: null
, [activeJob, currentPhotoIndexOfActiveJob]);

const isControlsDisabled = isLoading;
const isClaydoxDisabled = !activeJob || isControlsDisabled || !siteLocation.trim() || !activeJob.processedOcrData?.some(e => e.value.trim() || (e.valueTP && e.valueTP.trim()));

const StatusIndicator: React.FC<{ status: DrinkingWaterJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };

return (
<div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
  <div ref={snapshotHostRef} style={{ position: 'fixed', left: '-9999px', top: '0', pointerEvents: 'none', opacity: 0 }}></div>
  <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
    먹는물 분석 (P3)
  </h2>

  {jobs.length > 0 && (
    <div className="space-y-2">
      <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
      <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
        {jobs.map(job => (
          <div
            key={job.id}
            className={`p-2.5 rounded-md transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            <div className="flex justify-between items-center">
                <div className="flex-grow cursor-pointer" onClick={() => { setActiveJobId(job.id); resetSubmissionState(); setIsDateOverrideUnlocked(false); }}>
                    <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                    {job.receiptNumber} / {job.selectedItem} {job.details && `(${job.details})`}
                    </span>
                </div>
                <button
                onClick={(e) => { e.stopPropagation(); onDeleteJob(job.id); }}
                className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0"
                aria-label={`${job.receiptNumber} 작업 삭제`}
                disabled={isControlsDisabled}
                >
                    <TrashIcon />
                </button>
            </div>
             <div className="mt-1 text-right cursor-pointer self-start" onClick={() => { setActiveJobId(job.id); resetSubmissionState(); setIsDateOverrideUnlocked(false); }}>
                <StatusIndicator status={job.submissionStatus} message={job.submissionMessage} />
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
      <h3 className="text-lg font-semibold text-slate-100">
        활성 작업: {activeJob.receiptNumber} / {activeJob.selectedItem}
      </h3>
      
      <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-4">
        <div>
          <label htmlFor="job-details" className="block text-sm font-medium text-slate-300 mb-1">현장_상세 (편집 가능)</label>
            <input
              id="job-details"
              value={activeJob.details}
              onChange={(e) => handleJobDetailChange('details', e.target.value)}
              disabled={isControlsDisabled}
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
              placeholder="현장_상세 (예: 강남배수지)"
            />
        </div>
         {activeJob.selectedItem === 'TU/CL' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                  <label htmlFor="decimal-places-select-tu" className="block text-sm font-medium text-slate-300 mb-1">소수점 자릿수 (TU)</label>
                  <select
                    id="decimal-places-select-tu"
                    value={activeJob.decimalPlaces}
                    onChange={(e) => handleJobDetailChange('decimalPlaces', Number(e.target.value))}
                    disabled={isControlsDisabled}
                    className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
                  >
                    {[1, 2, 3, 4].map(p => <option key={p} value={p}>{p}자리</option>)}
                  </select>
              </div>
              <div>
                  <label htmlFor="decimal-places-select-cl" className="block text-sm font-medium text-slate-300 mb-1">소수점 자릿수 (Cl)</label>
                  <select
                    id="decimal-places-select-cl"
                    value={activeJob.decimalPlacesCl ?? 2}
                    onChange={(e) => handleJobDetailChange('decimalPlacesCl', Number(e.target.value))}
                    disabled={isControlsDisabled}
                    className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
                  >
                     {[1, 2, 3, 4].map(p => <option key={p} value={p}>{p}자리</option>)}
                  </select>
              </div>
          </div>
        ) : (
          <div>
            <label htmlFor="decimal-places-select" className="block text-sm font-medium text-slate-300 mb-1">소수점 자릿수 선택</label>
            <select
              id="decimal-places-select"
              value={activeJob.decimalPlaces}
              onChange={(e) => handleJobDetailChange('decimalPlaces', Number(e.target.value))}
              disabled={isControlsDisabled}
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
            >
              {[1, 2, 3, 4].map(p => <option key={p} value={p}>{p}자리 (0.{'0'.repeat(p - 1)}1)</option>)}
            </select>
          </div>
        )}
      </div>
      
       <div className="mt-4 pt-4 border-t border-slate-600 space-y-3">
        <h4 className="text-md font-semibold text-slate-200">
            '{activeJob.selectedItem}' 작업 참고 사진
        </h4>
        {isCameraOpen ? (
            <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
        ) : (
            <>
                <ImageInput
                    onImagesSet={handleActiveJobPhotosSet}
                    onOpenCamera={handleOpenCamera}
                    isLoading={isControlsDisabled}
                    ref={fileInputRef}
                    selectedImageCount={activeJob.photos.length}
                />
                {representativeActiveJobPhoto && (
                    <div className="self-start">
<ImagePreview
                        imageBase64={representativeActiveJobPhoto.base64}
                        fileName={representativeActiveJobPhoto.file.name}
                        mimeType={representativeActiveJobPhoto.mimeType}
                        receiptNumber={activeJob.receiptNumber}
                        siteLocation={siteLocation}
                        item={activeJob.selectedItem}
                        showOverlay={true}
                        totalSelectedImages={activeJob.photos.length}
                        currentImageIndex={currentPhotoIndexOfActiveJob}
                        onDelete={() => handleDeleteImage(currentPhotoIndexOfActiveJob)}
                    />
</div>
                )}
                <ThumbnailGallery
                    images={activeJob.photos}
                    currentIndex={currentPhotoIndexOfActiveJob}
                    onSelectImage={setCurrentPhotoIndexOfActiveJob}
                    onDeleteImage={handleDeleteImage}
                    disabled={isControlsDisabled}
                />
            </>
        )}
        </div>


      <OcrControls
        onClear={handleClear}
        isClearDisabled={isControlsDisabled}
        onInitiateSendToKtl={handleInitiateSendToKtl}
        isClaydoxDisabled={isClaydoxDisabled}
        isSendingToClaydox={activeJob.submissionStatus === 'sending'}
        ktlApiCallStatus={ocrControlsKtlStatus}
      />

      <div className="data-table-container space-y-2">
        <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-sky-400 flex items-center">
                <TableIcon className="w-6 h-6 mr-2"/> 데이터 입력
            </h3>
            <div className="flex items-center gap-2">
                {isDateOverrideUnlocked && (
                    <input
                        type="datetime-local"
                        id="datetime-override-input-p3"
                        value={overrideDateTime}
                        onChange={handleDateTimeInputChange}
                        className="p-2 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm text-slate-200"
                    />
                )}
                <button
                    onClick={() => {
                        if (isDateOverrideUnlocked) {
                            setIsDateOverrideUnlocked(false);
                        } else {
                            setIsPasswordModalOpen(true);
                        }
                    }}
                    className="p-1.5 text-slate-400 hover:text-sky-400 rounded-full transition-colors"
                    aria-label="날짜/시간 일괄 변경"
                >
                    <CalendarIcon className="w-5 h-5" />
                </button>
            </div>
        </div>

        <OcrResultDisplay
          ocrData={activeJob.processedOcrData}
          error={processingError}
          isLoading={false}
          contextProvided={true}
          hasImage={true}
          selectedItem={activeJob.selectedItem}
          onEntryPrimaryValueChange={(id, val) => handleEntryValueChange(id, 'primary', val)}
          onEntryValueTPChange={(id, val) => handleEntryValueChange(id, 'tp', val)}
          onEntryValueBlur={handleEntryValueBlur}
          onEntryIdentifierChange={() => { }} 
          onEntryIdentifierTPChange={() => { }} 
          onEntryTimeChange={() => { }} 
          onAddEntry={() => { }} 
          onReorderRows={() => { }}
          availableIdentifiers={[]} 
          tnIdentifiers={[]} 
          tpIdentifiers={[]}
          ktlJsonToPreview={ktlJsonPreview}
          isManualEntryMode={true}
          timeColumnHeader="최종 저장 시간"
          decimalPlaces={activeJob.decimalPlaces}
        />
      </div>
    </div>
  )}

  {isKtlPreflightModalOpen && ktlPreflightData && (
    <KtlPreflightModal
      isOpen={isKtlPreflightModalOpen}
      onClose={() => setIsKtlPreflightModalOpen(false)}
      onConfirm={handleSendToClaydoxConfirmed}
      preflightData={ktlPreflightData}
    />
  )}
  {isPasswordModalOpen && (
    <PasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSuccess={() => {
            setIsDateOverrideUnlocked(true);
            setOverrideDateTime(getCurrentLocalDateTimeString());
            setIsPasswordModalOpen(false);
        }}
    />
  )}
</div>
);
};
export default DrinkingWaterPage;
