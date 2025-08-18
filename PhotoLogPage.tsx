import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import {
  RangeDifferenceDisplay,
  RangeResults as DisplayRangeResults,
  RangeStat,
} from './components/RangeDifferenceDisplay';
import { extractTextFromImage } from './services/geminiService';
import {
  sendToClaydoxApi,
  ClaydoxPayload,
  generateKtlJsonForPreview,
} from './services/claydoxApiService';
import JSZip from 'jszip';
import { TN_IDENTIFIERS, TP_IDENTIFIERS } from './shared/constants';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { Type } from '@google/genai';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import {
  generateCompositeImage,
  dataURLtoBlob,
  generateStampedImage,
  CompositeImageInput,
} from './services/imageStampingService';
import { autoAssignIdentifiersByConcentration } from './services/identifierAutomationService';

export interface ExtractedEntry {
  id: string;
  time: string;
  value: string;
  valueTP?: string;
  identifier?: string;
  identifierTP?: string;
  isRuleMatched?: boolean;
}

interface ConcentrationBoundaries {
  overallMin: number;
  overallMax: number;
  span: number;
  boundary1: number;
  boundary2: number;
}

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

export interface PhotoLogJob {
  id: string;
  receiptNumber: string;
  siteLocation: string;
  selectedItem: string;
  photos: ImageInfo[];
  photoComments: Record<string, string>;
  processedOcrData: ExtractedEntry[] | null;
  rangeDifferenceResults: AppRangeResults | null;
  concentrationBoundaries: ConcentrationBoundaries | null;
  decimalPlaces: number;
  details: string;
  decimalPlacesCl?: number;
  ktlJsonPreview: string | null;
  draftJsonPreview: string | null;
  submissionStatus: 'idle' | 'sending' | 'success' | 'error';
  submissionMessage?: string;
}

const TrashIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124"
    />
  </svg>
);

const getNumericValueFromString = (valueStr: string): number | null => {
  const numericValueString = String(valueStr).match(/^-?\d+(\.\d+)?/)?.[0];
  if (!numericValueString) return null;
  const numericValue = parseFloat(numericValueString);
  return isNaN(numericValue) ? null : numericValue;
};

const getConcentrationCategory = (
  valueStr: string,
  boundaries: ConcentrationBoundaries | null
): 'low' | 'medium' | 'high' | 'unknown' => {
  const fullValueStr = String(valueStr).trim();
  const numericValueString = fullValueStr.match(/^-?\d+(\.\d+)?/)?.[0];
  const textPart = numericValueString ? fullValueStr.substring(numericValueString.length).trim() : fullValueStr;

  if (textPart.includes('고')) return 'high';
  if (textPart.includes('중')) return 'medium';
  if (textPart.includes('저')) return 'low';

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
  if (!data || data.length === 0) return null;

  const allNumericValuesForBoundaryCalc: number[] = [];
  data.forEach(entry => {
    const numericValue = getNumericValueFromString(entry.value);
    if (numericValue !== null) allNumericValuesForBoundaryCalc.push(numericValue);
  });

  const uniqueNumericValues = Array.from(new Set(allNumericValuesForBoundaryCalc)).sort((a, b) => a - b);
  if (uniqueNumericValues.length === 0) return null;

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
  } else {
    if (span > 0) {
      b1 = overallMin + span / 3;
      b2 = overallMin + (2 * span) / 3;

      if (b1 >= b2) {
        const N_unique = uniqueNumericValues.length;
        let idx1 = Math.max(0, Math.floor(N_unique / 3) - 1);
        let idx2 = Math.max(idx1 + 1, Math.floor((2 * N_unique) / 3) - 1);
        idx2 = Math.min(N_unique - 2, idx2);
        idx1 = Math.min(idx1, Math.max(0, idx2 - 1));

        if (
          idx1 >= 0 &&
          idx1 < idx2 &&
          idx2 < N_unique &&
          uniqueNumericValues[idx1] < uniqueNumericValues[idx2]
        ) {
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

  if (b1 > b2 && overallMax > overallMin) [b1, b2] = [b2, b1];

  if (uniqueNumericValues.length !== 2) {
    if (b1 === b2 && uniqueNumericValues.length > 1 && overallMin < overallMax) {
      if (b2 < overallMax) {
        const nextValIndex = uniqueNumericValues.findIndex(val => val > b2);
        if (nextValIndex !== -1) b2 = uniqueNumericValues[nextValIndex];
        if (b1 === b2 && b1 > overallMin) {
          let prevValIndex = -1;
          for (let i = uniqueNumericValues.length - 1; i >= 0; i--) {
            if (uniqueNumericValues[i] < b1) {
              prevValIndex = i;
              break;
            }
          }
          if (prevValIndex !== -1) b1 = uniqueNumericValues[prevValIndex];
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
  if (!component) return '';
  return component.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
};

const generateIdentifierSequence = (
  ocrData: ExtractedEntry[] | null,
  currentSelectedItem: string
): string => {
  if (!ocrData) return '';
  let sequence = '';
  const excludedBases = ['현장'];

  const processSingleIdentifier = (idVal: string | undefined): string | null => {
    if (!idVal) return null;
    let base = idVal.replace(/[0-9]/g, '');
    if (base.endsWith('P')) base = base.slice(0, -1);
    if (excludedBases.includes(base)) return null;
    return base.length > 0 ? base : null;
  };

  for (const entry of ocrData) {
    if (currentSelectedItem === 'TN/TP') {
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
  if (typeof valueStr !== 'string' || valueStr.trim() === '') return 0;
  const numericStrMatch = String(valueStr).match(/^-?\d+(\.\d+)?/);
  if (!numericStrMatch || !numericStrMatch[0]) return 0;
  const numericStr = numericStrMatch[0];
  const decimalPart = numericStr.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
};

const calculateMaxDecimalPlaces = (ocrData: ExtractedEntry[] | null, selectedItem: string): number => {
  if (!ocrData || ocrData.length === 0) return 0;
  let maxPlaces = 0;
  ocrData.forEach(entry => {
    const placesValue = countDecimalPlaces(entry.value);
    if (placesValue > maxPlaces) maxPlaces = placesValue;
    if (selectedItem === 'TN/TP' && entry.valueTP) {
      const placesValueTP = countDecimalPlaces(entry.valueTP);
      if (placesValueTP > maxPlaces) maxPlaces = placesValueTP;
    }
  });
  return maxPlaces;
};

interface PhotoLogPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const PhotoLogPage: React.FC<PhotoLogPageProps> = ({
  userName,
  jobs,
  setJobs,
  activeJobId,
  setActiveJobId,
  siteLocation,
  onDeleteJob,
}) => {
  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDownloadingStamped, setIsDownloadingStamped] = useState<boolean>(false);
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

  const updateActiveJob = useCallback(
    (updater: (job: PhotoLogJob) => PhotoLogJob) => {
      if (!activeJobId) return;
      setJobs(prevJobs => prevJobs.map(job => (job.id === activeJobId ? updater(job) : job)));
    },
    [activeJobId, setJobs]
  );

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
    const sanitizedSite = sanitizeFilenameComponent(siteLocation);
    const sanitizedItemName = sanitizeFilenameComponent(
      activeJob.selectedItem === 'TN/TP' ? 'TN_TP' : activeJob.selectedItem
    );
    const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${sanitizedItemName}`;
    return [`${baseName}_composite.jpg`, `${baseName}_Compression.zip`];
  }, [activeJob, siteLocation]);

  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName) return null;
    const identifierSequence = generateIdentifierSequence(
      activeJob.processedOcrData,
      activeJob.selectedItem
    );
    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: siteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      identifierSequence: identifierSequence,
      pageType: 'PhotoLog',
      maxDecimalPlaces: activeJob.decimalPlaces,
    };
    return generateKtlJsonForPreview(
      payload,
      activeJob.selectedItem,
      hypotheticalKtlFileNamesForPreview
    );
  }, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

  /**
   * 🔧 중요한 수정: 계산/업데이트를 하나의 useEffect 안에서만 수행
   * 바깥에서 상태 업데이트를 트리거하지 않습니다(렌더 중 setState 방지).
   */
  useEffect(() => {
    if (!activeJob) return;

    // 데이터가 없으면 관련 상태 리셋
    if (!activeJob.processedOcrData) {
      if (
        activeJob.rangeDifferenceResults !== null ||
        activeJob.concentrationBoundaries !== null ||
        activeJob.decimalPlaces !== 0
      ) {
        updateActiveJob(j => ({
          ...j,
          rangeDifferenceResults: null,
          concentrationBoundaries: null,
          decimalPlaces: 0,
        }));
      }
      return;
    }

    // 계산
    const boundaries = calculateConcentrationBoundariesInternal(activeJob.processedOcrData);
    const newMaxDecimalPlaces = calculateMaxDecimalPlaces(
      activeJob.processedOcrData,
      activeJob.selectedItem
    );

    let newRangeResults: AppRangeResults | null = null;
    if (boundaries) {
      const lowValues: number[] = [];
      const mediumValues: number[] = [];
      const highValues: number[] = [];

      activeJob.processedOcrData.forEach(entry => {
        const category = getConcentrationCategory(entry.value, boundaries);
        const numericVal = getNumericValueFromString(entry.value);
        if (numericVal === null) return;
        if (category === 'low') lowValues.push(numericVal);
        else if (category === 'medium') mediumValues.push(numericVal);
        else if (category === 'high') highValues.push(numericVal);
      });

      const calc = (values: number[]): RangeStat | null => {
        if (values.length < 2) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        return { min, max, diff: max - min };
      };

      newRangeResults = {
        low: calc(lowValues),
        medium: calc(mediumValues),
        high: calc(highValues),
      };
    }

    // 변경된 경우에만 업데이트
    if (
      JSON.stringify(activeJob.concentrationBoundaries) !== JSON.stringify(boundaries) ||
      JSON.stringify(activeJob.rangeDifferenceResults) !== JSON.stringify(newRangeResults) ||
      activeJob.decimalPlaces !== newMaxDecimalPlaces
    ) {
      updateActiveJob(j => ({
        ...j,
        concentrationBoundaries: boundaries,
        rangeDifferenceResults: newRangeResults,
        decimalPlaces: newMaxDecimalPlaces,
      }));
    }
  }, [activeJob, updateActiveJob]);

  const handleImagesSet = useCallback(
    (newlySelectedImages: ImageInfo[]) => {
      if (newlySelectedImages.length === 0 && activeJob?.photos && activeJob.photos.length > 0) return;

      updateActiveJob(job => {
        const existingPhotos = job.photos || [];
        const combined = [...existingPhotos, ...newlySelectedImages];
        const uniqueImageMap = new Map<string, ImageInfo>();
        combined.forEach(img => {
          const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
          if (!uniqueImageMap.has(key)) uniqueImageMap.set(key, img);
        });
        const finalPhotos = Array.from(uniqueImageMap.values());

        if (existingPhotos.length === 0 && finalPhotos.length > 0) {
          setCurrentImageIndex(0);
        }

        return {
          ...job,
          photos: finalPhotos,
          processedOcrData: null,
          rangeDifferenceResults: null,
          submissionStatus: 'idle',
          submissionMessage: undefined,
        };
      });
      setProcessingError(null);
    },
    [activeJob, updateActiveJob]
  );

  const handleOpenCamera = useCallback(() => setIsCameraOpen(true), []);
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleCameraCapture = useCallback(
    (file: File, base64: string, mimeType: string) => {
      const capturedImageInfo: ImageInfo = { file, base64, mimeType };
      updateActiveJob(job => {
        const newPhotos = [...(job.photos || []), capturedImageInfo];
        setCurrentImageIndex(newPhotos.length - 1);
        return {
          ...job,
          photos: newPhotos,
          processedOcrData: null,
          rangeDifferenceResults: null,
          submissionStatus: 'idle',
          submissionMessage: undefined,
        };
      });
      setIsCameraOpen(false);
      setProcessingError(null);
    },
    [updateActiveJob]
  );

  const handleDeleteImage = useCallback(
    (indexToDelete: number) => {
      if (!activeJob || indexToDelete < 0 || indexToDelete >= activeJob.photos.length) return;
      updateActiveJob(job => {
        const newPhotos = job.photos.filter((_, index) => index !== indexToDelete);
        if (newPhotos.length === 0) {
          setCurrentImageIndex(-1);
        } else if (currentImageIndex >= newPhotos.length) {
          setCurrentImageIndex(newPhotos.length - 1);
        } else if (currentImageIndex > indexToDelete) {
          setCurrentImageIndex(prev => prev - 1);
        }
        return {
          ...job,
          photos: newPhotos,
          processedOcrData: null,
          rangeDifferenceResults: null,
          submissionStatus: 'idle',
          submissionMessage: undefined,
        };
      });
      setProcessingError(null);
    },
    [activeJob, currentImageIndex, updateActiveJob]
  );

  const generatePromptForProAnalysis = (receiptNum: string, siteLoc: string, item: string): string => {
    let prompt = `제공된 측정 장비의 이미지를 분석해주세요.
컨텍스트:`;
    if (receiptNum) prompt += `\n- 접수번호: ${receiptNum}`;
    if (siteLoc) prompt += `\n- 현장/위치: ${siteLoc}`;

    if (item === 'TN/TP') {
      prompt += `\n- 항목/파라미터: TN 및 TP. 이미지에서 TN과 TP 각각의 시간 및 값 쌍을 추출해야 합니다.`;
      prompt += `\n- 각 시간(time) 항목에 대해 TN 값은 "value_tn" 키에, TP 값은 "value_tp" 키에 할당해야 합니다.`;
      prompt += `\n\n중요 규칙:\n1.  **두 값 모두 추출:** 같은 시간대에 TN과 TP 값이 모두 표시된 경우, JSON 객체에 "value_tn"과 "value_tp" 키를 **둘 다 포함해야 합니다.**\n    예시: { "time": "...", "value_tn": "1.23", "value_tp": "0.45" }`;
      prompt += `\n2.  **한 값만 있는 경우:** 특정 시간대에 TN 또는 TP 값 중 하나만 명확하게 식별 가능한 경우 (예: 다른 값의 칸이 비어 있거나 '-' 등), 해당 값의 키만 포함하고 다른 키는 **생략**합니다.`;
      prompt += `\n3.  **값 형식:** 모든 값 필드에는 이미지에서 보이는 **순수한 숫자 값만** 포함해야 합니다. 단위/주석은 **모두 제외**하세요.`;
      prompt += `\n\nJSON 출력 형식 예시 (항목: TN/TP):\n[\n  { "time": "2025/04/23 05:00", "value_tn": "46.2", "value_tp": "1.2" },\n  { "time": "2025/04/23 06:00", "value_tn": "5.388", "value_tp": "0.1" },\n  { "time": "2025/05/21 09:38", "value_tn": "89.629" },\n  { "time": "2025/05/21 10:25", "value_tp": "2.5" }\n]`;
    } else {
      prompt += `\n- 항목/파라미터: ${item}. 이 항목의 측정값을 이미지에서 추출해주세요.`;
      prompt += `\n  "value"에는 **숫자만** 포함해야 합니다. 단위/지시자/주석은 제외하세요.`;
      prompt += `\n\nJSON 출력 형식 예시 (항목: ${item}):`;
      if (item === 'TN') {
        prompt += `\n[\n  { "time": "2025/05/21 09:38", "value": "89.629" },\n  { "time": "2025/05/21 10:25", "value": "44.978" },\n  { "time": "2025/05/21 12:46", "value": "6.488" }\n]`;
      } else if (item === 'TP') {
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
1) 전체 응답은 **반드시** 유효한 단일 JSON 배열이어야 합니다(외부 텍스트 금지).
2) JSON 내부/외부에 \`\`\`json\`\`\` 같은 마크다운, 설명, 주석을 넣지 마세요.
3) 각 객체는 정확한 JSON 포맷을 지켜주세요.
4) 지정된 항목을 우선 추출하되 화면에 보이는 모든 Time-값 쌍을 포함하세요.
5) 시간 형식: 가능한 경우 YYYY/MM/DD HH:MM 로 정규화하세요.
6) 값 필드는 숫자만. 단위/주석(저/중/고 등) 제거.
7) TN/TP 모드에선 time + (value_tn/value_tp 중 존재하는 키만) 포함.
8) UI 버튼 텍스트 등 데이터가 아닌 항목은 제외.
9) 해당 사항 없으면 빈 배열([])을 반환.
10) 마커 키(reactors_input 등) 사용 금지.
`;
    return prompt;
  };

  const handleExtractText = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      setProcessingError('먼저 이미지를 선택하거나 촬영해주세요.');
      return;
    }
    setIsLoading(true);
    setProcessingError(null);
    updateActiveJob(j => ({
      ...j,
      processedOcrData: null,
      decimalPlaces: 0,
      submissionStatus: 'idle',
      submissionMessage: undefined,
    }));

    let allRawExtractedEntries: RawEntryUnion[] = [];
    let batchHadError = false;
    let criticalErrorOccurred: string | null = null;

    try {
      if (!import.meta.env.VITE_API_KEY) {
        throw new Error('VITE_API_KEY 환경 변수가 설정되지 않았습니다.');
      }

      const responseSchema =
        activeJob.selectedItem === 'TN/TP'
          ? {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  value_tn: { type: Type.STRING },
                  value_tp: { type: Type.STRING },
                },
                required: ['time'],
              },
            }
          : {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { time: { type: Type.STRING }, value: { type: Type.STRING } },
                required: ['time', 'value'],
              },
            };

      const imageProcessingPromises = activeJob.photos.map(async image => {
        let jsonStr = '';
        try {
          const prompt = generatePromptForProAnalysis(
            activeJob.receiptNumber,
            siteLocation,
            activeJob.selectedItem
          );
          const modelConfig = { responseMimeType: 'application/json', responseSchema };
          jsonStr = await extractTextFromImage(image.base64, image.mimeType, prompt, modelConfig);
          const jsonDataFromImage = JSON.parse(jsonStr) as RawEntryUnion[];
          if (Array.isArray(jsonDataFromImage)) {
            return { status: 'fulfilled', value: jsonDataFromImage as RawEntryUnion[] } as const;
          }
          return {
            status: 'rejected',
            reason: `Image ${image.file.name} did not return a valid JSON array.`,
          } as const;
        } catch (imgErr: any) {
          if (imgErr.message?.includes('API_KEY') || imgErr.message?.includes('Quota exceeded')) {
            criticalErrorOccurred = imgErr.message;
          }
          const reason =
            imgErr instanceof SyntaxError
              ? `JSON parsing failed: ${imgErr.message}. AI response: ${jsonStr}`
              : imgErr.message;
          return { status: 'rejected', reason } as const;
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
            if (activeJob.selectedItem === 'TN/TP') {
              const existingTnTp = existing as RawEntryTnTp;
              const currentTnTp = entry as RawEntryTnTp;
              if (currentTnTp.value_tn && !existingTnTp.value_tn)
                existingTnTp.value_tn = currentTnTp.value_tn;
              if (currentTnTp.value_tp && !existingTnTp.value_tp)
                existingTnTp.value_tp = currentTnTp.value_tp;
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
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((rawEntry: RawEntryUnion) => {
            let primaryValue = '';
            let tpValue: string | undefined = undefined;
            if (activeJob.selectedItem === 'TN/TP') {
              const tnTpEntry = rawEntry as RawEntryTnTp;
              primaryValue = tnTpEntry.value_tn || '';
              tpValue = tnTpEntry.value_tp;
            } else {
              primaryValue = (rawEntry as RawEntrySingle).value || '';
            }
            return {
              id: self.crypto.randomUUID(),
              time: (rawEntry as RawEntryBase).time,
              value: primaryValue,
              valueTP: tpValue,
            } as ExtractedEntry;
          });

        updateActiveJob(j => ({ ...j, processedOcrData: finalOcrData }));
        if (batchHadError) setProcessingError('일부 이미지를 처리하지 못했습니다.');
      } else {
        setProcessingError('AI가 이미지에서 유효한 데이터를 추출하지 못했습니다.');
      }
    } catch (e: any) {
      setProcessingError(e.message || '데이터 추출 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [activeJob, siteLocation, updateActiveJob]);

  const handleEntryChange = useCallback(
    (entryId: string, field: keyof ExtractedEntry, value: string | undefined) => {
      updateActiveJob(job => {
        if (!job.processedOcrData) return job;
        const updatedData = job.processedOcrData.map(entry =>
          entry.id === entryId ? { ...entry, [field]: value } : entry
        );
        return {
          ...job,
          processedOcrData: updatedData,
          submissionStatus: 'idle',
          submissionMessage: undefined,
        };
      });
    },
    [updateActiveJob]
  );

  const handleAddEntry = useCallback(() => {
    updateActiveJob(job => {
      if (!job) return job;
      const newEntry: ExtractedEntry = {
        id: self.crypto.randomUUID(),
        time: '',
        value: '',
        valueTP: job.selectedItem === 'TN/TP' ? '' : undefined,
      };
      const updatedData = [...(job.processedOcrData || []), newEntry];
      return {
        ...job,
        processedOcrData: updatedData,
        submissionStatus: 'idle',
        submissionMessage: undefined,
      };
    });
  }, [updateActiveJob]);

  const handleReorderRows = useCallback(
    (sourceRowStr: string, targetRowStr?: string) => {
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
    },
    [activeJob, updateActiveJob]
  );

  const handleAutoAssignIdentifiers = useCallback(() => {
    if (!activeJob || !activeJob.processedOcrData || !activeJob.concentrationBoundaries) {
      setProcessingError('자동 할당을 위해선 추출된 데이터와 농도 분석이 필요합니다.');
      return;
    }

    const isTpMode = activeJob.selectedItem === 'TN/TP';
    const assignments = autoAssignIdentifiersByConcentration(
      activeJob.processedOcrData,
      activeJob.concentrationBoundaries,
      isTpMode
    );

    const updatedOcrData = activeJob.processedOcrData.map((entry, index) => {
      const assignment = assignments[index];
      const newIdentifier = assignment.tn !== undefined ? assignment.tn : entry.identifier;
      const newIdentifierTP = assignment.tp !== undefined ? assignment.tp : entry.identifierTP;

      return {
        ...entry,
        identifier: newIdentifier,
        identifierTP: isTpMode ? newIdentifierTP : undefined,
      };
    });

    updateActiveJob(j => ({
      ...j,
      processedOcrData: updatedOcrData,
      submissionStatus: 'idle',
      submissionMessage: undefined,
    }));
    setProcessingError(null);
  }, [activeJob, updateActiveJob]);

  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !ktlJsonPreview) {
      alert('KTL 전송을 위한 모든 조건(작업 선택, 데이터, 사진, 필수정보)이 충족되지 않았습니다.');
      return;
    }
    setKtlPreflightData({
      jsonPayload: ktlJsonPreview,
      fileNames: hypotheticalKtlFileNamesForPreview,
      context: {
        receiptNumber: activeJob.receiptNumber,
        siteLocation: siteLocation,
        selectedItem: activeJob.selectedItem,
        userName,
      },
    });
    setKtlPreflightModalOpen(true);
  }, [activeJob, userName, siteLocation, ktlJsonPreview, hypotheticalKtlFileNamesForPreview]);

  const handleSendToClaydoxConfirmed = useCallback(async () => {
    setKtlPreflightModalOpen(false);
    if (!activeJob || !activeJob.processedOcrData || !userName || activeJob.photos.length === 0) {
      updateActiveJob(j => ({
        ...j,
        submissionStatus: 'error',
        submissionMessage: 'KTL 전송을 위한 필수 데이터가 누락되었습니다.',
      }));
      return;
    }
    updateActiveJob(j => ({ ...j, submissionStatus: 'sending', submissionMessage: '전송 중...' }));

    try {
      const identifierSequence = generateIdentifierSequence(
        activeJob.processedOcrData,
        activeJob.selectedItem
      );
      const payload: ClaydoxPayload = {
        receiptNumber: activeJob.receiptNumber,
        siteLocation,
        item: activeJob.selectedItem,
        updateUser: userName,
        ocrData: activeJob.processedOcrData,
        identifierSequence,
        maxDecimalPlaces: activeJob.decimalPlaces,
        pageType: 'PhotoLog',
      };

      const sanitizedSite = sanitizeFilenameComponent(siteLocation);
      const sanitizedItemName = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
      const baseName = `${activeJob.receiptNumber}_${sanitizedSite}_${sanitizedItemName}`;

      const imagesForComposite: CompositeImageInput[] = activeJob.photos.map(p => ({
        base64: p.base64,
        mimeType: p.mimeType,
        comment: activeJob.photoComments[p.file.name],
      }));
      const compositeDataUrl = await generateCompositeImage(
        imagesForComposite,
        { receiptNumber: activeJob.receiptNumber, siteLocation, item: activeJob.selectedItem },
        'image/jpeg'
      );

      const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}_composite.jpg`, {
        type: 'image/jpeg',
      });

      const zip = new JSZip();
      for (let i = 0; i < activeJob.photos.length; i++) {
        const imageInfo = activeJob.photos[i];
        const stampedDataUrl = await generateStampedImage(
          imageInfo.base64,
          imageInfo.mimeType,
          activeJob.receiptNumber,
          siteLocation,
          '',
          activeJob.selectedItem,
          activeJob.photoComments[imageInfo.file.name]
        );
        zip.file(`${baseName}_${i + 1}.png`, dataURLtoBlob(stampedDataUrl));
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });

      const response = await sendToClaydoxApi(
        payload,
        [compositeFile, zipFile],
        activeJob.selectedItem,
        [compositeFile.name, zipFile.name]
      );
      updateActiveJob(j => ({ ...j, submissionStatus: 'success', submissionMessage: response.message }));
    } catch (error: any) {
      updateActiveJob(j => ({
        ...j,
        submissionStatus: 'error',
        submissionMessage: `KTL 전송 실패: ${error.message}`,
      }));
    }
  }, [activeJob, siteLocation, userName, updateActiveJob]);

  const handleBatchSendToKtl = async () => {
    const jobsToSend = jobs.filter(j => j.processedOcrData && j.processedOcrData.length > 0 && j.photos.length > 0);
    if (jobsToSend.length === 0) {
      alert('전송할 데이터가 있는 작업이 없습니다. 각 작업에 사진과 추출된 데이터가 있는지 확인하세요.');
      return;
    }

    setIsSendingToClaydox(true);
    setBatchSendProgress(`(0/${jobsToSend.length}) 작업 처리 시작...`);
    setJobs(prev =>
      prev.map(j =>
        jobsToSend.find(jts => jts.id === j.id)
          ? { ...j, submissionStatus: 'sending', submissionMessage: '대기 중...' }
          : j
      )
    );

    for (let i = 0; i < jobsToSend.length; i++) {
      const job = jobsToSend[i];
      setBatchSendProgress(`(${i + 1}/${jobsToSend.length}) '${job.receiptNumber}' 전송 중...`);
      setJobs(prev =>
        prev.map(j => (j.id === job.id ? { ...j, submissionMessage: '파일 생성 및 전송 중...' } : j))
      );

      try {
        const identifierSequence = generateIdentifierSequence(job.processedOcrData, job.selectedItem);
        const payload: ClaydoxPayload = {
          receiptNumber: job.receiptNumber,
          siteLocation,
          item: job.selectedItem,
          updateUser: userName,
          ocrData: job.processedOcrData!,
          identifierSequence,
          maxDecimalPlaces: job.decimalPlaces,
          pageType: 'PhotoLog',
        };

        const sanitizedSite = sanitizeFilenameComponent(siteLocation);
        const sanitizedItemName = sanitizeFilenameComponent(job.selectedItem.replace('/', '_'));
        const baseName = `${job.receiptNumber}_${sanitizedSite}_${sanitizedItemName}`;

        const imagesForComposite: CompositeImageInput[] = job.photos.map(p => ({
          base64: p.base64,
          mimeType: p.mimeType,
          comment: job.photoComments[p.file.name],
        }));
        const compositeDataUrl = await generateCompositeImage(
          imagesForComposite,
          { receiptNumber: job.receiptNumber, siteLocation, item: job.selectedItem },
          'image/jpeg'
        );

        const compositeFile = new File([dataURLtoBlob(compositeDataUrl)], `${baseName}_composite.jpg`, {
          type: 'image/jpeg',
        });

        const zip = new JSZip();
        for (const imageInfo of job.photos) {
          const stampedDataUrl = await generateStampedImage(
            imageInfo.base64,
            imageInfo.mimeType,
            job.receiptNumber,
            siteLocation,
            '',
            job.selectedItem,
            job.photoComments[imageInfo.file.name]
          );
          zip.file(`${baseName}_${sanitizeFilenameComponent(imageInfo.file.name)}.png`, dataURLtoBlob(stampedDataUrl));
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipBlob], `${baseName}_Compression.zip`, { type: 'application/zip' });

        const response = await sendToClaydoxApi(
          payload,
          [compositeFile, zipFile],
          job.selectedItem,
          [compositeFile.name, zipFile.name]
        );
        setJobs(prev =>
          prev.map(j =>
            j.id === job.id
              ? { ...j, submissionStatus: 'success', submissionMessage: response.message || '전송 성공' }
              : j
          )
        );
      } catch (error: any) {
        setJobs(prev =>
          prev.map(j =>
            j.id === job.id
              ? { ...j, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}` }
              : j
          )
        );
      }
    }

    setBatchSendProgress('일괄 전송 완료.');
    setIsSendingToClaydox(false);
    setTimeout(() => setBatchSendProgress(null), 5000);
  };

  const handleDownloadStampedImages = useCallback(async () => {
    if (!activeJob || activeJob.photos.length === 0) {
      alert('다운로드할 이미지가 없습니다.');
      return;
    }
    setIsDownloadingStamped(true);
    try {
      const zip = new JSZip();
      const sanitizedReceipt = sanitizeFilenameComponent(activeJob.receiptNumber);
      const sanitizedSite = sanitizeFilenameComponent(siteLocation);
      const sanitizedItem = sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'));
      const baseName = `${sanitizedReceipt}_${sanitizedSite}_${sanitizedItem}`;

      for (let i = 0; i < activeJob.photos.length; i++) {
        const imageInfo = activeJob.photos[i];
        const comment = activeJob.photoComments[imageInfo.file.name];
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
      console.error('Error creating stamped image zip:', error);
      alert(
        `스탬프 이미지 ZIP 파일 생성 중 오류가 발생했습니다: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsDownloadingStamped(false);
    }
  }, [activeJob, siteLocation]);

  const isControlsDisabled =
    isLoading || isDownloadingStamped || isSendingToClaydox || isCameraOpen || !!batchSendProgress;

  const representativeImageData =
    activeJob && currentImageIndex !== -1 ? activeJob.photos[currentImageIndex] : null;

  const StatusIndicator: React.FC<{
    status: PhotoLogJob['submissionStatus'];
    message?: string;
  }> = ({ status, message }) => {
    if (status === 'idle' || !message) return null;
    if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
    if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
    if (status === 'error')
      return (
        <span className="text-xs text-red-400" title={message}>
          ❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}
        </span>
      );
    return null;
  };

  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">수질 분석 (P1)</h2>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div
                key={job.id}
                className={`p-2.5 rounded-md transition-all ${
                  activeJobId === job.id
                    ? 'bg-sky-600 shadow-md ring-2 ring-sky-400'
                    : 'bg-slate-600 hover:bg-slate-500'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex-grow cursor-pointer" onClick={() => setActiveJobId(job.id)}>
                    <span
                      className={`text-sm font-medium ${
                        activeJobId === job.id ? 'text-white' : 'text-slate-200'
                      }`}
                    >
                      {job.receiptNumber} / {job.selectedItem}
                    </span>
                  </div>
                  <button
                    onClick={e => {
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

      {!activeJob && jobs.length > 0 && (
        <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>
      )}
      {!activeJob && jobs.length === 0 && (
        <p className="text-center text-slate-400 p-4">
          시작하려면 '공통 정보 및 작업 관리' 섹션에서 작업을 추가하세요.
        </p>
      )}

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
            onDownloadStampedImages={handleDownloadStampedImages}
            isDownloadStampedDisabled={isControlsDisabled || !activeJob || activeJob.photos.length === 0}
            isDownloadingStamped={isDownloadingStamped}
            onInitiateSendToKtl={handleInitiateSendToKtl}
            isClaydoxDisabled={
              isControlsDisabled ||
              !activeJob.processedOcrData ||
              activeJob.processedOcrData.length === 0 ||
              activeJob.submissionStatus === 'sending'
            }
            isSendingToClaydox={isSendingToClaydox || activeJob?.submissionStatus === 'sending'}
            ktlApiCallStatus={ocrControlsKtlStatus}
            onAutoAssignIdentifiers={handleAutoAssignIdentifiers}
            isAutoAssignDisabled={
              isControlsDisabled || !activeJob.processedOcrData || !activeJob.concentrationBoundaries
            }
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

          <RangeDifferenceDisplay results={activeJob.rangeDifferenceResults} />
        </div>
      )}

      {jobs.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
          <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
          <p className="text-sm text-slate-400">
            이 페이지의 모든 유효한 작업(사진 및 데이터가 있는)을 KTL로 전송합니다. 안정적인 Wi-Fi
            환경에서 실행하는 것을 권장합니다.
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
              : `이 페이지의 모든 작업 전송 (${
                  jobs.filter(j => j.processedOcrData && j.photos.length > 0).length
                }건)`}
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

export default PhotoLogPage;
