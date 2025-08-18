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
import { Type } from '@google/genai';
import { PhotoLogJob, ExtractedEntry } from './PhotoLogPage'; // Reuse type from PhotoLogPage
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { P2_SINGLE_ITEM_IDENTIFIERS, TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';

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

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return '';
  return component.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
};

const generateIdentifierSequence = (ocrData: ExtractedEntry[] | null): string => {
    if (!ocrData) return "";
    let sequence = "";
    const excludedBases = ["현장"];
  
    const processSingleIdentifier = (idVal: string | undefined): string | null => {
      if (!idVal) return null;
      let base = idVal.replace(/[0-9]/g, '');
      if (base.endsWith('P')) base = base.slice(0, -1);
      if (excludedBases.includes(base)) return null;
      return base.length > 0 ? base : null;
    };
  
    for (const entry of ocrData) {
        const part = processSingleIdentifier(entry.identifier);
        if (part) sequence += part;
        const tpPart = processSingleIdentifier(entry.identifierTP);
        if (tpPart) sequence += tpPart;
    }
    return sequence;
};

const generatePromptForFieldCount = (
    receiptNum: string,
    siteLoc: string,
    item: string
): string => {
    let prompt = `제공된 측정 장비의 이미지를 분석해주세요.\n컨텍스트:\n- 접수번호: ${receiptNum}\n- 현장/위치: ${siteLoc}\n- 항목/파라미터: ${item || '현장 계수 값'}`;
    if (item === "TN/TP") {
        prompt += `\n- 이미지에서 TN 및 TP 각각의 시간 및 값 쌍을 추출해주세요. "value_tn"과 "value_tp" 필드를 사용하세요.`;
        prompt += `\n\n중요 규칙:\n1.  **두 값 모두 추출:** 같은 시간대에 TN과 TP 값이 모두 표시된 경우, JSON 객체에 "value_tn"과 "value_tp" 키를 **둘 다 포함해야 합니다.**`;
        prompt += `\n2.  **한 값만 있는 경우:** 특정 시간대에 TN 또는 TP 값 중 하나만 명확하게 식별 가능한 경우 (예를 들어, 다른 값의 칸이 비어 있거나 'null' 또는 '-'로 표시된 경우), 해당 값의 키만 포함하고 다른 키는 **생략(omit)합니다**.`;
        prompt += `\n3.  **값 형식:** 모든 값 필드에는 이미지에서 보이는 **순수한 숫자 값만** 포함해야 합니다. 단위, 지시자, 주석 등은 **모두 제외**하세요.`;
        prompt += `\n\nJSON 출력 형식 예시 (TN/TP):\n[\n  { "time": "2025/07/10 10:00", "value_tn": "15.3", "value_tp": "1.2" },\n  { "time": "2025/07/10 11:00", "value_tn": "12.1" },\n  { "time": "2025/07/10 12:00", "value_tp": "0.9" }\n]`;
    } else {
        prompt += `\n\nJSON 출력 형식 예시 (${item}):\n[\n  { "time": "2025/07/10 10:00", "value": "15.3" },\n  { "time": "2025/07/10 11:00", "value": "12.1" }\n]`;
    }
    prompt += `\n\n중요 지침:\n1. 응답은 반드시 유효한 단일 JSON 배열이어야 합니다. 배열 외부에는 어떤 텍스트도 포함하지 마세요.\n2. 값 필드("value", "value_tn", "value_tp")에는 순수한 숫자 값만 포함해주세요. 단위나 텍스트 주석은 제외합니다.\n3. 이미지에서 관련 데이터를 찾을 수 없으면 빈 배열([])을 반환하세요.\n`;
    return prompt;
};

interface FieldCountPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const FieldCountPage: React.FC<FieldCountPageProps> = ({ userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob }) => {
  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [isKtlPreflightModalOpen, setKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ocrControlsKtlStatus = useMemo<KtlApiCallStatus>(() => {
    if (!activeJob) return 'idle';
    if (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error') {
        return activeJob.submissionStatus;
    }
    return 'idle';
  }, [activeJob]);

  useEffect(() => {
    if (activeJob && activeJob.photos.length > 0) {
        if (currentImageIndex < 0 || currentImageIndex >= activeJob.photos.length) {
            setCurrentImageIndex(0);
        }
    } else {
        setCurrentImageIndex(-1);
    }
  }, [activeJob, currentImageIndex]);
  
  const updateActiveJob = useCallback((updater: (job: PhotoLogJob) => PhotoLogJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);

  const resetActiveJobData = useCallback(() => {
    updateActiveJob(job => ({ ...job, photos: [], photoComments: {}, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined }));
    setCurrentImageIndex(-1);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setProcessingError(null);
  }, [updateActiveJob]);
  
  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!activeJob || activeJob.photos.length === 0) return [];
    const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
    const baseName = `${activeJob.receiptNumber}_수질_${sanitizedItemName}_현장적용계수`;
    return [ `${baseName}.jpg`, `${baseName}.zip` ];
  }, [activeJob]);
  
  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;
    const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData);
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: siteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence: identifierSequence,
      pageType: 'FieldCount',
    };
    return generateKtlJsonForPreview(payload, activeJob.selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

  const handleImagesSet = useCallback((newlySelectedImages: ImageInfo[]) => {
    if (newlySelectedImages.length === 0 && activeJob?.photos?.length > 0) return;
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
        return { ...job, photos: finalPhotos, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    updateActiveJob(job => {
        const newPhotos = [...(job.photos || []), { file, base64, mimeType }];
        setCurrentImageIndex(newPhotos.length - 1);
        return { ...job, photos: newPhotos, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setIsCameraOpen(false);
    setProcessingError(null);
  }, [updateActiveJob]);

  const handleDeleteImage = useCallback((indexToDelete: number) => {
    if (!activeJob || indexToDelete < 0 || indexToDelete >= activeJob.photos.length) return;
    updateActiveJob(job => {
        const newPhotos = job.photos.filter((_, index) => index !== indexToDelete);
        if (newPhotos.length === 0) setCurrentImageIndex(-1);
        else if (currentImageIndex >= newPhotos.length) setCurrentImageIndex(newPhotos.length - 1);
        else if (currentImageIndex > indexToDelete) setCurrentImageIndex(prev => prev - 1);
        return { ...job, photos: newPhotos, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, currentImageIndex, updateActiveJob]);

  const handleExtractText = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      setProcessingError("먼저 이미지를 선택해주세요.");
      return;
    }
    setIsLoading(true);
    setProcessingError(null);
    updateActiveJob(j => ({ ...j, processedOcrData: null, submissionStatus: 'idle', submissionMessage: undefined }));
    
    try {
        if (!import.meta.env.VITE_API_KEY) throw new Error("VITE_API_KEY 환경 변수가 설정되지 않았습니다.");
        
        let responseSchema;
        if (activeJob.selectedItem === "TN/TP") {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value_tn: { type: Type.STRING }, value_tp: { type: Type.STRING }}, required: ["time"]}};
        } else {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value: { type: Type.STRING }}, required: ["time", "value"]}};
        }

        const promises = activeJob.photos.map(async (image) => {
            let jsonStr = "";
            try {
                const prompt = generatePromptForFieldCount(activeJob.receiptNumber, siteLocation, activeJob.selectedItem);
                const config = { responseMimeType: "application/json", responseSchema };
                jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, config);
                return JSON.parse(jsonStr) as RawEntryUnion[];
            } catch (err: any) {
                const reason = err instanceof SyntaxError ? `JSON parsing failed: ${err.message}. AI response: ${jsonStr}` : err.message;
                return Promise.reject(new Error(reason));
            }
        });

        const results = await Promise.allSettled(promises);
        const allEntries = results.filter(res => res.status === 'fulfilled').flatMap(res => (res as PromiseFulfilledResult<RawEntryUnion[]>).value);
        
        const normalizeTime = (timeStr: string): string => {
            if (!timeStr) return '';
            const standardized = timeStr.replace(/-/g, '/');
            const match = standardized.match(/(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2})/);
            return match ? match[1] : standardized;
        };

        const uniqueEntriesMap = new Map<string, RawEntryUnion>();
        allEntries.forEach(entry => {
            const normalizedTime = normalizeTime(entry.time);
            if (!uniqueEntriesMap.has(normalizedTime)) {
                uniqueEntriesMap.set(normalizedTime, { ...entry, time: normalizedTime });
            } else {
                const existing = uniqueEntriesMap.get(normalizedTime)!;
                if (activeJob.selectedItem === "TN/TP") {
                    const existingTnTp = existing as RawEntryTnTp;
                    const currentTnTp = entry as RawEntryTnTp;
                    if (currentTnTp.value_tn && !existingTnTp.value_tn) existingTnTp.value_tn = currentTnTp.value_tn;
                    if (currentTnTp.value_tp && !existingTnTp.value_tp) existingTnTp.value_tp = currentTnTp.value_tp;
                } else {
                    const existingSingle = existing as RawEntrySingle;
                    const currentSingle = entry as RawEntrySingle;
                    if (currentSingle.value && !existingSingle.value) {
                         existingSingle.value = currentSingle.value;
                    }
                }
            }
        });

        const finalOcrData = Array.from(uniqueEntriesMap.values())
            .sort((a,b) => a.time.localeCompare(b.time))
            .map(raw => {
                let primaryValue = '', tpValue: string | undefined;
                if (activeJob.selectedItem === "TN/TP") {
                    primaryValue = (raw as RawEntryTnTp).value_tn || '';
                    tpValue = (raw as RawEntryTnTp).value_tp;
                } else {
                    primaryValue = (raw as RawEntrySingle).value || '';
                }
                return { id: self.crypto.randomUUID(), time: raw.time, value: primaryValue, valueTP: tpValue };
            });

        updateActiveJob(j => ({ ...j, processedOcrData: finalOcrData }));
        if (results.some(res => res.status === 'rejected')) setProcessingError("일부 이미지를 처리하지 못했습니다.");
    } catch (e: any) {
        setProcessingError(e.message || "데이터 추출 중 오류 발생");
    } finally {
        setIsLoading(false);
    }
  }, [activeJob, siteLocation, updateActiveJob]);

  const handleEntryChange = (id: string, field: keyof ExtractedEntry, value: string | undefined) => {
    updateActiveJob(j => ({ ...j, processedOcrData: (j.processedOcrData || []).map(e => e.id === id ? { ...e, [field]: value } : e), submissionStatus: 'idle', submissionMessage: undefined }));
  };

  const handleAddEntry = useCallback(() => {
    updateActiveJob(j => {
        const newEntry: ExtractedEntry = { id: self.crypto.randomUUID(), time: '', value: '', valueTP: j.selectedItem === "TN/TP" ? '' : undefined };
        return { ...j, processedOcrData: [...(j.processedOcrData || []), newEntry], submissionStatus: 'idle', submissionMessage: undefined };
    });
  }, [updateActiveJob]);

  const handleReorderRows = useCallback((sourceRowStr: string, targetRowStr?: string) => {
    if (!activeJob || !activeJob.processedOcrData) return;

    const data = [...activeJob.processedOcrData];
    const sourceIndices: number[] = [];

    // Parse source string, handles "5" and "1-3"
    if (sourceRowStr.includes('-')) {
        const [start, end] = sourceRowStr.split('-').map(s => parseInt(s.trim(), 10) - 1);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (let i = start; i <= end; i++) {
                sourceIndices.push(i);
            }
        }
    } else {
        const index = parseInt(sourceRowStr.trim(), 10) - 1;
        if (!isNaN(index)) {
            sourceIndices.push(index);
        }
    }
    
    // Sort descending to remove items without index shifting issues
    const uniqueSourceIndices = [...new Set(sourceIndices)].sort((a, b) => b - a);

    if (uniqueSourceIndices.length === 0 || uniqueSourceIndices.some(i => i < 0 || i >= data.length)) {
      alert("유효하지 않은 행 번호입니다. 데이터 범위 내의 숫자나 '시작-끝' 형식으로 입력해주세요.");
      return;
    }

    // Extract elements to move, and reverse them to maintain original order
    const elementsToMove = uniqueSourceIndices.map(i => data[i]).reverse();
    // Remove elements from the original array
    uniqueSourceIndices.forEach(i => data.splice(i, 1));
    
    let targetIndex = data.length; // Default to end
    if (targetRowStr && targetRowStr.trim()) {
        const target = parseInt(targetRowStr.trim(), 10) - 1;
        if (!isNaN(target) && target >= 0 && target <= data.length) { // Target can be data.length to append at the end
            targetIndex = target;
        } else {
            alert(`새 위치 번호가 잘못되었습니다. 1부터 ${data.length + 1} 사이의 숫자를 입력해주세요.`);
            return;
        }
    }
    
    // Insert the elements at the new position
    data.splice(targetIndex, 0, ...elementsToMove);

    updateActiveJob(job => ({
        ...job,
        processedOcrData: data,
        submissionStatus: 'idle',
        submissionMessage: undefined,
    }));
  }, [activeJob, updateActiveJob]);

  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !ktlJsonPreview) {
        alert("KTL 전송을 위한 모든 조건(작업 선택, 데이터, 사진, 필수정보)이 충족되지 않았습니다.");
        return;
    }
    setKtlPreflightData({
        jsonPayload: ktlJsonPreview, 
        fileNames: hypotheticalKtlFileNamesForPreview,
        context: { receiptNumber: activeJob.receiptNumber, siteLocation: siteLocation, selectedItem: activeJob.selectedItem, userName }
    });
    setKtlPreflightModalOpen(true);
  }, [activeJob, userName, siteLocation, ktlJsonPreview, hypotheticalKtlFileNamesForPreview]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: "KTL 전송을 위한 필수 데이터가 누락되었습니다." }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "전송 중..."}));

    try {
        const payload: ClaydoxPayload = {
            receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem, updateUser: userName,
            ocrData: activeJob.processedOcrData,
            pageType: 'FieldCount',
        };
        const baseName = `${activeJob.receiptNumber}_수질_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}_현장적용계수`;
        
        const compositeDataUrl = await generateCompositeImage(activeJob.photos, { receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem }, 'image/jpeg');
        const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });
        
        const zip = new JSZip();
        for (let i = 0; i < activeJob.photos.length; i++) {
            const imageInfo = activeJob.photos[i];
            const stampedDataUrl = await generateStampedImage(imageInfo.base64, imageInfo.mimeType, activeJob.receiptNumber, siteLocation, '', activeJob.selectedItem);
            zip.file(`${baseName}_${i + 1}.png`, dataURLtoBlob(stampedDataUrl));
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipFile = new File([zipBlob], `${baseName}.zip`, { type: 'application/zip' });

        const response = await sendToClaydoxApi(payload, [compositeFile, zipFile], activeJob.selectedItem, [`${baseName}.jpg`, `${baseName}.zip`]);
        updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message }));
    } catch (error: any) {
        updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${error.message}` }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob]);
  
    const handleBatchSendToKtl = async () => {
    const jobsToSend = jobs.filter(j => j.processedOcrData && j.processedOcrData.length > 0 && j.photos.length > 0);
    if (jobsToSend.length === 0) {
        alert("전송할 데이터가 있는 작업이 없습니다. 각 작업에 사진과 추출된 데이터가 있는지 확인하세요.");
        return;
    }

    setIsSendingToClaydox(true);
    setBatchSendProgress(`(0/${jobsToSend.length}) 작업 처리 시작...`);
    setJobs(prev => prev.map(j => jobsToSend.find(jts => jts.id === j.id) ? { ...j, submissionStatus: 'sending', submissionMessage: '대기 중...' } : j));

    for (let i = 0; i < jobsToSend.length; i++) {
        const job = jobsToSend[i];
        setBatchSendProgress(`(${(i + 1)}/${jobsToSend.length}) '${job.receiptNumber}' 전송 중...`);
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionMessage: '파일 생성 및 전송 중...' } : j));
        
        try {
            const payload: ClaydoxPayload = {
                receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem, updateUser: userName, ocrData: job.processedOcrData!, pageType: 'FieldCount',
            };
            const baseName = `${job.receiptNumber}_수질_${sanitizeFilenameComponent(job.selectedItem.replace('/', '_'))}_현장적용계수`;
            
            const compositeDataUrl = await generateCompositeImage(job.photos, { receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem }, 'image/jpeg');
            const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}.jpg`, { type: 'image/jpeg' });
            
            const zip = new JSZip();
            for (const imageInfo of job.photos) {
                const stampedDataUrl = await generateStampedImage(imageInfo.base64, imageInfo.mimeType, job.receiptNumber, siteLocation, '', job.selectedItem, job.photoComments[imageInfo.file.name]);
                zip.file(`${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`, dataURLtoBlob(stampedDataUrl));
            }
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const zipFile = new File([zipBlob], `${baseName}.zip`, { type: 'application/zip' });

            const response = await sendToClaydoxApi(payload, [compositeFile, zipFile], job.selectedItem, [compositeFile.name, zipFile.name]);
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'success', submissionMessage: response.message || '전송 성공' } : j));
        } catch (error: any) {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}` } : j));
        }
    }

    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  };

  const isControlsDisabled = isLoading || isSendingToClaydox || isCameraOpen || !!batchSendProgress;
  const representativeImageData = activeJob && currentImageIndex !== -1 ? activeJob.photos[currentImageIndex] : null;

  const StatusIndicator: React.FC<{ status: PhotoLogJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">현장 계수 (P2)</h2>
      
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id}
                   className={`p-2.5 rounded-md transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}
              >
                <div className="flex justify-between items-center">
                    <div className="flex-grow cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                        <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>{job.receiptNumber} / {job.selectedItem}</span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDeleteJob(job.id);
                        }}
                        className="ml-2 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0"
                        title="이 작업 삭제"
                        aria-label={`'${job.receiptNumber}' 작업 삭제`}
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

      {!activeJob && jobs.length > 0 && <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>}
      {!activeJob && jobs.length === 0 && <p className="text-center text-slate-400 p-4">시작하려면 '공통 정보 및 작업 관리' 섹션에서 작업을 추가하세요.</p>}

      {activeJob && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          {isCameraOpen ? ( <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} /> ) : (
            <>
              <ImageInput onImagesSet={handleImagesSet} onOpenCamera={handleOpenCamera} isLoading={isControlsDisabled} ref={fileInputRef} selectedImageCount={activeJob.photos.length} />
              {representativeImageData && ( <ImagePreview imageBase64={representativeImageData.base64} fileName={representativeImageData.file.name} mimeType={representativeImageData.mimeType} receiptNumber={activeJob.receiptNumber} siteLocation={siteLocation} item={activeJob.selectedItem} showOverlay={true} totalSelectedImages={activeJob.photos.length} currentImageIndex={currentImageIndex} onDelete={() => handleDeleteImage(currentImageIndex)} /> )}
              <ThumbnailGallery images={activeJob.photos} currentIndex={currentImageIndex} onSelectImage={setCurrentImageIndex} onDeleteImage={handleDeleteImage} disabled={isControlsDisabled}/>
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
              onEntryIdentifierTPChange={(id, val) => handleEntryChange(id, 'identifierTP', val)}
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

      {jobs.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
              <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
              <p className="text-sm text-slate-400">
                  이 페이지의 모든 유효한 작업(사진 및 데이터가 있는)을 KTL로 전송합니다. 안정적인 Wi-Fi 환경에서 실행하는 것을 권장합니다.
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
                  {isSendingToClaydox ? '전송 중...' : `이 페이지의 모든 작업 전송 (${jobs.filter(j => j.processedOcrData && j.photos.length > 0).length}건)`}
              </ActionButton>
          </div>
      )}

      {isKtlPreflightModalOpen && ktlPreflightData && ( <KtlPreflightModal isOpen={isKtlPreflightModalOpen} onClose={() => setKtlPreflightModalOpen(false)} onConfirm={handleSendToClaydoxConfirmed} preflightData={ktlPreflightData} /> )}
    </div>
  );
};

export default FieldCountPage;
