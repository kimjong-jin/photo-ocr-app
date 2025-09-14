

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo as BaseImageInfo } from '../ImageInput';
import { CameraView } from '../CameraView';
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
// 🔥 여기서 빌드 에러 방지: constants.ts에 정의가 없다면 import 제거하거나 추가 필요
import { TN_IDENTIFIERS, TP_IDENTIFIERS } from '../../shared/constants';
import KtlPreflightModal, { KtlPreflightData } from '../KtlPreflightModal';
import { ThumbnailGallery } from '../ThumbnailGallery';
import { Type } from '@google/genai';
import { ActionButton } from '../ActionButton';
import { Spinner } from '../Spinner';
import {
  generateA4CompositeJPEGPages,
  dataURLtoBlob,
  generateStampedImage,
  CompositeImageInput,
} from '../../services/imageStampingService';
import { autoAssignIdentifiersByConcentration } from '../../services/identifierAutomationService';
import type {
  PhotoLogJob,
  JobPhoto,
  ExtractedEntry,
  ConcentrationBoundaries,
} from '../../shared/types';

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
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const AnalysisPage: React.FC<AnalysisPageProps> = ({
  pageTitle, pageType, showRangeDifferenceDisplay, showAutoAssignIdentifiers,
  userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob
}) => {
  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(-1);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableTnIdentifiers = pageType === 'FieldCount' ? P2_TN_IDENTIFIERS : TN_IDENTIFIERS;
  const availableTpIdentifiers = pageType === 'FieldCount' ? P2_TP_IDENTIFIERS : TP_IDENTIFIERS;

  const ocrControlsKtlStatus = useMemo<KtlApiCallStatus>(() => {
    if (!activeJob) return 'idle';
    if (activeJob.submissionStatus === 'success' || activeJob.submissionStatus === 'error') {
        return activeJob.submissionStatus;
    }
    return 'idle';
  }, [activeJob]);

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
    const sanitizedSite = sanitizeFilenameComponent(siteLocation);
    const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem === "TN/TP" ? "TN_TP" : activeJob.selectedItem);
    const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
    
    const pageCount = Math.ceil(activeJob.photos.length / 4);
    const compositeNames = Array.from({ length: pageCount }, (_, i) => {
        const pageNum = (i + 1).toString().padStart(2, '0');
        return `${baseName}_composite_${pageNum}.jpg`;
    });

    return [ ...compositeNames, `${baseName}_Compression.zip` ];
  }, [activeJob, siteLocation, pageType]);

  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;
    const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData, activeJob.selectedItem);
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: siteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence: identifierSequence,
      pageType: pageType,
      maxDecimalPlaces: activeJob.decimalPlaces,
    };
    return generateKtlJsonForPreview(payload, activeJob.selectedItem, hypotheticalKtlFileNamesForPreview);
  }, [activeJob, userName, siteLocation, pageType, hypotheticalKtlFileNamesForPreview]);


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
        uid: self.crypto.randomUUID()
    }));

    updateActiveJob(job => {
        const existingPhotos = job.photos || [];
        const combined = [...existingPhotos, ...photosWithUids];
        const uniqueImageMap = new Map<string, JobPhoto>();
        combined.forEach(img => {
            const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
            if (!uniqueImageMap.has(key)) uniqueImageMap.set(key, img);
        });
        const finalPhotos = Array.from(uniqueImageMap.values());
        
        return { ...job, photos: finalPhotos, processedOcrData: null, rangeDifferenceResults: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    const capturedImageInfo: JobPhoto = { file, base64, mimeType, uid: self.crypto.randomUUID() };
    updateActiveJob(job => {
        const newPhotos = [...(job.photos || []), capturedImageInfo];
        setCurrentImageIndex(newPhotos.length - 1);
        return { ...job, photos: newPhotos, processedOcrData: null, rangeDifferenceResults: null, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setIsCameraOpen(false);
    setProcessingError(null);
  }, [updateActiveJob]);

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

  const generatePromptForProAnalysis = ( receiptNum: string, siteLoc: string, item: string ): string => {
    let prompt = `제공된 측정 장비의 이미지를 분석해주세요.
컨텍스트:`;
    if (receiptNum) prompt += `\n- 접수번호: ${receiptNum}`;
    if (siteLoc) prompt += `\n- 현장/위치: ${siteLoc}`;
    
    if (item === "TN/TP") {
        prompt += `\n- 항목/파라미터: TN 및 TP. 이미지에서 TN과 TP 각각의 시간 및 값 쌍을 추출해야 합니다.`;
        prompt += `\n- 각 시간(time) 항목에 대해 TN 값은 "value_tn" 키에, TP 값은 "value_tp" 키에 할당해야 합니다.`;
        prompt += `\n\n중요 규칙:\n1.  **두 값 모두 추출:** 같은 시간대에 TN과 TP 값이 모두 표시된 경우, JSON 객체에 "value_tn"과 "value_tp" 키를 **둘 다 포함해야 합니다.**\n    예시: { "time": "...", "value_tn": "1.23", "value_tp": "0.45" }`;
        prompt += `\n2.  **한 값만 있는 경우:** 특정 시간대에 TN 또는 TP 값 중 하나만 명확하게 식별 가능한 경우 (예를 들어, 다른 값의 칸이 비어 있거나 'null' 또는 '-'로 표시된 경우), 해당 값의 키만 포함하고 다른 키는 **생략(omit)합니다**.\n    예시 (TN만 있고 TP 칸이 비어 있음): { "time": "...", "value_tn": "1.23" }\n    예시 (TP만 있고 TN 칸이 비어 있음): { "time": "...", "value_tp": "0.45" }`;
        prompt += `\n3.  **값 형식:** 모든 값 필드에는 이미지에서 보이는 **순수한 숫자 값만** 포함해야 합니다. 단위(mg/L, mgN/L 등), 지시자(N, P), 주석(저, 고, [M_] 등)은 **모두 제외**하세요.`;
        prompt += `\n\nJSON 출력 형식 예시 (항목: TN/TP):\n[\n  { "time": "2025/04/23 05:00", "value_tn": "46.2", "value_tp": "1.2" },\n  { "time": "2025/04/23 06:00", "value_tn": "5.388", "value_tp": "0.1" },\n  { "time": "2025/05/21 09:38", "value_tn": "89.629" },\n  { "time": "2025/05/21 10:25", "value_tp": "2.5" }\n]`;
    } else { 
      prompt += `\n- 항목/파라미터: ${item}. 이 항목의 측정값을 이미지에서 추출해주세요.`;
      prompt += `\n  "value" 필드에는 각 측정 항목의 **순수한 숫자 값만** 포함해야 합니다. 예를 들어, 이미지에 "N 89.629 mgN/L [M_]"라고 표시되어 있다면 "value"에는 "89.629"만 와야 합니다.`;
      prompt += `\n  항목 지시자(예: "N ", "TOC "), 단위(예: "mgN/L", "mg/L"), 상태 또는 주석(예: "[M_]", "(A)") 등은 **모두 제외**해야 합니다.`;
      prompt += `\n\nJSON 출력 형식 예시 (항목: ${item}):`;
      if (item === "TN") {
        prompt += `\n[\n  { "time": "2025/05/21 09:38", "value": "89.629" },\n  { "time": "2025/05/21 10:25", "value": "44.978" },\n  { "time": "2025/05/21 12:46", "value": "6.488" }\n]`;
      } else if (item === "TP") {
        prompt += `\n[\n  { "time": "YYYY/MM/DD HH:MM", "value": "X.XXX" }\n]`;
      } else { 
        prompt += `\n[\n  { "time": "YYYY/MM/DD HH:MM", "value": "X.XXX" },\n  { "time": "YYYY/MM/DD HH:MM", "value": "Y.YYY" }\n]`;
      }
    }
    prompt += `

작업:
이미지에서 데이터 테이블이나 목록을 식별해주세요.
장치 화면에 보이는 모든 "Time"(시각) 및 관련 값 쌍을 추출해주세요.

JSON 출력 및 데이터 추출을 위한 특정 지침:
1.  전체 응답은 **반드시** 유효한 단일 JSON 배열이어야 합니다. 응답은 대괄호 '['로 시작해서 대괄호 ']'로 끝나야 하며, 이 배열 구조 외부에는 **어떠한 다른 텍스트도 포함되어서는 안 됩니다.**
2.  JSON 데이터 자체를 제외하고는, JSON 배열 외부 또는 내부에 \`\`\`json\`\`\`와(과) 같은 마크다운 구분 기호, 소개, 설명, 주석 또는 기타 텍스트를 **절대로 포함하지 마세요.**
3.  배열 내의 각 JSON 객체는 정확한 JSON 형식이어야 합니다. 특히, 속성 값 뒤 (예: "value": "202.0" 에서 "202.0" 뒤)에는 다음 문자가 와야 합니다:
    *   쉼표(,) : 객체에 속성이 더 있는 경우
    *   닫는 중괄호(}) : 객체의 마지막 속성인 경우
    이 외의 다른 텍스트나 문자를 **절대로 추가하지 마세요.**
4.  지정된 "항목/파라미터" 관련 데이터를 우선적으로 추출하되, 장치 화면에서 식별 가능한 모든 "Time"(시각) 및 관련 값 쌍을 반드시 추출해야 합니다.
5.  **"Time"(시각) 추출 규칙:**
    - **표 전체에 대한 날짜 식별:** 먼저, 데이터 표 전체에 적용되는 주요 날짜(예: \`25/06/30\`)를 화면에서 찾으세요. 이 날짜는 종종 표의 상단이나 근처에 표시됩니다.
    - **행별 시간 구성:** 표의 각 행에 대해, 행의 시각 표시자(예: \`00\`부터 \`23\`까지의 숫자, 이는 시간(hour)을 나타냄)를 위에서 식별한 주요 날짜와 결합하여 완전한 타임스탬프를 만드세요. 분(minute)은 \`00\`으로 설정하세요. (예: 날짜가 \`25/07/01\`이고 행 표시자가 \`08\`이면, 시간은 \`2025/07/01 08:00\`이 됩니다. 2자리 연도는 현재 세기를 기준으로 \`20xx\`로 변환하세요.)
    - **최종 시간 형식:** 최종 시간은 \`YYYY/MM/DD HH:MM\` 형식으로 일관되게 포맷해주세요.
    - **개별 타임스탬프:** 만약 표 전체에 적용되는 날짜가 없고 각 행에 완전한 날짜와 시간이 이미 있다면, 그 값을 그대로 사용하세요. 시간만 표시된 경우 날짜 없이 시간만 추출하세요.
6.  값 필드 ("value", "value_tn", "value_tp"): **오직 숫자 부분만** 추출해주세요. 이미지에 "N 89.629 mgN/L [M_]"와 같이 표시되어 있다면, 해당 값 필드에는 "89.629"와 같이 순수한 숫자 문자열만 포함해야 합니다. 접두사(예: "N "), 단위(예: "mgN/L"), 텍스트 주석(예: "[M_]", "(A)", "저", "고 S") 등은 **모두 제외**해야 합니다. 만약 숫자 값을 명확히 식별할 수 없다면, 해당 값 필드를 JSON 객체에서 생략하거나 빈 문자열 ""로 설정해주세요.
7.  항목이 "TN/TP"인 경우:
    - 각 객체는 "time"을 포함해야 합니다.
    - TN 데이터가 있으면 "value_tn"을 포함해야 합니다.
    - TP 데이터가 있으면 "value_tp"를 포함해야 합니다.
    - 특정 시간 항목에 대해 TN 또는 TP 값 중 하나만 있을 수 있습니다. 해당 값만 포함합니다. (예: {"time": "...", "value_tn": "..."} 또는 {"time": "...", "value_tp": "..."})
8.  카메라에서 생성된 타임스탬프 및 UI 버튼 텍스트는 실제 데이터의 일부가 아닌 한 제외하세요.
9.  장치 화면에서 "Time" 및 관련 값 쌍을 전혀 찾을 수 없거나 이미지가 인식 가능한 데이터 표시를 포함하지 않는 경우 빈 JSON 배열([])을 반환하세요.
10. "reactors_input" 또는 "reactors_output" 또는 유사한 마커를 응답에 포함하지 마세요. JSON 응답은 순수하게 데이터 객체의 배열이어야 합니다.
`;
    return prompt;
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

        const imageProcessingPromises = activeJob.photos.map(async (image) => {
            let jsonStr: string = "";
            try {
                const prompt = generatePromptForProAnalysis(activeJob.receiptNumber, siteLocation, activeJob.selectedItem);
                const modelConfig = { responseMimeType: "application/json", responseSchema: responseSchema };
                
                jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, modelConfig);
                
                const jsonDataFromImage = JSON.parse(jsonStr) as RawEntryUnion[];
                if (Array.isArray(jsonDataFromImage)) {
                    return { status: 'fulfilled', value: jsonDataFromImage };
                }
                return { status: 'rejected', reason: `Image ${image.file.name} did not return a valid JSON array.` };
            } catch (imgErr: any) {
                if (imgErr.message?.includes("API_KEY") || imgErr.message?.includes("Quota exceeded")) {
                    criticalErrorOccurred = imgErr.message;
                }
                let reason = (imgErr instanceof SyntaxError) ? `JSON parsing failed: ${imgErr.message}. AI response: ${jsonStr}` : imgErr.message;
                return { status: 'rejected', reason };
            }
        });

        const results = await Promise.all(imageProcessingPromises);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                if (Array.isArray(result.value)) allRawExtractedEntries.push(...result.value);
            } else if (result.status === 'rejected') {
                batchHadError = true;
            }
        });

        if (criticalErrorOccurred) throw new Error(criticalErrorOccurred);
        
        if (allRawExtractedEntries.length > 0) {
            const normalizeTime = (timeStr: string): string => {
                if (!timeStr) return '';
                const standardized = timeStr.replace(/-/g, '/');
                const match = standardized.match(/(\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2})/);
                return match ? match[1] : standardized;
            };

            const uniqueEntriesMap = new Map<string, RawEntryUnion>();
            allRawExtractedEntries.forEach(entry => {
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
            const finalOcrData = Array.from(uniqueEntriesMap.values()).sort((a,b) => a.time.localeCompare(b.time)).map((rawEntry: RawEntryUnion) => {
                let primaryValue = '', tpValue: string | undefined = undefined;
                if (activeJob.selectedItem === "TN/TP") {
                    const tnTpEntry = rawEntry as RawEntryTnTp;
                    primaryValue = tnTpEntry.value_tn || '';
                    tpValue = tnTpEntry.value_tp;
                } else {
                    primaryValue = (rawEntry as RawEntrySingle).value || '';
                }
                return { id: self.crypto.randomUUID(), time: rawEntry.time, value: primaryValue, valueTP: tpValue, identifier: undefined, identifierTP: undefined, isRuleMatched: false };
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
  }, [activeJob, siteLocation, updateActiveJob]);

  const generatePromptForLogFileAnalysis = (): string => {
    return `You are an expert data extraction assistant. Your task is to analyze an image of a data log screen titled 'FrmViewLog' and extract the tabular data into a structured JSON format.
  
  CRITICAL INSTRUCTIONS:
  
  1.  **Identify the Date:** First, locate the list of dates on the right side of the window. Identify the single date that is currently selected or highlighted. This is the date for ALL data rows in the main table.
  
  2.  **Extract Data Rows:** For each row in the main data table on the left, perform the following:
      a.  **Construct Timestamp:** Take the time from the first column (e.g., \`[06:02:24]\`) and combine it with the single date you identified in step 1. The final format for the 'time' field must be 'YYYY-MM-DD HH:MM:SS'. For example, if the selected date is '2025-09-10' and the time is '[06:02:24]', the timestamp is '2025-09-10 06:02:24'.
      b.  **Extract Values:** Extract ALL numerical values that appear after the timestamp column in that row. The values should be returned as an array of strings. Remove any commas from numbers (e.g., '2,611.27800' should become '2611.27800').
  
  3.  **JSON Output Format:** The final output MUST be a single, valid JSON array. Each object in the array represents a row from the table and must have the following keys:
      *   \`time\`: The full timestamp string you constructed.
      *   \`values\`: An array of strings, where each string is a numerical value from the columns following the timestamp.
  
  EXAMPLE:
  If the selected date is '2025-09-10' and a row is \`[06:02:24]   4.333   0.302   2,611.27800\`, the corresponding JSON object should be:
  {
    "time": "2025-09-10 06:02:24",
    "values": ["4.333", "0.302", "2611.27800"]
  }
  
  Respond ONLY with the JSON array. Do not include any other text, explanations, or markdown formatting. If no valid data can be extracted, return an empty array \`[]\`.`;
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
        const modelConfig = { responseMimeType: "application/json", responseSchema: responseSchema };

        const imageProcessingPromises = activeJob.photos.map(async (image) => {
            let jsonStr: string = "";
            try {
                jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, modelConfig);
                const jsonDataFromImage = JSON.parse(jsonStr) as RawLogEntry[];
                if (Array.isArray(jsonDataFromImage)) {
                    return { status: 'fulfilled', value: jsonDataFromImage };
                }
                return { status: 'rejected', reason: `Image ${image.file.name} did not return a valid JSON array.` };
            } catch (imgErr: any) {
                if (imgErr.message?.includes("API_KEY") || imgErr.message?.includes("Quota exceeded")) {
                    criticalErrorOccurred = imgErr.message;
                }
                let reason = (imgErr instanceof SyntaxError) ? `JSON parsing failed: ${imgErr.message}. AI response: ${jsonStr}` : imgErr.message;
                return { status: 'rejected', reason };
            }
        });

        const results = await Promise.all(imageProcessingPromises);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                if (Array.isArray(result.value)) allRawExtractedEntries.push(...result.value);
            } else if (result.status === 'rejected') {
                batchHadError = true;
            }
        });

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
                  id: self.crypto.randomUUID(),
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
            id: self.crypto.randomUUID(),
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
    // FIX: Corrected state setter function name from setKtlPreflightModalOpen to setIsKtlPreflightModalOpen.
    setIsKtlPreflightModalOpen(true);
  }, [activeJob, userName, siteLocation, ktlJsonPreview, hypotheticalKtlFileNamesForPreview]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    // FIX: Corrected state setter function name from setKtlPreflightModalOpen to setIsKtlPreflightModalOpen.
    setIsKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: "KTL 전송을 위한 필수 데이터가 누락되었습니다." }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: "전송 중..."}));

    try {
        const identifierSequence = generateIdentifierSequence(activeJob.processedOcrData, activeJob.selectedItem);
        const payload: ClaydoxPayload = {
            receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem, updateUser: userName,
            ocrData: activeJob.processedOcrData,
            identifierSequence: identifierSequence,
            maxDecimalPlaces: activeJob.decimalPlaces,
            pageType: pageType,
        };

        const pageIdentifier = pageType === 'PhotoLog' ? '수질' : '현장';
        const sanitizedSite = sanitizeFilenameComponent(siteLocation);
        const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
        const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${pageIdentifier}_${sanitizedItemName}`;
        
        const compositeFiles: File[] = [];
        const compositeFileNames: string[] = [];

        if (activeJob.photos.length > 0) {
            const imagesForA4: CompositeImageInput[] = activeJob.photos.map(p => ({
                base64: p.base64,
                mimeType: p.mimeType,
                comment: activeJob.photoComments[p.uid]
            }));

            const stampDetails = {
                receiptNumber: activeJob.receiptNumber,
                siteLocation: siteLocation,
                item: activeJob.selectedItem,
                inspectionStartDate: ''
            };
            const a4PageDataUrls = await generateA4CompositeJPEGPages(imagesForA4, stampDetails);


            a4PageDataUrls.forEach((dataUrl, index) => {
                const pageNum = (index + 1).toString().padStart(2, '0');
                const fileName = `${baseName}_composite_${pageNum}.jpg`;
                const file = new File([dataURLtoBlob(dataUrl)], fileName, { type: 'image/jpeg' });
                compositeFiles.push(file);
                compositeFileNames.push(fileName);
            });
        }
        
        const zip = new JSZip();
        for (let i = 0; i < activeJob.photos.length; i++) {
            const imageInfo = activeJob.photos[i];
            const originalDataUrl = `data:${imageInfo.mimeType};base64,${imageInfo.base64}`;
            const fileNameInZip = `${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`;
            zip.file(fileNameInZip, dataURLtoBlob(originalDataUrl));
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });
        
        const filesToUpload = [...compositeFiles, zipFile];
        const fileNamesForKtlJson = [...compositeFileNames, zipFile.name];

        const response = await sendToClaydoxApi(payload, filesToUpload, activeJob.selectedItem, fileNamesForKtlJson);
        updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message }));

    } catch (error: any) {
        updateActiveJob(j => ({ ...j, submissionStatus: 'error', submissionMessage: `KTL 전송 실패: ${error.message}` }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob, pageType]);


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
                receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem, updateUser: userName, ocrData: job.processedOcrData!,
                identifierSequence, maxDecimalPlaces: job.decimalPlaces, pageType: pageType,
            };
            const pageIdentifier = pageType === 'PhotoLog' ? '수질' : '현장';
            const sanitizedSite = sanitizeFilenameComponent(siteLocation);
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
                
                const stampDetails = {
                    receiptNumber: job.receiptNumber,
                    siteLocation: siteLocation,
                    item: job.selectedItem,
                    inspectionStartDate: ''
                };
                const a4PageDataUrls = await generateA4CompositeJPEGPages(imagesForA4, stampDetails);
    
                a4PageDataUrls.forEach((dataUrl, index) => {
                    const pageNum = (index + 1).toString().padStart(2, '0');
                    const fileName = `${baseName}_composite_${pageNum}.jpg`;
                    const file = new File([dataURLtoBlob(dataUrl)], fileName, { type: 'image/jpeg' });
                    compositeFiles.push(file);
                    compositeFileNames.push(fileName);
                });
            }
            
            const zip = new JSZip();
            for (const imageInfo of job.photos) {
                const originalDataUrl = `data:${imageInfo.mimeType};base64,${imageInfo.base64}`;
                zip.file(`${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`, dataURLtoBlob(originalDataUrl));
            }
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });

            const filesToUpload = [...compositeFiles, zipFile];
            const fileNamesForKtlJson = [...compositeFileNames, zipFile.name];

            const response = await sendToClaydoxApi(payload, filesToUpload, job.selectedItem, fileNamesForKtlJson);
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'success', submissionMessage: response.message || '전송 성공' } : j));
        } catch (error: any) {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}` } : j));
        }
    }

    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  };
  
    const handleDownloadStampedImages = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
        alert("다운로드할 이미지가 없습니다.");
        return;
    }
    setIsDownloadingStamped(true);
    try {
        const zip = new JSZip();
        const pageIdentifier = pageType === 'PhotoLog' ? '수질' : '현장';
        const sanitizedReceipt = sanitizeFilenameComponent(activeJob.receiptNumber);
        const sanitizedSite = sanitizeFilenameComponent(siteLocation);
        const sanitizedItem = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
        const baseName = `${sanitizedReceipt}_${sanitizedSite}_${pageIdentifier}_${sanitizedItem}`;

        for (let i = 0; i < activeJob.photos.length; i++) {
            const imageInfo = activeJob.photos[i];
            const comment = activeJob.photoComments[imageInfo.uid];
            const stampedDataUrl = await generateStampedImage(
                imageInfo.base64,
                imageInfo.mimeType,
                activeJob.receiptNumber,
                siteLocation,
                '',
                activeJob.selectedItem,
                comment
            );
            const blob = dataURLtoBlob(stampedDataUrl);
            zip.file(`${baseName}_${i + 1}.png`, blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = `${baseName}_stamped_images.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

    } catch (error) {
        console.error("Error creating stamped image zip:", error);
        alert(`스탬프 이미지 ZIP 파일 생성 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        setIsDownloadingStamped(false);
    }
  }, [activeJob, siteLocation, pageType]);

  const isControlsDisabled = isLoading || isDownloadingStamped || isSendingToClaydox || isCameraOpen || !!batchSendProgress;
  const representativeImageData = activeJob && currentImageIndex !== -1 ? activeJob.photos[currentImageIndex] : null;
  const StatusIndicator: React.FC<{ status: PhotoLogJob['submissionStatus'], message?: string }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
    return null;
  };
  
  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">{pageTitle}</h2>
      
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
            onExtractLogFile={handleExtractFromLogFile}
            isExtractLogFileDisabled={isControlsDisabled || activeJob.photos.length === 0}
            onClear={resetActiveJobData} 
            isExtractDisabled={isControlsDisabled || activeJob.photos.length === 0} 
            isClearDisabled={isControlsDisabled || activeJob.photos.length === 0} 
            onDownloadStampedImages={handleDownloadStampedImages}
            isDownloadStampedDisabled={isControlsDisabled || !activeJob || activeJob.photos.length === 0}
            isDownloadingStamped={isDownloadingStamped}
            onInitiateSendToKtl={handleInitiateSendToKtl} 
            isClaydoxDisabled={isControlsDisabled || !activeJob.processedOcrData || activeJob.processedOcrData.length === 0 || activeJob.submissionStatus === 'sending'} 
            isSendingToClaydox={isSendingToClaydox || (activeJob?.submissionStatus === 'sending')}
            ktlApiCallStatus={ocrControlsKtlStatus} 
            onAutoAssignIdentifiers={showAutoAssignIdentifiers ? handleAutoAssignIdentifiers : undefined} 
            isAutoAssignDisabled={isControlsDisabled || !activeJob.processedOcrData || !activeJob.concentrationBoundaries}
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
            availableIdentifiers={availableTnIdentifiers} 
            tnIdentifiers={availableTnIdentifiers} 
            tpIdentifiers={availableTpIdentifiers} 
            rawJsonForCopy={JSON.stringify(activeJob.processedOcrData, null, 2)} 
            ktlJsonToPreview={ktlJsonPreview}
          />
          {showRangeDifferenceDisplay && <RangeDifferenceDisplay results={activeJob.rangeDifferenceResults} />}
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

      {/* FIX: Corrected state setter function name from setKtlPreflightModalOpen to setIsKtlPreflightModalOpen. */}
      {isKtlPreflightModalOpen && ktlPreflightData && ( <KtlPreflightModal isOpen={isKtlPreflightModalOpen} onClose={() => setIsKtlPreflightModalOpen(false)} onConfirm={handleSendToClaydoxConfirmed} preflightData={ktlPreflightData} /> )}
    </div>
  );
};

export default AnalysisPage;
