import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo as BaseImageInfo } from '../ImageInput';
import { CameraView } from '../CameraView';
import type { Application } from '../ApplicationOcrSection';
import { ImagePreview } from '../ImagePreview';
import { OcrControls } from '../OcrControls';
import { OcrResultDisplay } from '../OcrResultDisplay';
import {
  RangeDifferenceDisplay,
  RangeResults as DisplayRangeResults,
  RangeStat,
} from '../RangeDifferenceDisplay';
import { extractTextFromImage } from '../../services/geminiService';
import {
  sendToClaydoxApi,
  ClaydoxPayload,
  generateKtlJsonForPreview,
} from '../../services/claydoxApiService';
import JSZip from 'jszip';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ✅ constants에서 alias 포함해서 import
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS, P3_TN_IDENTIFIERS, P3_TP_IDENTIFIERS, P3_SINGLE_ITEM_IDENTIFIERS } from '../../shared/constants';
import KtlPreflightModal, { KtlPreflightData } from '../KtlPreflightModal';
import { ThumbnailGallery } from '../ThumbnailGallery';
import { Type } from '@google/genai';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';
import {
  generateA4CompositeJPEGPages,
  generateA4ReportPages,
  type ReportMeta,
  dataURLtoBlob,
  generateStampedImage,
  CompositeImageInput,
  compressImage,
} from '../../services/imageStampingService';
import { autoAssignIdentifiersByConcentration } from '../../services/identifierAutomationService';
import type {
  PhotoLogJob,
  JobPhoto,
  ExtractedEntry,
  ConcentrationBoundaries,
} from '../../shared/types';

const genUUID = (): string => {
  if (typeof self !== 'undefined' && self.crypto?.randomUUID) {
    return self.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

type AppRangeResults = DisplayRangeResults;
type KtlApiCallStatus = 'idle' | 'success' | 'error';

interface RawEntryBase {
  time: string;
}
interface RawEntryTnTp extends RawEntryBase {
  value_tn?: string;
  value_tp?: string;
}
interface RawEntrySingle extends RawEntryBase {
  value: string;
}
type RawEntryUnion = RawEntryTnTp | RawEntrySingle;

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const getNumericValueFromString = (valueStr: string): number | null => {
  const numericValueString = String(valueStr).match(/^-?\d+(\.\d+)?/)?.[0];
  if (!numericValueString) return null;
  const numericValue = parseFloat(numericValueString);
  return isNaN(numericValue) ? null : numericValue;
};

const getConcentrationCategory = (valueStr: string, boundaries: ConcentrationBoundaries | null): 'low' | 'medium' | 'high' | 'unknown' => {
  const fullValueStr = String(valueStr).trim();
  const numericValueString = fullValueStr.match(/^-?\d+(\.\d+)?/)?.[0];
  const textPart = numericValueString ? fullValueStr.substring(numericValueString.length).trim() : fullValueStr;

  if (textPart.includes("고")) return 'high';
  if (textPart.includes("중")) return 'medium';
  if (textPart.includes("저")) return 'low';

  if (!boundaries) return 'unknown';
  const numericValue = getNumericValueFromString(valueStr);
  if (numericValue === null) return 'unknown';

  if (numericValue <= boundaries.boundary1) return 'low';
  if (numericValue <= boundaries.boundary2) return 'medium';
  return 'high';
};

const calculateConcentrationBoundariesInternal = (
  data: ExtractedEntry[] | null
): ConcentrationBoundaries | null => {
  if (!data || data.length === 0) {
    return null;
  }

  const allNumericValuesForBoundaryCalc: number[] = [];
  data.forEach(entry => {
    const numericValue = getNumericValueFromString(entry.value);
    if (numericValue !== null) {
      allNumericValuesForBoundaryCalc.push(numericValue);
    }
  });

  const uniqueNumericValues = Array.from(new Set(allNumericValuesForBoundaryCalc)).sort((a, b) => a - b);

  if (uniqueNumericValues.length === 0) {
    return null;
  }

  const overallMin = uniqueNumericValues[0];
  const overallMax = uniqueNumericValues[uniqueNumericValues.length - 1];
  const span = overallMax - overallMin;
  let b1: number;
  let b2: number;

  if (uniqueNumericValues.length < 2) {
    b1 = overallMin;
    b2 = overallMax;
  } else if (uniqueNumericValues.length === 2) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[0];
  } else if (uniqueNumericValues.length === 3) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[1];
  } else { // N > 3
    if (span > 0) {
      b1 = overallMin + span / 3;
      b2 = overallMin + (2 * span) / 3;

      if (b1 >= b2) {
        const N_unique = uniqueNumericValues.length;
        let idx1 = Math.max(0, Math.floor(N_unique / 3) - 1);
        let idx2 = Math.max(idx1 + 1, Math.floor(2 * N_unique / 3) - 1);
        idx2 = Math.min(N_unique - 2, idx2);
        idx1 = Math.min(idx1, Math.max(0, idx2 - 1));

        if (idx1 >= 0 && idx1 < idx2 && idx2 < N_unique && uniqueNumericValues[idx1] < uniqueNumericValues[idx2]) {
          b1 = uniqueNumericValues[idx1];
          b2 = uniqueNumericValues[idx2];
        } else {
          b1 = overallMin;
          b2 = (overallMin + overallMax) / 2;
        }
      }
    } else {
      b1 = overallMin;
      b2 = overallMax;
    }
  }

  if (b1 > b2 && overallMax > overallMin) {
    [b1, b2] = [b2, b1];
  }

  if (uniqueNumericValues.length !== 2) {
    if (b1 === b2 && uniqueNumericValues.length > 1 && overallMin < overallMax) {
      if (b2 < overallMax) {
        const nextValIndex = uniqueNumericValues.findIndex(val => val > b2);
        if (nextValIndex !== -1) {
          b2 = uniqueNumericValues[nextValIndex];
        }
        if (b1 === b2 && b1 > overallMin) {
          let prevValIndex = -1;
          for (let i = uniqueNumericValues.length - 1; i >= 0; i--) {
            if (uniqueNumericValues[i] < b1) {
              prevValIndex = i;
              break;
            }
          }
          if (prevValIndex !== -1) {
            b1 = uniqueNumericValues[prevValIndex];
          }
        }
      }
    }
  }

  if (uniqueNumericValues.length === 2) {
    b1 = uniqueNumericValues[0];
    b2 = uniqueNumericValues[0];
  } else if (b1 >= b2 && uniqueNumericValues.length > 2) {
    b1 = overallMin;
    b2 = (overallMin + overallMax) / 2;
    if (b1 >= b2 && overallMin < overallMax) b2 = overallMax;
  }

  return { overallMin, overallMax, span, boundary1: b1, boundary2: b2 };
};

const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return 'untitled';
  // 점(.) 허용
  let s = component
    .replace(/[^\w.\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\-]+/g, '_');

  // 중복 언더스코어/점 정리 + 앞/뒤 점 제거(숨김파일 방지)
  s = s
    .replace(/__+/g, '_')
    .replace(/\.{2,}/g, '.')  // ..... → .
    .replace(/^\.+/, '')      // 앞쪽 점 제거
    .replace(/\.+$/, '');     // 뒤쪽 점 제거

  return s || 'untitled';
};


const generateIdentifierSequence = (
    ocrData: ExtractedEntry[] | null,
    currentSelectedItem: string
  ): string => {
    if (!ocrData) return "";
    let sequence = "";
    const excludedBases = ["현장"]; 
  
    const processSingleIdentifier = (idVal: string | undefined): string | null => {
      if (!idVal) return null;
      let base = idVal.replace(/[0-9]/g, ''); 
      if (base.endsWith('P')) {
        base = base.slice(0, -1);
      }
      if (excludedBases.includes(base)) return null;
      return base.length > 0 ? base : null;
    };
  
    for (const entry of ocrData) {
      if (currentSelectedItem === "TN/TP") {
        const tnPart = processSingleIdentifier(entry.identifier);
        if (tnPart) sequence += tnPart;
        const tpPart = processSingleIdentifier(entry.identifierTP);
        if (tpPart) sequence += tpPart;
      } else {
        const part = processSingleIdentifier(entry.identifier);
        if (part) sequence += part;
      }
    }
    return sequence;
  };

const countDecimalPlaces = (valueStr: string | undefined): number => {
  if (typeof valueStr !== 'string' || valueStr.trim() === '') {
    return 0;
  }
  const numericStrMatch = String(valueStr).match(/^-?\d+(\.\d+)?/);
  if (!numericStrMatch || !numericStrMatch[0]) {
    return 0;
  }
  const numericStr = numericStrMatch[0];
  const decimalPart = numericStr.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
};

const calculateMaxDecimalPlaces = (
  ocrData: ExtractedEntry[] | null,
  selectedItem: string
): number => {
  if (!ocrData || ocrData.length === 0) {
    return 0;
  }
  let maxPlaces = 0;
  ocrData.forEach(entry => {
    const placesValue = countDecimalPlaces(entry.value);
    if (placesValue > maxPlaces) maxPlaces = placesValue;
    if (selectedItem === "TN/TP" && entry.valueTP) {
      const placesValueTP = countDecimalPlaces(entry.valueTP);
      if (placesValueTP > maxPlaces) maxPlaces = placesValueTP;
    }
  });
  return maxPlaces;
};

interface AnalysisPageProps {
  pageTitle: string;
  pageType: 'PhotoLog' | 'FieldCount';
  showRangeDifferenceDisplay: boolean;
  showAutoAssignIdentifiers: boolean;
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteName: string;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
  onSaveDraft?: (receipt?: string) => void;
  onLoadDraft?: (receipt?: string) => void;
  onSaveAllDrafts?: () => void;
  onLoadAllDrafts?: () => void;
  draftMessage?: { type: 'success' | 'error'; text: string } | null;
  applications?: Application[];
  /** 추가 사진자료 모달 오픈 (기존 P1~P5와 접점 없음) */
  onOpenExtraPhotoModal?: (receiptNumber: string, itemName: string) => void;
}

const AnalysisPage: React.FC<AnalysisPageProps> = ({
  pageTitle, pageType, showRangeDifferenceDisplay, showAutoAssignIdentifiers,
  userName, jobs, setJobs, activeJobId, setActiveJobId, siteName, siteLocation, onDeleteJob,
  onSaveDraft, onLoadDraft, onSaveAllDrafts, onLoadAllDrafts, draftMessage, applications = [],
  onOpenExtraPhotoModal,
}) => {
  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);
  const [singleAnalysisDate, setSingleAnalysisDate] = useState<string>('');
  const [isLoadingFieldCount, setIsLoadingFieldCount] = useState<boolean>(false);
  const [fieldCountError, setFieldCountError] = useState<string | null>(null);
  const [isFieldCountSectionOpen, setIsFieldCountSectionOpen] = useState<boolean>(false);
  const [isFieldCountCameraOpen, setIsFieldCountCameraOpen] = useState<boolean>(false);
  const fieldCountFileInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableTnIdentifiers = pageType === 'FieldCount' ? P3_TN_IDENTIFIERS : TN_IDENTIFIERS;
  const availableTpIdentifiers = pageType === 'FieldCount' ? P3_TP_IDENTIFIERS : TP_IDENTIFIERS;
  
  const availableIdentifiers = useMemo(() => {
    if (pageType === 'FieldCount') {
      return activeJob?.selectedItem === 'TP' ? P3_TP_IDENTIFIERS : P3_TN_IDENTIFIERS;
    }
    return IDENTIFIER_OPTIONS;
  }, [pageType, activeJob?.selectedItem]);

  const ocrControlsKtlStatus = useMemo<KtlApiCallStatus>(() => {
    if (!activeJob) return 'idle';
    if (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error') {
        return activeJob.submissionStatus;
    }
    return 'idle';
  }, [activeJob]);

  useEffect(() => {
    setSingleAnalysisDate('');
    setSuccessMessage(null);
    setProcessingError(null);
  }, [activeJobId]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (activeJob) {
        const numPhotos = activeJob.photos.length;
        if (numPhotos > 0) {
            if (currentImageIndex < 0 || currentImageIndex >= numPhotos) {
                setCurrentImageIndex(0);
            }
        } else if (currentImageIndex !== -1) {
            setCurrentImageIndex(-1);
        }
    }
  }, [activeJob, currentImageIndex]);

  const updateActiveJob = useCallback((updater: (job: PhotoLogJob) => PhotoLogJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);
  
  const resetActiveJobData = useCallback(() => {
    updateActiveJob(job => ({
        ...job,
        photos: [],
        photoComments: {},
        processedOcrData: null,
        rangeDifferenceResults: null,
        concentrationBoundaries: null,
        decimalPlaces: 0,
        submissionStatus: 'idle',
        submissionMessage: undefined,
    }));
    setCurrentImageIndex(-1);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setProcessingError(null);
  }, [updateActiveJob]);


  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!activeJob || activeJob.photos.length === 0) return [];
    const pageIdentifier = pageType === 'PhotoLog' ? '수질' : '현장';
    const sanitizedSite = sanitizeFilenameComponent(siteName);
    const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem === "TN/TP" ? "TN_TP" : activeJob.selectedItem);
    const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
    
    const pageCount = Math.ceil(activeJob.photos.length / 4);
    const compositeNames = Array.from({ length: pageCount }, (_, i) => {
        const pageNum = (i + 1).toString().padStart(2, '0');
        return `${baseName}_composite_${pageNum}.jpg`;
    });

    return [ ...compositeNames, `${baseName}_Compression.zip` ];
  }, [activeJob, siteName, pageType]);

  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;
    const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData, activeJob.selectedItem);
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: siteLocation,
      siteNameOnly: siteName,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence: identifierSequence,
      pageType: pageType,
      maxDecimalPlaces: activeJob.decimalPlaces,
      inspectionStartDate: activeJob.inspectionStartDate,
      inspectionEndDate: activeJob.inspectionEndDate,
    };
    return generateKtlJsonForPreview(payload, activeJob.selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [activeJob, userName, siteName, siteLocation, pageType, hypotheticalKtlFileNamesForPreview]);


  useEffect(() => {
    if (!activeJob) return;

    if (!activeJob.processedOcrData) {
        if (activeJob.rangeDifferenceResults !== null || activeJob.concentrationBoundaries !== null || activeJob.decimalPlaces !== 0) {
            updateActiveJob(j => ({ ...j, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0 }));
        }
        return;
    }
    const boundaries = calculateConcentrationBoundariesInternal(activeJob.processedOcrData);
    const newMaxDecimalPlaces = calculateMaxDecimalPlaces(activeJob.processedOcrData, activeJob.selectedItem);
    
    let newRangeResults: AppRangeResults | null = null;
    if (boundaries) {
        const lowValues: number[] = []; const mediumValues: number[] = []; const highValues: number[] = [];
        activeJob.processedOcrData.forEach(entry => {
            const category = getConcentrationCategory(entry.value, boundaries);
            const numericVal = getNumericValueFromString(entry.value);
            if (numericVal === null) return;
            if (category === 'low') lowValues.push(numericVal);
            else if (category === 'medium') mediumValues.push(numericVal);
            else if (category === 'high') highValues.push(numericVal);
        });
        const calculateRangeDetails = (values: number[]): RangeStat | null => {
            if (values.length < 2) return null;
            const min = Math.min(...values); const max = Math.max(...values);
            return { min, max, diff: max - min };
        };
        newRangeResults = { low: calculateRangeDetails(lowValues), medium: calculateRangeDetails(mediumValues), high: calculateRangeDetails(highValues) };
    }
    
    if (
        JSON.stringify(activeJob.concentrationBoundaries) !== JSON.stringify(boundaries) ||
        JSON.stringify(activeJob.rangeDifferenceResults) !== JSON.stringify(newRangeResults) ||
        activeJob.decimalPlaces !== newMaxDecimalPlaces
    ) {
        updateActiveJob(j => ({ ...j, concentrationBoundaries: boundaries, rangeDifferenceResults: newRangeResults, decimalPlaces: newMaxDecimalPlaces }));
    }
  }, [activeJob?.processedOcrData, activeJob?.selectedItem, updateActiveJob, activeJob]);


  const handleImagesSet = useCallback((newlySelectedImages: BaseImageInfo[]) => {
    if (newlySelectedImages.length === 0 && activeJob?.photos && activeJob.photos.length > 0) return;
    
    const photosWithUids: JobPhoto[] = newlySelectedImages.map(img => ({
        ...img,
        uid: genUUID()
    }));

    updateActiveJob(job => {
        const existingPhotos = job.photos || [];
        const combined = [...existingPhotos, ...photosWithUids];
        const uniqueImageMap = new Map<string, JobPhoto>();
        combined.forEach(img => {
            const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
            if (!uniqueImageMap.has(key)) {
                uniqueImageMap.set(key, img);
            }
        });
        let finalPhotos = Array.from(uniqueImageMap.values());
        // 현장 계수(P3)는 사진 4장(합친 사진 1장) 초과 금지 — 초과분은 클독 전송 시 받을 칸이 없어 유실되므로 애초에 제외
        if (pageType === 'FieldCount' && finalPhotos.length > 4) finalPhotos = finalPhotos.slice(0, 4);

        return { ...job, photos: finalPhotos, submissionStatus: 'idle', submissionMessage: undefined };
    });
    if (pageType === 'FieldCount' && (activeJob?.photos?.length || 0) + photosWithUids.length > 4) {
      setProcessingError('현장 계수(P3)는 사진을 최대 4장까지만 첨부합니다. 초과분은 자동 제외되었습니다.');
    } else {
      setProcessingError(null);
    }
  }, [activeJob, updateActiveJob, pageType]);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    // 현장 계수(P3)는 사진 4장 초과 금지 — 5장째 촬영 차단
    if (pageType === 'FieldCount' && (activeJob?.photos?.length || 0) >= 4) {
      setProcessingError('현장 계수(P3)는 사진을 최대 4장까지만 첨부할 수 있습니다.');
      setIsCameraOpen(false);
      return;
    }
    const capturedImageInfo: JobPhoto = { file, base64, mimeType, uid: genUUID() };
    updateActiveJob(job => {
        const newPhotos = [...(job.photos || []), capturedImageInfo];
        setCurrentImageIndex(newPhotos.length - 1);
        return { ...job, photos: newPhotos, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setIsCameraOpen(false);
    setProcessingError(null);
  }, [updateActiveJob, pageType, activeJob]);

  const handleDeleteImage = useCallback((indexToDelete: number) => {
    if (!activeJob || indexToDelete < 0 || indexToDelete >= activeJob.photos.length) return;
    const deletedPhotoUid = activeJob.photos[indexToDelete].uid;
    updateActiveJob(job => {
        const newPhotos = job.photos.filter((_, index) => index !== indexToDelete);
        const newComments = { ...job.photoComments };
        delete newComments[deletedPhotoUid];
        return { ...job, photos: newPhotos, photoComments: newComments, processedOcrData: null, rangeDifferenceResults: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const generatePromptForProAnalysis = (
    receiptNum: string,
    siteLoc: string,
    item: string,
    inspectionStartDate?: string,
    inspectionEndDate?: string
  ): string => {
    
    const timeRules = `시간 규칙:
- 표 상단 등 한 날짜가 전체에 적용되면 그 날짜 + 각 행의 시간(HH:MM 또는 HH:MM:SS)을 합쳐
  최종 "YYYY/MM/DD HH:MM(:SS)"로 만듭니다(분이 없으면 00). 2자리 연도는 20xx로 확장.
- 개별 행에 날짜가 이미 있으면 그대로 사용.
- 날짜가 전혀 없고 시간만 있는 경우 시간만 사용(추출 가능 시).`;

    if (item === "TN/TP") {
        let context = `컨텍스트:\n- 접수번호: ${receiptNum}\n- 현장/위치: ${siteLoc}`;
        if (inspectionStartDate && inspectionEndDate) {
            context += `\n- 검사 기간(참고용): ${inspectionStartDate} ~ ${inspectionEndDate}`;
            context += `\n  ※ 날짜는 참고용입니다. 사진에 날짜가 명확하면 사진 우선. 날짜가 없을 때만 이 기간을 참고하여 추정하세요.`;
        } else if (inspectionStartDate) {
            context += `\n- 검사 시작일(참고용): ${inspectionStartDate}`;
            context += `\n  ※ 날짜는 참고용입니다. 사진에 날짜가 명확하면 사진 우선.`;
        } else if (inspectionEndDate) {
            context += `\n- 검사 종료일(참고용): ${inspectionEndDate}`;
            context += `\n  ※ 날짜는 참고용입니다. 사진에 날짜가 명확하면 사진 우선.`;
        }
        
        return `제공된 측정 장비의 이미지를 분석해주세요.
${context}
- 항목/파라미터: TN 및 TP. 이미지에서 TN과 TP 각각의 시간 및 값 쌍을 추출해야 합니다.
- 각 시간(time) 항목에 대해 TN 값은 "value_tn", TP 값은 "value_tp"에 넣습니다.

중요 규칙:
1) 같은 시간대에 TN/TP가 둘 다 있으면 두 키를 모두 포함합니다.
   예: { "time": "...", "value_tn": "1.23", "value_tp": "0.45" }
2) 한 값만 명확하면 그 값만 포함하고, 없는 키는 생략합니다.
   예: { "time": "...", "value_tn": "1.23" }  또는  { "time": "...", "value_tp": "0.45" }
3) 값 필드는 숫자만. 단위/접두사/주석(예: mg/L, mgN/L, N, P, [M_], 저/중/고)은 제외합니다.

작업:
- 장치 화면에서 보이는 모든 “Time(시각)”과 관련 값(TN/TP)을 찾아 JSON 배열로만 반환하세요.

${timeRules}

반드시 지킬 출력 형식:
- 응답 전체는 유효한 JSON **배열 하나**여야 하며, 그 밖의 텍스트/마크다운은 절대 포함하지 마세요.
- 예: 
[
  { "time": "2025/04/23 05:00", "value_tn": "46.2", "value_tp": "1.2" },
  { "time": "2025/04/23 06:00", "value_tn": "5.388", "value_tp": "0.1" },
  { "time": "2025/05/21 09:38", "value_tn": "89.629" },
  { "time": "2025/05/21 10:25", "value_tp": "2.5" }
]

추출 불가하면 [] 를 반환.`;
    } else { // Single item
        let context = `컨텍스트:\n- 접수번호: ${receiptNum}\n- 현장/위치: ${siteLoc}`;
        if (inspectionStartDate) {
            context += `\n- 검사 시작일(참고용): ${inspectionStartDate}`;
        }
        if (inspectionEndDate) {
            context += `\n- 검사 종료일(참고용): ${inspectionEndDate}`;
        }
        if (inspectionStartDate || inspectionEndDate) {
            context += `\n  ※ 위 날짜는 참고용입니다. 사진에 날짜/시간이 명확히 보이면 사진 값을 우선으로 추출하세요. 날짜가 없을 때만 참고합니다.`;
        }

        return `제공된 측정 장비의 이미지를 분석해주세요.
${context}

- 항목/파라미터: ${item} (예: TN, TP, TOC 등)
- "value"에는 **숫자만** 넣고, 단위/접두사/주석(N, P, mg/L, mgN/L, [M_], (A), 저/중/고 등)은 제외하세요.

작업:
- 장치 화면에서 보이는 모든 “Time(시각)”과 해당 항목의 값을 찾아 JSON 배열만 반환.

${timeRules}

반드시 지킬 출력 형식:
- 응답 전체는 유효한 JSON **배열 하나**만.
- 예:
[
  { "time": "2025/05/21 09:38", "value": "89.629" },
  { "time": "2025/05/21 10:25", "value": "44.978" }
]

추출 불가하면 [].`;
    }
  };
  const handleExtractText = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      setProcessingError("먼저 이미지를 선택하거나 촬영해주세요.");
      return;
    }
    setIsLoading(true); setProcessingError(null);
    updateActiveJob(j => ({ ...j, processedOcrData: null, decimalPlaces: 0, submissionStatus: 'idle', submissionMessage: undefined }));

    let allRawExtractedEntries: RawEntryUnion[] = [];
    let batchHadError = false;
    let criticalErrorOccurred: string | null = null;
    
    try {
        let responseSchema;
        if (activeJob.selectedItem === "TN/TP") {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value_tn: { type: Type.STRING }, value_tp: { type: Type.STRING } }, required: ["time"] } };
        } else {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value: { type: Type.STRING } }, required: ["time", "value"] } };
        }

        // ✅ 병렬 + 스태거: 200ms 간격으로 시작하여 Rate Limit 없이 빠르게 처리
        const imageProcessingPromises = activeJob.photos.map(async (image, index) => {
            await delay(index * 200); // 각 이미지 200ms 간격으로 시작
            let jsonStr: string = "";
            try {
                const prompt = generatePromptForProAnalysis(activeJob.receiptNumber, siteLocation, activeJob.selectedItem, activeJob.inspectionStartDate, activeJob.inspectionEndDate);
                const modelConfig = { responseMimeType: "application/json", responseSchema: responseSchema, maxOutputTokens: 8192 };
                // ✅ Vercel 4.5MB 한도 대응: OCR 품질 유지하면서 압축 (1920px, 85%)
                const compressedDataUrl = await compressImage(image.base64, image.mimeType, 2400, 2400, 0.92);
                // dataURL 프리픽스 제거 → 순수 base64만 추출
                const compressedBase64 = compressedDataUrl.split(',')[1];
                jsonStr = await extractTextFromImage(compressedBase64, 'image/jpeg', prompt, modelConfig);

                const jsonDataFromImage = JSON.parse(jsonStr) as RawEntryUnion[];
                if (Array.isArray(jsonDataFromImage)) {
                    return { status: 'fulfilled' as const, value: jsonDataFromImage };
                }
                return { status: 'rejected' as const, reason: `${image.file.name}: 유효한 JSON 배열이 아닙니다.` };
            } catch (imgErr: any) {
                if (imgErr.message?.includes("API_KEY") || imgErr.message?.includes("Quota exceeded")) {
                    criticalErrorOccurred = imgErr.message;
                }
                console.error(`[OCR] 이미지 처리 실패 (${image.file.name}):`, imgErr.message);
                return { status: 'rejected' as const, reason: imgErr.message };
            }
        });

        const results = await Promise.all(imageProcessingPromises);
        const failedImages: string[] = [];
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                allRawExtractedEntries.push(...result.value);
            } else {
                batchHadError = true;
                if ('reason' in result) failedImages.push(result.reason as string);
            }
        });
        if (criticalErrorOccurred) throw new Error(criticalErrorOccurred);

        if (batchHadError && failedImages.length > 0) {
            console.warn('[OCR] 실패한 이미지들:', failedImages);
        }
        
        if (allRawExtractedEntries.length > 0) {
            
            allRawExtractedEntries.sort((a, b) => {
                const getTimePart = (timeStr: string) => {
                    const s = String(timeStr ?? '');
                    const match = s.match(/(\d{4}[/-]\d{2}[/-]\d{2}\s*)?(\d{2}:\d{2}(:\d{2})?)/);
                    return match ? (match[1] || '') + match[2] : s;
                };
                return getTimePart(a.time).localeCompare(getTimePart(b.time));
            });

            const uniqueEntriesMap = new Map<string, RawEntryUnion>();

            let currentDate: Date | null = null;
            if (activeJob.inspectionStartDate) {
                currentDate = new Date(activeJob.inspectionStartDate + "T00:00:00Z"); // Use UTC to avoid timezone issues
            }
            const endDate: Date | null = activeJob.inspectionEndDate ? new Date(activeJob.inspectionEndDate + "T23:59:59Z") : null;
            
            let lastTime: string | null = null;

            allRawExtractedEntries.forEach(entry => {
                let finalTimestamp = String(entry.time ?? '').replace(/-/g, '/').trim();
                const timeMatch = finalTimestamp.match(/(\d{2}:\d{2})(?::\d{2})?$/);
                const currentTime = timeMatch ? timeMatch[1] : null;
                // ✅ Raw Data 우선: 사진에서 날짜까지 읽혔으면 그대로 사용
                const hasFullDate = /^\d{4}[\/]\d{2}[\/]\d{2}\s+\d{1,2}:\d{2}/.test(finalTimestamp);

                if (currentDate && currentTime && !hasFullDate) {
                    // 날짜 없이 시간만 있을 때만 검사시작일/종료일 참고
                    if (endDate && lastTime && currentTime < lastTime) {
                        const nextDay = new Date(currentDate);
                        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
                        if (nextDay <= endDate) {
                            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                        }
                    }
                    const year = currentDate.getUTCFullYear();
                    const month = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(currentDate.getUTCDate()).padStart(2, '0');
                    finalTimestamp = `${year}/${month}/${day} ${timeMatch![0]}`;
                }
                
                if (currentTime) {
                    lastTime = currentTime;
                }
                
                if (!uniqueEntriesMap.has(finalTimestamp)) {
                    uniqueEntriesMap.set(finalTimestamp, { ...entry, time: finalTimestamp });
                } else {
                    const existing = uniqueEntriesMap.get(finalTimestamp)!;
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

            const finalOcrData = Array.from(uniqueEntriesMap.values()).sort((a,b) => a.time.localeCompare(b.time)).map((rawEntry: RawEntryUnion) => {
                let primaryValue = '', tpValue: string | undefined = undefined;
                // AI가 숫자(시마즈 등)를 반환할 수 있어 문자열 강제변환
                if (activeJob.selectedItem === "TN/TP") {
                    const tnTpEntry = rawEntry as RawEntryTnTp;
                    primaryValue = tnTpEntry.value_tn != null ? String(tnTpEntry.value_tn) : '';
                    tpValue = tnTpEntry.value_tp != null ? String(tnTpEntry.value_tp) : undefined;
                } else {
                    const sVal = (rawEntry as RawEntrySingle).value;
                    primaryValue = sVal != null ? String(sVal) : '';
                }
                return { id: genUUID(), time: String(rawEntry.time ?? ''), value: primaryValue, valueTP: tpValue, identifier: undefined, identifierTP: undefined, isRuleMatched: false };
            });

            updateActiveJob(j => ({ ...j, processedOcrData: finalOcrData }));
            if (batchHadError) {
                const failMsg = failedImages.length > 0
                    ? `일부 이미지 처리 실패 (${failedImages[0]})`
                    : '일부 이미지를 처리하지 못했습니다.';
                setProcessingError(failMsg);
            }

        } else {
            setProcessingError("AI가 이미지에서 유효한 데이터를 추출하지 못했습니다.");
        }
    } catch (e: any) {
        setProcessingError(e.message || "데이터 추출 중 알 수 없는 오류가 발생했습니다.");
    } finally {
        setIsLoading(false);
    }
  }, [activeJob, siteLocation, updateActiveJob]);

  // ── 현장 계수 별도 분석 핸들러 ──────────────────────────────
  const handleFieldCountAnalyze = useCallback(async () => {
    if (!activeJob || !activeJob.fieldCountPhotos || activeJob.fieldCountPhotos.length === 0) {
      setFieldCountError('현장 계수 사진을 먼저 업로드해주세요.');
      return;
    }
    setIsLoadingFieldCount(true);
    setFieldCountError(null);

    try {
      let responseSchema;
      if (activeJob.selectedItem === 'TN/TP') {
        responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value_tn: { type: Type.STRING }, value_tp: { type: Type.STRING } }, required: ['time'] } };
      } else {
        responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value: { type: Type.STRING } }, required: ['time', 'value'] } };
      }

      const prompt = generatePromptForProAnalysis(
        activeJob.receiptNumber,
        siteLocation,
        activeJob.selectedItem,
        activeJob.inspectionStartDate,
        activeJob.inspectionEndDate
      );
      const modelConfig = { responseMimeType: 'application/json', responseSchema, maxOutputTokens: 8192 };

      const allEntries: RawEntryUnion[] = [];
      for (const img of activeJob.fieldCountPhotos) {
        try {
          const compressed = await compressImage(img.base64, img.mimeType, 2400, 2400, 0.92);
          const b64 = compressed.split(',')[1];
          const jsonStr = await extractTextFromImage(b64, 'image/jpeg', prompt, modelConfig);
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) allEntries.push(...parsed);
        } catch (e) { console.warn('[FieldCount] 이미지 처리 실패:', e); }
      }

      // P3 식별자 기준으로 후처리
      const fcIdentifiers = activeJob.selectedItem === 'TP' ? P3_TP_IDENTIFIERS : P3_TN_IDENTIFIERS;
      const isTnTp = activeJob.selectedItem === 'TN/TP';
      const newEntries: ExtractedEntry[] = allEntries.map((raw, i) => {
        const r = raw as any;
        const entry: ExtractedEntry = {
          id: `fc-${Date.now()}-${i}`,
          time: r.time || '',
          value: isTnTp ? (r.value_tn || '') : (r.value || ''),
          valueTP: isTnTp ? (r.value_tp || '') : undefined,
        };
        // 항목별 식별자 자동 배정
        const existingFcCount = activeJob.fieldCountData?.length || 0;
        const allFcIdx = existingFcCount + i;
        if (isTnTp) {
          // TN/TP 모드: TN식별자 + TP식별자 두 개 모두 배정
          if (P3_TN_IDENTIFIERS[allFcIdx]) entry.identifier   = P3_TN_IDENTIFIERS[allFcIdx];
          if (P3_TP_IDENTIFIERS[allFcIdx]) entry.identifierTP = P3_TP_IDENTIFIERS[allFcIdx];
        } else {
          if (fcIdentifiers[allFcIdx]) entry.identifier = fcIdentifiers[allFcIdx];
        }
        return entry;
      });

      const now = new Date().toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      updateActiveJob(job => ({
        ...job,
        fieldCountData: [...(job.fieldCountData || []), ...newEntries],
        fieldCountAnalyzedAt: now,
      }));
      setSuccessMessage(`현장 계수 ${newEntries.length}건 분석 완료! 테이블 하단에 추가되었습니다.`);
    } catch (e: any) {
      setFieldCountError(`분석 실패: ${e.message}`);
    } finally {
      setIsLoadingFieldCount(false);
    }
  }, [activeJob, siteLocation, generatePromptForProAnalysis, updateActiveJob]);

  const handleFieldCountFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeJob || !e.target.files) return;
    const files = Array.from(e.target.files);
    const newPhotos: JobPhoto[] = await Promise.all(files.map(async (file) => {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      return { uid: `fc-${Date.now()}-${Math.random()}`, file, base64, mimeType: file.type || 'image/jpeg' };
    }));
    updateActiveJob(job => ({ ...job, fieldCountPhotos: [...(job.fieldCountPhotos || []), ...newPhotos] }));
    e.target.value = '';
  }, [activeJob, updateActiveJob]);

  const handleFieldCountPhotoCaptured = useCallback((photo: JobPhoto) => {
    updateActiveJob(job => ({ ...job, fieldCountPhotos: [...(job.fieldCountPhotos || []), photo] }));
    setIsFieldCountCameraOpen(false);
  }, [updateActiveJob]);

  const handleRemoveFieldCountPhoto = useCallback((uid: string) => {
    updateActiveJob(job => ({ ...job, fieldCountPhotos: (job.fieldCountPhotos || []).filter(p => p.uid !== uid) }));
  }, [updateActiveJob]);

  const handleClearFieldCountData = useCallback(() => {
    if (window.confirm('현장 계수 추가 분석 결과를 삭제하시겠습니까?')) {
      updateActiveJob(job => ({ ...job, fieldCountData: null, fieldCountPhotos: [], fieldCountAnalyzedAt: undefined }));
    }
  }, [updateActiveJob]);

  const handleAnalyzeSinglePhoto = useCallback(async () => {
    if (!activeJob || currentImageIndex < 0) {
      setProcessingError("먼저 분석할 사진을 선택해주세요.");
      return;
    }
    if (!singleAnalysisDate) {
      setProcessingError("분석 기준 날짜를 입력해주세요.");
      return;
    }

    setIsLoading(true);
    setProcessingError(null);
    setSuccessMessage(null);

    const photoToAnalyze = activeJob.photos[currentImageIndex];
    let newRawEntries: RawEntryUnion[] = [];

    try {
        let responseSchema;
        if (activeJob.selectedItem === "TN/TP") {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value_tn: { type: Type.STRING }, value_tp: { type: Type.STRING } }, required: ["time"] } };
        } else {
            responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { time: { type: Type.STRING }, value: { type: Type.STRING } }, required: ["time", "value"] } };
        }
        
        const prompt = generatePromptForProAnalysis(activeJob.receiptNumber, siteLocation, activeJob.selectedItem, singleAnalysisDate);
        const modelConfig = { responseMimeType: "application/json", responseSchema: responseSchema };
        // ✅ Vercel 4.5MB 한도 대응: 원본 대신 압축 이미지 전송 (전체 분석과 동일) — Request Entity Too Large 방지
        const compressedDataUrl = await compressImage(photoToAnalyze.base64, photoToAnalyze.mimeType, 2400, 2400, 0.92);
        const compressedBase64 = compressedDataUrl.split(',')[1];
        const jsonStr = await extractTextFromImage(compressedBase64, 'image/jpeg', prompt, modelConfig);
        const jsonData = JSON.parse(jsonStr) as RawEntryUnion[];
        
        if (Array.isArray(jsonData)) {
            newRawEntries.push(...jsonData);
        } else {
            throw new Error(`AI가 유효한 배열을 반환하지 않았습니다.`);
        }
        
        if (newRawEntries.length > 0) {
            const newExtractedEntries: ExtractedEntry[] = newRawEntries.map((rawEntry: RawEntryUnion) => {
                let primaryValue = '', tpValue: string | undefined = undefined;
                // AI가 스키마(STRING)와 달리 숫자(시마즈 등)를 반환할 수 있어 문자열 강제변환 — .match/.includes 오류 방지
                if (activeJob.selectedItem === "TN/TP") {
                    const tnVal = (rawEntry as RawEntryTnTp).value_tn;
                    const tpVal = (rawEntry as RawEntryTnTp).value_tp;
                    primaryValue = tnVal != null ? String(tnVal) : '';
                    tpValue = tpVal != null ? String(tpVal) : undefined;
                } else {
                    const sVal = (rawEntry as RawEntrySingle).value;
                    primaryValue = sVal != null ? String(sVal) : '';
                }

                const aiTime = String(rawEntry.time ?? '');
                let timePart = "00:00"; // Default
                // Robustly find HH:MM:SS or HH:MM, not matching parts of dates like '24' in '2024'.
                const timeMatch = aiTime.match(/(?:\s|T|^)(\d{1,2}:\d{2}(?::\d{2})?)/);
                if (timeMatch && timeMatch[1]) {
                    timePart = timeMatch[1];
                } else {
                    console.warn(`AI response "${aiTime}" did not contain a recognizable time component. Defaulting to '00:00'.`);
                }

                // 사진 한 장당 입력한 날짜 사용 (분석할 때마다 누적)
                const finalTimestamp = `${singleAnalysisDate} ${timePart}`.replace(/-/g, '/');

                return { id: genUUID(), time: finalTimestamp, value: primaryValue, valueTP: tpValue, identifier: undefined, identifierTP: undefined, isRuleMatched: false };
            });

            // 누적 + 중복 제거: 날짜+시간+데이터(value/valueTP)가 모두 같으면 동일 데이터 → 추가 안 함
            const existingData = activeJob.processedOcrData || [];
            const dupKey = (e: ExtractedEntry) => `${e.time}|${e.value ?? ''}|${e.valueTP ?? ''}`;
            const seenKeys = new Set(existingData.map(dupKey));
            const dedupedNew = newExtractedEntries.filter(e => {
                const k = dupKey(e);
                if (seenKeys.has(k)) return false;
                seenKeys.add(k);
                return true;
            });
            const skippedDup = newExtractedEntries.length - dedupedNew.length;

            const combinedData = [...existingData, ...dedupedNew];

            combinedData.sort((a, b) => {
                try {
                    const dateA = new Date(a.time.replace(/\//g, '-').replace(' ', 'T')).getTime();
                    const dateB = new Date(b.time.replace(/\//g, '-').replace(' ', 'T')).getTime();
                    if (isNaN(dateA) || isNaN(dateB)) return a.time.localeCompare(b.time);
                    return dateA - dateB;
                } catch {
                    return a.time.localeCompare(b.time);
                }
            });

            updateActiveJob(j => ({ ...j, processedOcrData: combinedData }));
            setSuccessMessage(`현재 사진 분석 완료 — ${dedupedNew.length}개 추가${skippedDup > 0 ? `, 중복 ${skippedDup}개 제외` : ''} (총 ${combinedData.length}개)`);

        } else {
            setProcessingError("AI가 현재 사진에서 유효한 데이터를 추출하지 못했습니다.");
        }
    } catch (e: any) {
        setProcessingError(e.message || "데이터 추출 중 알 수 없는 오류가 발생했습니다.");
    } finally {
        setIsLoading(false);
    }
  }, [activeJob, currentImageIndex, singleAnalysisDate, siteLocation, updateActiveJob]);

  const generatePromptForLogFileAnalysis = (): string => {
    return `You are an expert data extraction assistant. Analyze an image of a data log screen titled "FrmViewLog".

CRITICAL:
1) On the right, find the list of dates and identify the single selected/highlighted date. This date applies to ALL rows.
2) For each row in the left table:
   a) Build timestamp: take the first-column time like "[06:02:24]" and combine with the selected date → "YYYY-MM-DD HH:MM:SS".
   b) Extract ALL numeric values after the time column as strings. Remove commas (e.g., "2,611.27800" → "2611.27800").

OUTPUT (JSON array only):
[
  { "time": "YYYY-MM-DD HH:MM:SS", "values": ["<num1>", "<num2>", ...] }
]

Return ONLY the JSON array. No extra text/markdown. If nothing valid, return [].`;
  };

  const handleExtractFromLogFile = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      setProcessingError("먼저 이미지를 선택하거나 촬영해주세요.");
      return;
    }
    setIsLoading(true); setProcessingError(null);
    updateActiveJob(j => ({ ...j, processedOcrData: null, decimalPlaces: 0, submissionStatus: 'idle', submissionMessage: undefined }));

    interface RawLogEntry {
      time: string;
      values: string[];
    }
    
    let allRawExtractedEntries: RawLogEntry[] = [];
    let batchHadError = false;
    let criticalErrorOccurred: string | null = null;
    
    try {
        const prompt = generatePromptForLogFileAnalysis();
        const responseSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    time: { type: Type.STRING },
                    values: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["time", "values"]
            }
        };
        const modelConfig = { responseMimeType: "application/json", responseSchema: responseSchema, maxOutputTokens: 8192 };

        // ✅ 병렬 + 스태거: 200ms 간격으로 시작하여 Rate Limit 없이 빠르게 처리
        const imageProcessingPromises = activeJob.photos.map(async (image, index) => {
            await delay(index * 200);
            let jsonStr: string = "";
            try {
                const compressedDataUrl = await compressImage(image.base64, image.mimeType, 2400, 2400, 0.92);
                const compressedBase64 = compressedDataUrl.split(',')[1];
                jsonStr = await extractTextFromImage(compressedBase64, 'image/jpeg', prompt, modelConfig);

                const jsonDataFromImage = JSON.parse(jsonStr) as RawLogEntry[];
                if (Array.isArray(jsonDataFromImage)) {
                    return { status: 'fulfilled' as const, value: jsonDataFromImage };
                }
                return { status: 'rejected' as const, reason: `${image.file.name}: 유효한 JSON 배열이 아닙니다.` };
            } catch (imgErr: any) {
                if (imgErr.message?.includes("API_KEY") || imgErr.message?.includes("Quota exceeded")) {
                    criticalErrorOccurred = imgErr.message;
                }
                console.error(`[OCR] 로그 이미지 처리 실패 (${image.file.name}):`, imgErr.message);
                return { status: 'rejected' as const, reason: imgErr.message };
            }
        });

        const results = await Promise.all(imageProcessingPromises);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                allRawExtractedEntries.push(...result.value);
            } else {
                batchHadError = true;
            }
        });
        if (criticalErrorOccurred) throw new Error(criticalErrorOccurred);

        if (criticalErrorOccurred) throw new Error(criticalErrorOccurred);
        
        if (allRawExtractedEntries.length > 0) {
            const uniqueEntriesMap = new Map<string, RawLogEntry>();
            allRawExtractedEntries.forEach(entry => {
                if (!uniqueEntriesMap.has(entry.time)) {
                    uniqueEntriesMap.set(entry.time, entry);
                }
            });

            const isTnTpMode = activeJob.selectedItem === "TN/TP";
            
            const finalOcrData = Array.from(uniqueEntriesMap.values())
              .sort((a,b) => (a.time || '').localeCompare(b.time || ''))
              .map((rawEntry: RawLogEntry) => {
                const primaryValue = rawEntry.values?.[0] || '';
                const tpValue = isTnTpMode ? (rawEntry.values?.[1] || '') : undefined;
                return {
                  id: genUUID(),
                  time: rawEntry.time,
                  value: primaryValue,
                  valueTP: tpValue,
                  identifier: undefined,
                  identifierTP: undefined,
                  isRuleMatched: false
                };
              });

            updateActiveJob(j => ({ ...j, processedOcrData: finalOcrData }));
            if (batchHadError) setProcessingError("일부 이미지를 처리하지 못했습니다.");
        } else {
            setProcessingError("AI가 이미지에서 유효한 데이터를 추출하지 못했습니다.");
        }
    } catch (e: any) {
        setProcessingError(e.message || "데이터 추출 중 알 수 없는 오류가 발생했습니다.");
    } finally {
        setIsLoading(false);
    }
  }, [activeJob, updateActiveJob]);

  const handleEntryChange = useCallback((entryId: string, field: keyof ExtractedEntry, value: string | undefined) => {
    updateActiveJob(job => {
        if (!job.processedOcrData) return job;
        const updatedData = job.processedOcrData.map(entry =>
            entry.id === entryId ? { ...entry, [field]: value } : entry
        );
        return { ...job, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined };
    });
  }, [updateActiveJob]);

  const handleAddEntry = useCallback(() => {
    updateActiveJob(job => {
        if (!job) return job;
        const newEntry: ExtractedEntry = {
            id: genUUID(),
            time: '',
            value: '',
            valueTP: job.selectedItem === "TN/TP" ? '' : undefined,
            identifier: undefined,
            identifierTP: undefined,
            isRuleMatched: false
        };
        const updatedData = [...(job.processedOcrData || []), newEntry];
        return { ...job, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined };
    });
  }, [updateActiveJob]);

  const handleDeleteEntry = useCallback((entryId: string) => {
    updateActiveJob(job => {
        if (!job.processedOcrData) return job;
        const updatedData = job.processedOcrData.filter(entry => entry.id !== entryId);
        return { ...job, processedOcrData: updatedData, submissionStatus: 'idle', submissionMessage: undefined };
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
        const index = parseInt(sourceRowStr.trim(), 10) - 1;
        if (!isNaN(index)) sourceIndices.push(index);
    }
    
    const uniqueSourceIndices = [...new Set(sourceIndices)].sort((a, b) => b - a);

    if (uniqueSourceIndices.length === 0 || uniqueSourceIndices.some(i => i < 0 || i >= data.length)) {
      alert("유효하지 않은 행 번호입니다. 데이터 범위 내의 숫자나 '시작-끝' 형식으로 입력해주세요.");
      return;
    }
    
    const elementsToMove = uniqueSourceIndices.map(i => data[i]).reverse();
    uniqueSourceIndices.forEach(i => data.splice(i, 1));
    
    let targetIndex = data.length;
    if (targetRowStr && targetRowStr.trim()) {
        const target = parseInt(targetRowStr.trim(), 10) - 1;
        if (!isNaN(target) && target >= 0 && target <= data.length) {
            targetIndex = target;
        } else {
            alert(`새 위치 번호가 잘못되었습니다. 1부터 ${data.length + 1} 사이의 숫자를 입력해주세요.`);
            return;
        }
    }
    
    data.splice(targetIndex, 0, ...elementsToMove);

    updateActiveJob(job => ({
        ...job,
        processedOcrData: data,
        submissionStatus: 'idle',
        submissionMessage: undefined,
    }));
  }, [activeJob, updateActiveJob]);

  const handleAutoAssignIdentifiers = useCallback((startRowStr?: string, endRowStr?: string) => {
    if (!activeJob || !activeJob.processedOcrData || !activeJob.concentrationBoundaries) {
      setProcessingError("자동 할당을 위해선 추출된 데이터와 농도 분석이 필요합니다.");
      return;
    }

    const totalRows = activeJob.processedOcrData.length;
    const startIndex = startRowStr && startRowStr.trim() ? parseInt(startRowStr, 10) - 1 : 0;
    const endIndex = endRowStr && endRowStr.trim() ? parseInt(endRowStr, 10) - 1 : totalRows - 1;

    if (isNaN(startIndex) || isNaN(endIndex) || startIndex < 0 || endIndex >= totalRows || startIndex > endIndex) {
        setProcessingError("자동 할당을 위한 행 범위가 잘못되었습니다. 데이터 범위를 확인해주세요.");
        return;
    }

    const dataSlice = activeJob.processedOcrData.slice(startIndex, endIndex + 1);

    const isTpMode = activeJob.selectedItem === "TN/TP";
    const assignments = autoAssignIdentifiersByConcentration(
        dataSlice,
        activeJob.concentrationBoundaries,
        isTpMode
    );

    const updatedOcrData = [...activeJob.processedOcrData];
    assignments.forEach((assignment, index) => {
        const originalIndex = startIndex + index;
        const newIdentifier = assignment.tn !== undefined ? assignment.tn : updatedOcrData[originalIndex].identifier;
        const newIdentifierTP = assignment.tp !== undefined ? assignment.tp : updatedOcrData[originalIndex].identifierTP;

        updatedOcrData[originalIndex] = {
            ...updatedOcrData[originalIndex],
            identifier: newIdentifier,
            identifierTP: isTpMode ? newIdentifierTP : undefined,
        };
    });

    updateActiveJob(j => ({
        ...j,
        processedOcrData: updatedOcrData,
        submissionStatus: 'idle',
        submissionMessage: undefined
    }));
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleDownloadStampedImages = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      alert("스탬프를 적용할 사진이 없습니다.");
      return;
    }
    setIsDownloadingStamped(true);

    try {
      const pageIdentifier = pageType === 'PhotoLog' ? '수질' : pageType === 'FieldCount' ? '현장계수' : '현장';
      const sanitizedSite = sanitizeFilenameComponent(siteName);
      const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
      const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
      
      const zip = new JSZip();

      for (let i = 0; i < activeJob.photos.length; i++) {
        const imageInfo = activeJob.photos[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64,
          imageInfo.mimeType,
          activeJob.receiptNumber,
          siteLocation,
          activeJob.inspectionStartDate || '',
          activeJob.selectedItem,
          activeJob.photoComments[imageInfo.uid]
        );
        const stampedBlob = dataURLtoBlob(stampedDataUrl);
        const fileNameInZip = `${baseName}_${i + 1}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`;
        zip.file(fileNameInZip, stampedBlob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `${baseName}_Stamped_Images.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

    } catch (error: any) {
      console.error("Error creating stamped image zip:", error);
      alert(`스탬프 이미지 ZIP 파일 생성 중 오류 발생: ${error.message}`);
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [activeJob, siteName, siteLocation, pageType]);

  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !ktlJsonPreview) {
        alert("KTL 전송을 위한 모든 조건(작업 선택, 데이터, 사진, 필수정보)이 충족되지 않았습니다.");
        return;
    }
    setKtlPreflightData({
        jsonPayload: ktlJsonPreview, 
        fileNames: hypotheticalKtlFileNamesForPreview,
        context: { receiptNumber: activeJob.receiptNumber, siteLocation: siteLocation, selectedItem: activeJob.selectedItem, userName, inspectionStartDate: activeJob.inspectionStartDate }
    });
    setIsKtlPreflightModalOpen(true);
  }, [activeJob, userName, siteLocation, ktlJsonPreview, hypotheticalKtlFileNamesForPreview]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setIsKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: "KTL 전송을 위한 필수 데이터가 누락되었습니다." }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "(1/4) 전송 준비 중..."}));

    try {
        // fieldCountData를 processedOcrData 뒤에 합쳐서 전송
        const mergedOcrData = [
          ...(activeJob.processedOcrData || []),
          ...(pageType === 'PhotoLog' && activeJob.fieldCountData ? activeJob.fieldCountData : []),
        ];
        const identifierSequence = generateIdentifierSequence(mergedOcrData, activeJob.selectedItem);
        const payload: ClaydoxPayload = {
            receiptNumber: activeJob.receiptNumber, siteLocation, siteNameOnly: siteName, item: activeJob.selectedItem, updateUser: userName,
            ocrData: mergedOcrData,
            identifierSequence: identifierSequence,
            maxDecimalPlaces: activeJob.decimalPlaces,
            pageType: pageType,
            inspectionStartDate: activeJob.inspectionStartDate,
            inspectionEndDate: activeJob.inspectionEndDate,
        };

        const pageIdentifier = pageType === 'PhotoLog' ? '수질' : pageType === 'FieldCount' ? '현장계수' : '현장';
        const sanitizedSite = sanitizeFilenameComponent(siteName);
        const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
        const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
        
        const compositeFiles: File[] = [];
        const compositeFileNames: string[] = [];

        if (activeJob.photos.length > 0) {
            updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "(2/4) 보고서용 이미지 생성 중..."}));
            const imagesForA4: CompositeImageInput[] = activeJob.photos.map(p => ({
                base64: p.base64,
                mimeType: p.mimeType,
                comment: activeJob.photoComments[p.uid]
            }));

            const reportMeta: ReportMeta = {
                receiptNumber: activeJob.receiptNumber,
                siteLocation: siteLocation,
                item: activeJob.selectedItem,
                inspectionStartDate: activeJob.inspectionStartDate || '',
                inspectionEndDate: activeJob.inspectionEndDate || '',
                userName: userName,
            };
            const a4PageDataUrls = await generateA4ReportPages(imagesForA4, reportMeta, { quality: 0.92 });


            a4PageDataUrls.forEach((dataUrl, index) => {
                const pageNum = (index + 1).toString().padStart(2, '0');
                const fileName = `${baseName}_composite_${pageNum}.jpg`;
                const file = new File([dataURLtoBlob(dataUrl)], fileName, { type: 'image/jpeg' });
                compositeFiles.push(file);
                compositeFileNames.push(fileName);
            });
        }
        
        updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "(3/4) 원본 사진 압축 중..."}));
        const zip = new JSZip();
        for (let i = 0; i < activeJob.photos.length; i++) {
            const imageInfo = activeJob.photos[i];
            const compressedDataUrl = await compressImage(imageInfo.base64, imageInfo.mimeType);
            const fileNameInZip = `${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.jpg`;
            zip.file(fileNameInZip, dataURLtoBlob(compressedDataUrl));
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });
        
        const filesToUpload = [...compositeFiles, zipFile];
        const fileNamesForKtlJson = [...compositeFileNames, zipFile.name];

        updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "(4/4) KTL 서버로 업로드 중..."}));
        const p_key = pageType === 'PhotoLog' ? 'p2_check' : 'p3_check';
        const response = await sendToClaydoxApi(payload, filesToUpload, activeJob.selectedItem, fileNamesForKtlJson, p_key);
        updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message }));

    } catch (error: any) {
        updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${error.message}` }));
    }
  }, [activeJob, siteName, siteLocation, userName, updateActiveJob, pageType]);


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
            const identifierSequence = generateIdentifierSequence(job.processedOcrData, job.selectedItem);
            const payload: ClaydoxPayload = {
                receiptNumber: job.receiptNumber, siteLocation, siteNameOnly: siteName, item: job.selectedItem, updateUser: userName, ocrData: job.processedOcrData!,
                identifierSequence, maxDecimalPlaces: job.decimalPlaces, pageType: pageType, inspectionStartDate: job.inspectionStartDate, inspectionEndDate: job.inspectionEndDate,
            };
            const pageIdentifier = pageType === 'PhotoLog' ? '수질' : '현장';
            const sanitizedSite = sanitizeFilenameComponent(siteName);
            const sanitizedItemName = sanitizeFilenameComponent(job.selectedItem.replace('/', '_'));
            const baseName = `${job.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
            
            const compositeFiles: File[] = [];
            const compositeFileNames: string[] = [];

            if (job.photos.length > 0) {
                const imagesForA4: CompositeImageInput[] = job.photos.map(p => ({
                    base64: p.base64,
                    mimeType: p.mimeType,
                    comment: job.photoComments[p.uid]
                }));
                
                const reportMeta: ReportMeta = {
                    receiptNumber: job.receiptNumber,
                    siteLocation: siteLocation,
                    item: job.selectedItem,
                    inspectionStartDate: job.inspectionStartDate || '',
                    inspectionEndDate: job.inspectionEndDate || '',
                    userName: userName,
                };
                const a4PageDataUrls = await generateA4ReportPages(imagesForA4, reportMeta, { quality: 0.92 });
    
                a4PageDataUrls.forEach((dataUrl, index) => {
                    const pageNum = (index + 1).toString().padStart(2, '0');
                    const fileName = `${baseName}_composite_${pageNum}.jpg`;
                    const file = new File([dataURLtoBlob(dataUrl)], fileName, { type: 'image/jpeg' });
                    compositeFiles.push(file);
                    compositeFileNames.push(fileName);
                });
            }
            const zip = new JSZip();
            for (let i = 0; i < job.photos.length; i++) {
                const imageInfo = job.photos[i];
                const compressedDataUrl = await compressImage(imageInfo.base64, imageInfo.mimeType);
                const fileNameInZip = `${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.jpg`;
                zip.file(fileNameInZip, dataURLtoBlob(compressedDataUrl));
            }
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });
            
            const filesToUpload = [...compositeFiles, zipFile];
            const fileNamesForKtlJson = [...compositeFileNames, zipFile.name];

            const p_key = pageType === 'PhotoLog' ? 'p2_check' : 'p3_check';
            const response = await sendToClaydoxApi(payload, filesToUpload, job.selectedItem, fileNamesForKtlJson, p_key);
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'success', submissionMessage: response.message } : j));
        } catch (error: any) {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}` } : j));
        }
    }
    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  };

  const isControlsDisabled = isLoading || isDownloadingStamped || isSendingToClaydox || !!batchSendProgress || activeJob?.submissionStatus === 'sending';

  const StatusIndicator: React.FC<{ status: PhotoLogJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };

  return (
    <div className="w-full max-w-3xl bg-slate-900/60 backdrop-blur-sm border border-slate-700/50 rounded-xl shadow-lg p-5 sm:p-7 space-y-5">
      <h2 className="text-sm font-semibold text-sky-400/70 tracking-widest uppercase mb-1">{pageTitle}</h2>
  
      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300">작업 목록 ({jobs.length}개)</h3>
          {(onSaveAllDrafts || onLoadAllDrafts) && (
            <div className="grid grid-cols-4 gap-1">
              <button onClick={() => onSaveDraft?.(activeJob?.receiptNumber)} className="py-1 text-[11px] whitespace-nowrap font-medium border border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white rounded transition-colors">
                임시저장
              </button>
              <button onClick={() => onLoadDraft?.(activeJob?.receiptNumber)} className="py-1 text-[11px] whitespace-nowrap font-medium border border-slate-600 text-slate-300 hover:border-sky-500 hover:text-sky-300 rounded transition-colors">
                불러오기
              </button>
              <button onClick={() => onSaveAllDrafts()} className="py-1 text-[11px] whitespace-nowrap font-medium border border-slate-600 text-slate-300 hover:border-emerald-500 hover:text-emerald-300 rounded transition-colors">
                전체저장
              </button>
              <button onClick={() => onLoadAllDrafts()} className="py-1 text-[11px] whitespace-nowrap font-medium border border-slate-600 text-slate-300 hover:border-indigo-400 hover:text-indigo-300 rounded transition-colors">
                전체불러오기
              </button>
            </div>
          )}
          {draftMessage && (
            <p className={`text-xs font-medium px-1 ${draftMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {draftMessage.text}
            </p>
          )}
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div
                key={job.id}
                className={`p-2.5 rounded-md transition-all ${activeJobId === job.id ? 'bg-sky-600/30 ring-2 ring-sky-500' : 'bg-slate-700 hover:bg-slate-600/70'}`}
              >
                <div className="flex justify-between items-center">
                    <div className="flex-grow cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                        <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'} flex items-center gap-2`}>
                          {(() => {
                            const matched = applications.find(a =>
                              job.receiptNumber === a.receipt_no ||
                              job.receiptNumber.startsWith(a.receipt_no + '-')
                            );
                            return (
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${matched ? 'bg-green-400' : 'bg-red-500'}`}
                                title={matched ? `접수번호 일치: ${matched.receipt_no}` : '접수번호 미등록'}
                              />
                            );
                          })()}
                          {job.receiptNumber} / {job.selectedItem}
                        </span>
                    </div>
                    <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenExtraPhotoModal?.(job.receiptNumber, job.selectedItem);
                        }}
                        className="ml-1 px-2 py-1 rounded-md text-[10px] font-medium text-purple-300 bg-purple-900/30 hover:bg-purple-800/50 border border-purple-700/40 transition-colors flex-shrink-0"
                        title="추가 사진자료 전송"
                        aria-label={`${job.receiptNumber} 추가 사진 전송`}
                        disabled={isControlsDisabled}
                    >
                        📎 추가자료
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDeleteJob(job.id); }}
                        className="ml-1 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-red-600 transition-colors flex-shrink-0"
                        aria-label={`${job.receiptNumber} 작업 삭제`}
                        disabled={isControlsDisabled}
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
      {!activeJob && jobs.length === 0 && <p className="text-center text-slate-600 text-xs py-6">작업을 추가해 시작하세요.</p>}
  
      {activeJob && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          <h3 className="text-sm font-semibold text-slate-100">활성 작업: {activeJob.receiptNumber} / {activeJob.selectedItem}</h3>
          
          <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="min-w-0">
                      <label htmlFor="inspection-start-date" className="block text-sm font-medium text-slate-300 mb-1">검사 시작일 (선택)</label>
                      <div className="relative flex min-w-0">
                          <input type="date" id="inspection-start-date" value={activeJob.inspectionStartDate || ''}
                                 onChange={(e) => updateActiveJob(j => ({ ...j, inspectionStartDate: e.target.value }))}
                                 className="flex-1 min-w-0 w-0 p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm pr-9" />
                          {activeJob.inspectionStartDate && (
                              <button
                                  type="button"
                                  onClick={() => updateActiveJob(j => ({ ...j, inspectionStartDate: '' }))}
                                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-white"
                                  aria-label="검사 시작일 지우기"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                  </svg>
                              </button>
                          )}
                      </div>
                  </div>
                  <div className="min-w-0">
                      <label htmlFor="inspection-end-date" className="block text-sm font-medium text-slate-300 mb-1">검사 종료일 (선택)</label>
                      <div className="relative flex min-w-0">
                          <input type="date" id="inspection-end-date" value={activeJob.inspectionEndDate || ''}
                                 onChange={(e) => updateActiveJob(j => ({ ...j, inspectionEndDate: e.target.value }))}
                                 className="flex-1 min-w-0 w-0 p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm pr-9" />
                          {activeJob.inspectionEndDate && (
                              <button
                                  type="button"
                                  onClick={() => updateActiveJob(j => ({ ...j, inspectionEndDate: '' }))}
                                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-white"
                                  aria-label="검사 종료일 지우기"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                  </svg>
                              </button>
                          )}
                      </div>
                  </div>
              </div>
               <p className="text-xs text-slate-400">검사 시작/종료일은 AI 분석 시 시간(Time) 값의 날짜 부분을 완성하는 데 사용됩니다.</p>
          </div>
  
          <div className="mt-4 pt-4 border-t border-slate-600 space-y-3">
              <h4 className="text-md font-semibold text-slate-200">참고 사진 ({activeJob.photos.length}개)</h4>
              {isCameraOpen ? (
                  <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
              ) : (
                  <>
                      <ImageInput
                          onImagesSet={handleImagesSet}
                          onOpenCamera={handleOpenCamera}
                          isLoading={isLoading}
                          ref={fileInputRef}
                          selectedImageCount={activeJob.photos.length}
                      />
                      {currentImageIndex !== -1 && activeJob.photos[currentImageIndex] && (
                          <ImagePreview
                              imageBase64={activeJob.photos[currentImageIndex].base64}
                              fileName={activeJob.photos[currentImageIndex].file.name}
                              mimeType={activeJob.photos[currentImageIndex].mimeType}
                              receiptNumber={activeJob.receiptNumber}
                              item={activeJob.selectedItem}
                              showOverlay={true}
                              totalSelectedImages={activeJob.photos.length}
                              currentImageIndex={currentImageIndex}
                              onDelete={() => handleDeleteImage(currentImageIndex)}
                              siteName={siteName}
                              comment={activeJob.photoComments[activeJob.photos[currentImageIndex].uid]}
                              gpsAddress={siteLocation.replace(siteName, '').replace('()','').trim()}
                          />
                      )}
                      <ThumbnailGallery
                          images={activeJob.photos}
                          currentIndex={currentImageIndex}
                          onSelectImage={setCurrentImageIndex}
                          onDeleteImage={handleDeleteImage}
                          disabled={isLoading}
                      />
                  </>
              )}
          </div>
          
          <OcrControls
            onExtract={handleExtractText}
            isExtractDisabled={isControlsDisabled || activeJob.photos.length === 0}
            onExtractLogFile={handleExtractFromLogFile}
            isExtractLogFileDisabled={isControlsDisabled || activeJob.photos.length === 0}
            onClear={resetActiveJobData}
            isClearDisabled={isControlsDisabled || (activeJob.photos.length === 0 && !activeJob.processedOcrData)}
            onDownloadStampedImages={handleDownloadStampedImages}
            isDownloadStampedDisabled={isControlsDisabled || activeJob.photos.length === 0}
            isDownloadingStamped={isDownloadingStamped}
            onInitiateSendToKtl={handleInitiateSendToKtl}
            isClaydoxDisabled={isControlsDisabled || !activeJob.processedOcrData || activeJob.photos.length === 0 || !siteLocation.trim()}
            isSendingToClaydox={isSendingToClaydox || activeJob.submissionStatus === 'sending'}
            sendingMessage={activeJob.submissionMessage}
            ktlApiCallStatus={ocrControlsKtlStatus}
            onAutoAssignIdentifiers={showAutoAssignIdentifiers ? handleAutoAssignIdentifiers : undefined}
            isAutoAssignDisabled={isControlsDisabled || !activeJob.processedOcrData}
            onAnalyzeSinglePhoto={handleAnalyzeSinglePhoto}
            isAnalyzeSingleDisabled={isControlsDisabled || currentImageIndex === -1 || !singleAnalysisDate}
            singleAnalysisDate={singleAnalysisDate}
            onSingleAnalysisDateChange={setSingleAnalysisDate}
          />
  
          {showRangeDifferenceDisplay && (
            <RangeDifferenceDisplay results={activeJob.rangeDifferenceResults} />
          )}
          
          <OcrResultDisplay
            ocrData={activeJob.processedOcrData}
            error={processingError}
            successMessage={successMessage}
            isLoading={isLoading}
            contextProvided={!!(activeJob.receiptNumber && siteLocation)}
            hasImage={activeJob.photos.length > 0}
            selectedItem={activeJob.selectedItem}
            onEntryIdentifierChange={(id, val) => handleEntryChange(id, 'identifier', val)}
            onEntryIdentifierTPChange={(id, val) => handleEntryChange(id, 'identifierTP', val)}
            onEntryTimeChange={(id, val) => handleEntryChange(id, 'time', val)}
            onEntryPrimaryValueChange={(id, val) => handleEntryChange(id, 'value', val)}
            onEntryValueTPChange={(id, val) => handleEntryChange(id, 'valueTP', val)}
            onAddEntry={handleAddEntry}
            onDeleteEntry={handleDeleteEntry}
            onReorderRows={handleReorderRows}
            availableIdentifiers={availableIdentifiers}
            tnIdentifiers={availableTnIdentifiers}
            tpIdentifiers={availableTpIdentifiers}
            rawJsonForCopy={
              activeJob.processedOcrData
                ? JSON.stringify(
                    activeJob.processedOcrData.filter(e => e.value.trim() || (e.valueTP && e.valueTP.trim())),
                    null, 2
                  )
                : null
            }
            ktlJsonToPreview={ktlJsonPreview}
            fieldCountData={activeJob.fieldCountData}
            fieldCountAnalyzedAt={activeJob.fieldCountAnalyzedAt}
            fieldCountIdentifiers={activeJob.selectedItem === 'TP' ? P3_TP_IDENTIFIERS : P3_TN_IDENTIFIERS}
            onFieldCountIdentifierChange={(entryId, identifier) => {
              updateActiveJob(job => ({
                ...job,
                fieldCountData: (job.fieldCountData || []).map(e =>
                  e.id === entryId ? { ...e, identifier } : e
                ),
              }));
            }}
          />

          {/* ── 현장 계수 사진 추가 분석 (PhotoLog 전용) ── */}
          {pageType === 'PhotoLog' && (
            <div className="mt-6 border border-amber-500/30 rounded-xl overflow-hidden">
              {/* 헤더 (접기/펼치기) */}
              <button
                type="button"
                onClick={() => setIsFieldCountSectionOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 bg-amber-500/10 hover:bg-amber-500/20 transition-colors text-amber-400 font-semibold text-sm"
              >
                <span className="flex items-center gap-2">
                  <span>🧪</span>
                  현장 계수 사진 추가 분석
                  {activeJob.fieldCountData && activeJob.fieldCountData.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-amber-500/30 rounded-full text-xs">
                      {activeJob.fieldCountData.length}건 완료
                    </span>
                  )}
                </span>
                <span className="text-lg">{isFieldCountSectionOpen ? '▲' : '▼'}</span>
              </button>

              {isFieldCountSectionOpen && (
                <div className="p-4 space-y-4 bg-slate-800/50">
                  <p className="text-xs text-slate-400">
                    현장 계수 사진 (최대 4장)을 업로드하고 분석하면 위 테이블 하단에 결과가 추가됩니다.
                  </p>

                  {/* 사진 목록 */}
                  {activeJob.fieldCountPhotos && activeJob.fieldCountPhotos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeJob.fieldCountPhotos.map((p, i) => (
                        <div key={p.uid} className="relative w-20 h-20 rounded-lg overflow-hidden border border-amber-500/30">
                          <img src={`data:${p.mimeType};base64,${p.base64}`} alt={`현장계수 ${i+1}`} className="w-full h-full object-cover" />
                          <button
                            onClick={() => handleRemoveFieldCountPhoto(p.uid)}
                            className="absolute top-0.5 right-0.5 bg-red-600/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-500"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 업로드 버튼들 */}
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fieldCountFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFieldCountFileChange}
                    />
                    <button
                      type="button"
                      onClick={() => fieldCountFileInputRef.current?.click()}
                      disabled={isLoadingFieldCount}
                      className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600 transition-colors"
                    >
                      📁 파일 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFieldCountCameraOpen(true)}
                      disabled={isLoadingFieldCount}
                      className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm border border-slate-600 transition-colors"
                    >
                      📷 카메라
                    </button>
                  </div>

                  {fieldCountError && (
                    <p className="text-xs text-red-400">{fieldCountError}</p>
                  )}

                  {/* 분석 + 초기화 버튼 */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleFieldCountAnalyze}
                      disabled={isLoadingFieldCount || !activeJob.fieldCountPhotos || activeJob.fieldCountPhotos.length === 0}
                      className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      {isLoadingFieldCount ? <><span className="animate-spin">⟳</span> 분석 중...</> : '🔬 별도 분석 시작'}
                    </button>
                    {activeJob.fieldCountData && activeJob.fieldCountData.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearFieldCountData}
                        className="px-3 py-2 rounded-lg bg-red-900/50 hover:bg-red-800/50 text-red-400 text-sm border border-red-700/50 transition-colors"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 현장 계수 카메라 */}
          {isFieldCountCameraOpen && (
            <CameraView
              onCapture={(file, base64, mimeType) => {
                const photo = {
                  uid: `fc-${Date.now()}-${Math.random()}`,
                  file,
                  base64,
                  mimeType
                };
                handleFieldCountPhotoCaptured(photo);
              }}
              onClose={() => setIsFieldCountCameraOpen(false)}
            />
          )}
        </div>
      )}
  
      {jobs.length > 0 && (
      <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
          <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
          <p className="text-sm text-slate-400">
              이 페이지의 모든 작업을 KTL로 전송합니다. 각 작업에 사진과 추출된 데이터가 있어야 합니다.
          </p>
          {batchSendProgress && (
              <div className="p-3 bg-slate-700/50 rounded-md text-sky-300 text-sm flex items-center gap-2">
                  <Spinner size="sm" />
                  <span>{batchSendProgress}</span>
              </div>
          )}
          <ActionButton
              onClick={handleBatchSendToKtl}
              disabled={isControlsDisabled}
              fullWidth
              variant="secondary"
              className="bg-teal-600 hover:bg-teal-500"
          >
              {batchSendProgress ? '전송 중...' : `이 페이지의 모든 작업 전송 (${jobs.length}건)`}
          </ActionButton>
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
    </div>
  );
};

export default AnalysisPage;
