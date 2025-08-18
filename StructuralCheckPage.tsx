import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import html2canvas from 'html2canvas';
import {
  MAIN_STRUCTURAL_ITEMS,
  CHECKLIST_DEFINITIONS,
  MainStructuralItemKey,
  ChecklistStatus,
  MEASUREMENT_METHOD_OPTIONS,
  MEASUREMENT_RANGE_OPTIONS,
  ANALYSIS_IMPOSSIBLE_OPTION,
  OTHER_DIRECT_INPUT_OPTION,
  CertificateDetails,
  StructuralCheckSubItemData,
  POST_INSPECTION_DATE_OPTIONS,
  EMISSION_STANDARD_ITEM_NAME,
  RESPONSE_TIME_ITEM_NAME,
  PREFERRED_MEASUREMENT_METHODS,
} from './shared/structuralChecklists';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ChecklistItemRow } from './components/structural/ChecklistItemRow';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { sendBatchStructuralChecksToKtlApi, generateStructuralKtlJsonForPreview, generateCompositeImageNameForKtl, generateZipFileNameForKtl } from './services/claydoxApiService';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ImagePreview } from './components/ImagePreview';
import { extractTextFromImage } from './services/geminiService';
import type { GenerateContentParameters } from "@google/genai";
import { Type } from '@google/genai';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { ChecklistSnapshot } from './components/structural/ChecklistSnapshot';


export interface JobPhoto extends ImageInfo {
  uid: string;
}

export interface StructuralJob {
  id: string;
  receiptNumber: string;
  mainItemKey: MainStructuralItemKey;
  checklistData: Record<string, StructuralCheckSubItemData>;
  photos: JobPhoto[];
  photoComments: Record<string, string>;
  postInspectionDate: string; 
  postInspectionDateConfirmedAt: string | null;
  submissionStatus: 'idle' | 'sending' | 'success' | 'error';
  submissionMessage?: string;
}

interface QuickAnalysisFeedback {
  targetItemName: AnalysisType;
  message: string;
  type: 'success' | 'error';
}

export type AnalysisType = "측정범위확인" | "측정방법확인" | "표시사항확인" | "운용프로그램확인" | "정도검사 증명서" | "지시부 번호" | "센서부 번호";
type AnalysisStatusForPhotos = Record<string, Record<number, Set<AnalysisType>>>;
type AnalyzedTypesForJob = Record<string, Set<AnalysisType>>;

const TrashIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
    </svg>
);

const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return '';
  return component.replace(/[^\w\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\-]+/g, '_').replace(/__+/g, '_');
};


const getCurrentTimestamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

interface StructuralCheckPageProps {
  userName: string;
  jobs: StructuralJob[];
  setJobs: React.Dispatch<React.SetStateAction<StructuralJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const StructuralCheckPage: React.FC<StructuralCheckPageProps> = ({ userName, jobs, setJobs, activeJobId, setActiveJobId, siteLocation, onDeleteJob }) => {
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const activeJobFileInputRef = useRef<HTMLInputElement>(null);
  const [currentPhotoIndexOfActiveJob, setCurrentPhotoIndexOfActiveJob] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false); 
  const [isKtlPreflightModalOpen, setKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [isAnalyzingDetail, setIsAnalyzingDetail] = useState<boolean>(false); 
  const [detailAnalysisError, setDetailAnalysisError] = useState<string | null>(null);
  const [quickAnalysisTarget, setQuickAnalysisTarget] = useState<AnalysisType | null>(null);
  const [quickAnalysisFeedback, setQuickAnalysisFeedback] = useState<QuickAnalysisFeedback | null>(null);
  const [analysisStatusForPhotos, setAnalysisStatusForPhotos] = useState<AnalysisStatusForPhotos>({});
  const [analyzedTypesForJob, setAnalyzedTypesForJob] = useState<AnalyzedTypesForJob>({});
  const [isRenderingChecklist, setIsRenderingChecklist] = useState(false);
  const [batchSendProgress, setBatchSendProgress] = useState<string | null>(null);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [jobForSnapshot, setJobForSnapshot] = useState<StructuralJob | null>(null);

  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const getAnalysisTypeDisplayString = useCallback((analysisType: AnalysisType): string => {
    const mainItemKey = activeJob?.mainItemKey;
    switch (analysisType) {
        case "측정방법확인": return "방법";
        case "측정범위확인": return "범위";
        case "표시사항확인": return "표시사항";
        case "운용프로그램확인":
            if (mainItemKey === 'TU' || mainItemKey === 'Cl') {
                return "버전 (해당 없음)";
            }
            return "버전";
        case "정도검사 증명서": return "증명서 정보";
        case "지시부 번호": return "지시부 번호";
        case "센서부 번호": return "센서부 번호";
        default: return "항목";
    }
  }, [activeJob]);

  const comparisonNoteForActiveJob = useMemo<string | null>(() => {
    if (!activeJob) return null;

    const markingCheckData = activeJob.checklistData["표시사항확인"];
    const certificateData = activeJob.checklistData["정도검사 증명서"];

    if (!markingCheckData?.notes || !certificateData?.notes) return null;

    let markingDetails: Record<string, string> | null = null;
    try {
        const parsed = JSON.parse(markingCheckData.notes);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            markingDetails = {};
            for (const key in parsed) {
                if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                    markingDetails[key] = String(parsed[key]);
                }
            }
        }
    } catch (e) { /* silent fail */ }

    let certDetails: CertificateDetails | null = null;
    try {
        const parsed = JSON.parse(certificateData.notes);
        if (typeof parsed === 'object' && parsed !== null) certDetails = parsed as CertificateDetails;
    } catch (e) { /* silent fail */ }

    if (!markingDetails || !certDetails || certDetails.presence !== 'present') {
        return null;
    }

    const norm = (s: string | undefined) => (s || '').toLowerCase().replace(/\s+/g, '').replace(/제|호/g, '');

    const messages: string[] = [];
    let allMatch = true;
    let anyComparisonMade = false;

    const markingManufacturerVal = markingDetails['제조회사'];
    const certManufacturerVal = certDetails.manufacturer;
    if (markingManufacturerVal || certManufacturerVal) {
      anyComparisonMade = true;
      if (norm(markingManufacturerVal) !== norm(certManufacturerVal)) {
        messages.push(`제조사 (표시사항: "${markingManufacturerVal || '없음'}" vs 증명서: "${certManufacturerVal || '없음'}")`);
        allMatch = false;
      }
    }

    const markingTypeApprovalVal = markingDetails['형식승인번호'];
    const certTypeApprovalVal = certDetails.typeApprovalNumber;
     if (markingTypeApprovalVal || certTypeApprovalVal) {
      anyComparisonMade = true;
      if (norm(markingTypeApprovalVal) !== norm(certTypeApprovalVal)) {
        messages.push(`형식승인번호 (표시사항: "${markingTypeApprovalVal || '없음'}" vs 증명서: "${certTypeApprovalVal || '없음'}")`);
        allMatch = false;
      }
    }

    const markingSerialVal = markingDetails['기기고유번호'];
    const certSerialVal = certDetails.serialNumber;
    if (markingSerialVal || certSerialVal) {
      anyComparisonMade = true;
      if (norm(markingSerialVal) !== norm(certSerialVal)) {
        messages.push(`기기/제작번호 (표시사항: "${markingSerialVal || '없음'}" vs 증명서: "${certSerialVal || '없음'}")`);
        allMatch = false;
      }
    }

    if (!anyComparisonMade) return null;

    if (allMatch) {
        return "(참고) 표시사항과 증명서 정보가 일치합니다.";
    } else {
        return `(주의) 표시사항과 증명서 정보가 다릅니다:\n- ${messages.join('\n- ')}\n내용을 확인하세요.`;
    }
}, [activeJob]);

  const updateActiveJob = useCallback((updater: (job: StructuralJob) => StructuralJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);
  
  const resetActiveJobSubmissionStatus = useCallback(() => {
    if (!activeJobId) return;
    updateActiveJob(job => ({
        ...job,
        submissionStatus: 'idle',
        submissionMessage: undefined,
    }));
  }, [activeJobId, updateActiveJob]);

  useEffect(() => {
    setAnalyzedTypesForJob(prev => {
        const currentJobIds = new Set(jobs.map(j => j.id));
        const newState: AnalyzedTypesForJob = {};
        for (const jobId in prev) {
            if (currentJobIds.has(jobId)) {
                newState[jobId] = prev[jobId];
            }
        }
        return newState;
    });
  }, [jobs]);

  useEffect(() => {
    if (activeJob && activeJob.photos.length > 0) {
      if (currentPhotoIndexOfActiveJob === -1 || currentPhotoIndexOfActiveJob >= activeJob.photos.length) {
         setCurrentPhotoIndexOfActiveJob(0);
      }
    } else {
      setCurrentPhotoIndexOfActiveJob(-1);
    }
    if (quickAnalysisTarget === null) {
        setQuickAnalysisFeedback(null);
    }
  }, [activeJob, currentPhotoIndexOfActiveJob, quickAnalysisTarget]);

  const handleOpenCamera = useCallback(() => {
    if (!activeJobId) { alert('먼저 사진을 추가할 작업을 선택해주세요.'); return; }
    setIsCameraOpen(true);
    resetActiveJobSubmissionStatus();
    setQuickAnalysisFeedback(null);
  }, [activeJobId, resetActiveJobSubmissionStatus]);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    const capturedImageInfo: JobPhoto = { file, base64, mimeType, uid: self.crypto.randomUUID() };
    updateActiveJob(job => {
        const newPhotos = [...job.photos, capturedImageInfo];
        setCurrentPhotoIndexOfActiveJob(newPhotos.length - 1);
        return { ...job, photos: newPhotos, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setAnalysisStatusForPhotos(prev => ({...prev, [activeJobId!]: {}}));
    setIsCameraOpen(false);
  }, [activeJobId, updateActiveJob]);
  
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);

  const handleActiveJobPhotosSet = useCallback((images: ImageInfo[]) => {
    if (!activeJobId || images.length === 0) return;
    const photosWithId: JobPhoto[] = images.map(img => ({...img, uid: self.crypto.randomUUID()}));
    updateActiveJob(job => {
        const combined = [...job.photos, ...photosWithId];
        const unique = Array.from(new Map(combined.map(p => [`${p.file.name}-${p.file.size}`, p])).values());
        if(job.photos.length === 0) setCurrentPhotoIndexOfActiveJob(0);
        return {...job, photos: unique, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setAnalysisStatusForPhotos(prev => ({...prev, [activeJobId!]: {}}));
    setQuickAnalysisFeedback(null);
  }, [activeJobId, updateActiveJob]);

  const handleDeleteActiveJobImage = useCallback((indexToDelete: number) => {
    if (!activeJob || indexToDelete < 0 || indexToDelete >= activeJob.photos.length) return;
    const deletedPhotoUid = activeJob.photos[indexToDelete].uid;
    updateActiveJob(job => {
        const newPhotos = job.photos.filter((_, i) => i !== indexToDelete);
        const newComments = {...job.photoComments};
        delete newComments[deletedPhotoUid];
        if (newPhotos.length === 0) setCurrentPhotoIndexOfActiveJob(-1);
        else if (currentPhotoIndexOfActiveJob >= newPhotos.length) setCurrentPhotoIndexOfActiveJob(newPhotos.length - 1);
        else if (currentPhotoIndexOfActiveJob > indexToDelete) setCurrentPhotoIndexOfActiveJob(p => p - 1);
        return { ...job, photos: newPhotos, photoComments: newComments, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setAnalysisStatusForPhotos(prev => ({...prev, [activeJobId!]: {}}));
  }, [activeJob, activeJobId, currentPhotoIndexOfActiveJob, updateActiveJob]);
  
  const handleChecklistItemChange = (itemName: string, field: 'status' | 'notes' | 'specialNotes', value: ChecklistStatus | string) => {
    if (!activeJobId) return;
    updateActiveJob(job => {
      const updatedItemData = { ...job.checklistData[itemName] };
      if (field === 'status') {
        const newStatus = value as ChecklistStatus;
        updatedItemData.status = newStatus;
        if (newStatus !== '선택 안됨') updatedItemData.confirmedAt = getCurrentTimestamp();
        if (job.mainItemKey === 'TU' && itemName === '세척 기능') {
          updatedItemData.specialNotes = newStatus === '적합' ? '있음' : newStatus === '부적합' ? '없음' : '';
        }
      } else {
        updatedItemData[field] = value as string;
      }
      return { ...job, checklistData: { ...job.checklistData, [itemName]: updatedItemData }, submissionStatus: 'idle', submissionMessage: undefined };
    });
  };

  const handlePhotoCommentChange = useCallback((photoUid: string, comment: string) => {
    updateActiveJob(job => ({...job, photoComments: { ...job.photoComments, [photoUid]: comment }, submissionStatus: 'idle', submissionMessage: undefined }));
  }, [updateActiveJob]);

  const handlePostInspectionDateChange = (newDateValue: string) => {
    updateActiveJob(job => ({ ...job, postInspectionDate: newDateValue, postInspectionDateConfirmedAt: newDateValue === POST_INSPECTION_DATE_OPTIONS[0] ? null : getCurrentTimestamp(), submissionStatus: 'idle', submissionMessage: undefined }));
  };
  
  const handleSetAllSuitableForActiveJob = useCallback(() => {
    if (!activeJob) return;
    const timestamp = getCurrentTimestamp();
    updateActiveJob(job => {
      const updatedChecklistData = { ...job.checklistData };
      const itemsForThisJobType = CHECKLIST_DEFINITIONS[job.mainItemKey];

      itemsForThisJobType.forEach(itemName => {
        if (job.mainItemKey !== 'TOC' || (itemName !== EMISSION_STANDARD_ITEM_NAME && itemName !== RESPONSE_TIME_ITEM_NAME)) {
          updatedChecklistData[itemName] = { 
            ...(job.checklistData[itemName] || {}), // Ensure object exists
            status: '적합', 
            confirmedAt: timestamp 
          };
          if (job.mainItemKey === 'TU' && itemName === '세척 기능') {
            updatedChecklistData[itemName].specialNotes = '있음';
          }
        }
      });
      return { ...job, checklistData: updatedChecklistData, submissionStatus: 'idle', submissionMessage: undefined };
    });
    setQuickAnalysisFeedback(null);
  }, [activeJob, updateActiveJob]);
  
  const handleAnalyzeChecklistItemDetail = useCallback(async (itemNameForAnalysis: AnalysisType, isQuickAnalysis: boolean = false) => {
    if (!activeJob || activeJob.photos.length === 0) {
        const errorMsg = "판별을 위해 사진을 먼저 첨부하세요.";
        if (isQuickAnalysis) setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: errorMsg, type: 'error' });
        else setDetailAnalysisError(errorMsg);
        return;
    }
    const photoToProcess = isQuickAnalysis ? activeJob.photos[currentPhotoIndexOfActiveJob] : activeJob.photos[0];
    if (!photoToProcess) return;

    if (isQuickAnalysis) { setQuickAnalysisTarget(itemNameForAnalysis); setQuickAnalysisFeedback(null); }
    setIsAnalyzingDetail(true); setDetailAnalysisError(null);

    let prompt = "";
    let modelConfig: GenerateContentParameters['config'] | undefined;
    let targetChecklistItem = itemNameForAnalysis as string;
    let autoComment = '';

    const mainItemName = MAIN_STRUCTURAL_ITEMS.find(i => i.key === activeJob.mainItemKey)?.name || activeJob.mainItemKey;
    
    switch (itemNameForAnalysis) {
      case "정도검사 증명서":
        autoComment = "정도검사 증명서";
        const currentYear = new Date().getFullYear();
        const twoDigitYear = currentYear % 100;
        const yearPrefixes = Array.from({ length: 5 }, (_, i) => `${twoDigitYear - i}-`).join("', '");

        prompt = `
You are a highly precise data extraction assistant specializing in official Korean '정도검사 증명서' (Certificate of Inspection).
From the provided image of the certificate for a "${mainItemName}" device, extract ALL of the following fields. If a field is not visible, use an empty string "" as its value. DO NOT OMIT ANY FIELDS from the JSON structure.

- productName: The product name or model (품명/모델명).
- manufacturer: The manufacturer (제작사).
- serialNumber: The serial number (제작번호/기기번호).
- typeApprovalNumber: The type approval number (형식승인번호).
- inspectionDate: The date the inspection was conducted (검사일자).
- validity: The expiration date of the certificate (유효기간).
- previousReceiptNumber: The main certificate ID number, often labeled '제...호'. Extract ONLY the core number string (e.g., from '제21-018279-02-77호', extract '21-018279-02-77'). Follow this specific logic:
  1. The current year is ${currentYear}. Your primary goal is to find the most recent receipt number. Search for numbers starting with two-digit year prefixes in this descending order of priority: '${yearPrefixes}'.
  2. If you find numbers starting with multiple prefixes (e.g., '25-' and '24-'), you MUST choose and extract the one with the highest priority prefix (in this case, '25-').
  3. If you do not find any number matching these year-prefix patterns, then and only then should you extract any other identifiable main certificate number you can find on the document.

CRITICAL INSTRUCTIONS:
1. Date Format: Both 'inspectionDate' and 'validity' MUST be in YYYY-MM-DD format. Convert any other date format you find (e.g., YYYY.MM.DD or YYYY년 MM월 DD일) to this exact format.
2. Type Approval Number Format: The 'typeApprovalNumber' must start with '제' and end with '호'. For example, if the certificate shows 'WTMS-CODmn-2022-2', you must return '제WTMS-CODmn-2022-2호'.
3. Complete JSON: The final output must be a single, complete JSON object containing all the fields listed above. Do not omit any keys.

Respond ONLY with the JSON object. Do not include any other text, explanations, or markdown formatting.
`;
        modelConfig = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING, description: "품명 또는 모델명" },
              manufacturer: { type: Type.STRING, description: "제작사" },
              serialNumber: { type: Type.STRING, description: "제작번호 또는 기기번호" },
              typeApprovalNumber: { type: Type.STRING, description: "The type approval number (형식승인번호). CRITICAL: Ensure the final value starts with '제' and ends with '호'." },
              inspectionDate: { type: Type.STRING, description: "검사일자. CRITICAL: Format as YYYY-MM-DD." },
              validity: { type: Type.STRING, description: "유효기간. CRITICAL: Format as YYYY-MM-DD." },
              previousReceiptNumber: { type: Type.STRING, description: "직전 접수번호 (핵심 번호만)" },
            },
            required: ["productName", "manufacturer", "serialNumber", "typeApprovalNumber", "inspectionDate", "validity", "previousReceiptNumber"],
          },
        };
        break;

      case "표시사항확인":
        autoComment = "표시사항";
        let itemSpecificHint = '';
        const key = activeJob.mainItemKey;

        if (key === 'Cl') {
            itemSpecificHint = `CRITICAL HINT: The device may have multiple labels. You MUST find the specific '형식승인표' for 잔류염소 (Chlorine). The correct '형식승인번호' for this item will contain 'CM' or 'MULTI' (case-insensitive). Prioritize labels containing these identifiers. Ignore labels with 'TM' unless no 'CM' or 'MULTI' label is found.`;
        } else if (key === 'TU') {
            itemSpecificHint = `CRITICAL HINT: The device may have multiple labels. You MUST find the specific '형식승인표' for 탁도 (Turbidity). The correct '형식승인번호' for this item will contain 'TM' or 'MULTI' (case-insensitive). Prioritize labels containing these identifiers. Ignore labels with 'CM' unless no 'TM' or 'MULTI' label is found.`;
        } else if (key === 'TN' || key === 'TP') {
            itemSpecificHint = `CRITICAL HINT: The device may have multiple labels. You MUST find the specific '형식승인표' for ${mainItemName}. The correct '형식승인번호' for this item will often contain '${key}' or 'MULTI' (case-insensitive). Prioritize labels containing these identifiers.`;
        }
        
        prompt = `
You are a highly precise data extraction assistant specializing in Korean equipment labels.
From the provided image, find the '형식승인표' (Type Approval Label) for the "${mainItemName}" device.
${itemSpecificHint}

Carefully extract ALL of the following fields. If a field is not visible, use an empty string "" as its value. DO NOT OMIT ANY FIELDS from the JSON structure.

- 제조회사 (Manufacturer)
- 기기형식 (Model Type)
- 형식승인번호 (Type Approval Number)
- 형식승인일 (Type Approval Date)
- 기기고유번호 (Serial Number / S/N)

CRITICAL INSTRUCTIONS:
1. Date Format: The '형식승인일' MUST be in YYYY-MM-DD format. Convert any other date format you find (e.g., YYYY.MM.DD or YYYY년 MM월 DD일) to this exact format.
2. Type Approval Number Format: The '형식승인번호' must start with '제' and end with '호'. For example, if the label shows 'WTMS-TN-2017-4', you must return '제WTMS-TN-2017-4호'.
3. Complete JSON: The final output must be a single, complete JSON object containing all the fields listed above. Do not omit any keys.

Respond ONLY with the JSON object. Do not include any other text, explanations, or markdown formatting.
`;
        modelConfig = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              "제조회사": { type: Type.STRING, description: "The manufacturer of the device (e.g., (주)에이치코비)." },
              "기기형식": { type: Type.STRING, description: "The model name or type of the device (e.g., HATN-4000)." },
              "형식승인번호": { type: Type.STRING, description: "The type approval number. CRITICAL: Format it to start with '제' and end with '호' (e.g., '제WTMS-TN-2017-4호')." },
              "형식승인일": { type: Type.STRING, description: "The date of type approval. CRITICAL: Format as YYYY-MM-DD." },
              "기기고유번호": { type: Type.STRING, description: "The unique serial number of the device (e.g., H4TN2M1509)." },
            },
            required: ["제조회사", "기기형식", "형식승인번호", "형식승인일", "기기고유번호"],
          },
        };
        break;

      case "측정범위확인":
        autoComment = "측정범위";
        prompt = `이미지에서 "${mainItemName}" 장비와 관련된 라벨을 찾으세요. 그 라벨에서 "측정범위"라는 텍스트를 찾고, 그 바로 옆이나 아래에 있는 값을 정확하게 추출하여 문자열로 반환해주세요. 예를 들어, "측정범위 0 ~ 100 mg/L"라고 되어 있으면 "0 ~ 100 mg/L"를 반환해야 합니다. 응답에는 추출된 범위 텍스트만 포함하고 다른 설명은 제외해주세요.`;
        break;
        
      case "측정방법확인":
        autoComment = "측정방법";
        const preferredMethod = PREFERRED_MEASUREMENT_METHODS[activeJob.mainItemKey];
        prompt = `이미지에서 "${mainItemName}" 장비와 관련된 라벨을 찾으세요. 그 라벨에서 "측정방법"이라는 텍스트를 찾고, 그 바로 옆이나 아래에 있는 값을 정확하게 추출하여 문자열로 반환해주세요.`;
        if (preferredMethod) {
            prompt += `\n\n"${mainItemName}" 항목의 가장 유력한 측정 방법은 "${preferredMethod}"입니다. 이미지에서 이 텍스트를 우선적으로 찾아주세요. 만약 이 텍스트를 찾으면, 정확히 "${preferredMethod}"라고 반환하세요. 찾을 수 없다면, 보이는 그대로 측정 방법을 추출하세요.`;
        }
        prompt += `\n응답에는 추출된 텍스트만 포함하고 다른 설명은 제외해주세요.`;
        break;
        
      case "운용프로그램확인":
        autoComment = "운용프로그램";
        prompt = `이미지에서 장비의 운용프로그램 버전 또는 펌웨어 버전 정보를 찾아 문자열로 반환해주세요. 응답에는 버전 텍스트만 포함하고 다른 설명은 제외해주세요.`;
        break;

      case "지시부 번호":
        targetChecklistItem = "기기번호 확인";
        autoComment = "지시부 번호";
        prompt = `이미지에서 '지시부' 또는 '표시부'와 관련된 기기 번호나 시리얼 번호를 찾아 문자열로 반환해주세요. 응답에는 번호 텍스트만 포함하고 다른 설명은 제외해주세요.`;
        break;

      case "센서부 번호":
        targetChecklistItem = "기기번호 확인";
        autoComment = "센서부 번호";
        prompt = `이미지에서 '센서부'와 관련된 기기 번호나 시리얼 번호를 찾아 문자열로 반환해주세요. 응답에는 번호 텍스트만 포함하고 다른 설명은 제외해주세요.`;
        break;

      default:
        setDetailAnalysisError("지원되지 않는 분석 유형입니다.");
        setIsAnalyzingDetail(false);
        if (isQuickAnalysis) setQuickAnalysisTarget(null);
        return;
    }

    try {
        const resultText = (await extractTextFromImage(photoToProcess.base64, photoToProcess.mimeType, prompt, modelConfig)).trim();
        
        if (itemNameForAnalysis === "정도검사 증명서") {
            const newCertDetails = JSON.parse(resultText) as Partial<CertificateDetails>;
            const existingNotes = activeJob.checklistData[targetChecklistItem]?.notes;
            let existingCertDetails: CertificateDetails = { presence: 'not_selected' };
            try { if (existingNotes) existingCertDetails = JSON.parse(existingNotes); } catch (e) { /* ignore */ }
            const mergedDetails: CertificateDetails = { ...existingCertDetails, ...newCertDetails, presence: 'present' };
            handleChecklistItemChange(targetChecklistItem, "notes", JSON.stringify(mergedDetails));
        } else if (itemNameForAnalysis === "측정범위확인") {
            const itemOptions = MEASUREMENT_RANGE_OPTIONS[activeJob.mainItemKey];
            let matchedOption: string | null = null;

            if (itemOptions && resultText) {
                // Extracts the largest number from a string, which is typically the upper bound of a range.
                const getUpperBound = (str: string): number | null => {
                    const numbers = str.match(/\d+(\.\d+)?/g);
                    if (!numbers) return null;
                    const numericValues = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n));
                    if (numericValues.length === 0) return null;
                    return Math.max(...numericValues);
                };

                const resultNumber = getUpperBound(resultText);

                if (resultNumber !== null) {
                    for (const option of itemOptions) {
                        if (option === OTHER_DIRECT_INPUT_OPTION || option === ANALYSIS_IMPOSSIBLE_OPTION) continue;
                        
                        const optionNumber = getUpperBound(option);
                        if (optionNumber !== null && optionNumber === resultNumber) {
                            matchedOption = option;
                            break;
                        }
                    }
                }
            }
            
            handleChecklistItemChange(targetChecklistItem, "notes", matchedOption || `${OTHER_DIRECT_INPUT_OPTION} (${resultText})`);
        } else if (itemNameForAnalysis === "측정방법확인") {
            const itemOptions = MEASUREMENT_METHOD_OPTIONS[activeJob.mainItemKey];
            const foundOption = itemOptions?.find(opt => {
                const normalizedOpt = opt.replace(/\s+/g, '').toLowerCase();
                const normalizedResult = resultText.replace(/\s+/g, '').toLowerCase();
                // Check if one contains the other for flexibility
                return normalizedOpt.includes(normalizedResult) || normalizedResult.includes(normalizedOpt);
            });
            handleChecklistItemChange(targetChecklistItem, "notes", foundOption || `${OTHER_DIRECT_INPUT_OPTION} (${resultText})`);
        } else if (itemNameForAnalysis === "지시부 번호" || itemNameForAnalysis === "센서부 번호") {
            const existingNotes = activeJob.checklistData[targetChecklistItem]?.notes || '';
            const parts = existingNotes.split(',').map(p => p.trim());
            let indicatorPart = parts[0] || '';
            let sensorPart = parts.length > 1 ? parts[1] : '';

            if (itemNameForAnalysis === "지시부 번호") {
                indicatorPart = resultText.trim();
            } else { // "센서부 번호"
                sensorPart = resultText.trim();
            }
            
            const newNote = [indicatorPart, sensorPart].filter(Boolean).join(', ');

            handleChecklistItemChange(targetChecklistItem, "notes", newNote);
        } else {
            handleChecklistItemChange(targetChecklistItem, "notes", resultText);
        }
        
        if (isQuickAnalysis) {
            if (autoComment) handlePhotoCommentChange(photoToProcess.uid, autoComment);
            setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: `${getAnalysisTypeDisplayString(itemNameForAnalysis)} 판별 완료`, type: 'success' });
            
            setAnalysisStatusForPhotos(prev => {
                const newStatus = { ...prev };
                if (!newStatus[activeJobId!]) newStatus[activeJobId!] = {};
                if (!newStatus[activeJobId!][currentPhotoIndexOfActiveJob]) newStatus[activeJobId!][currentPhotoIndexOfActiveJob] = new Set();
                newStatus[activeJobId!][currentPhotoIndexOfActiveJob].add(itemNameForAnalysis);
                return newStatus;
            });
            
            setAnalyzedTypesForJob(prev => {
                const jobSet = new Set(prev[activeJobId!] || []);
                jobSet.add(itemNameForAnalysis);
                return { ...prev, [activeJobId!]: jobSet };
            });
        }
    } catch (error: any) {
        const errorMsg = `분석 오류: ${error.message}`;
        if (isQuickAnalysis) setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: errorMsg, type: 'error' });
        else setDetailAnalysisError(errorMsg);
    } finally {
        setIsAnalyzingDetail(false);
        if (isQuickAnalysis) setQuickAnalysisTarget(null);
    }
  }, [activeJob, activeJobId, currentPhotoIndexOfActiveJob, handleChecklistItemChange, handlePhotoCommentChange, setJobs, getAnalysisTypeDisplayString]);

  const handleInitiateSendToKtl = async () => {
    if (!activeJob || !siteLocation.trim()) {
      alert("활성 작업이 없거나 현장 위치가 입력되지 않았습니다.");
      return;
    }
    setIsRenderingChecklist(true);
    resetActiveJobSubmissionStatus();
    setJobForSnapshot(activeJob);
  };
  
  // This effect will run after the state update causes a re-render
  useEffect(() => {
      if (!jobForSnapshot) return;

      const performSnapshot = async () => {
          const elementToCapture = document.getElementById(`snapshot-container-for-${jobForSnapshot.id}`);
          if (!elementToCapture) {
              alert("체크리스트 스냅샷 요소를 찾을 수 없습니다.");
              setIsRenderingChecklist(false);
              setJobForSnapshot(null);
              return;
          }

          try {
              const canvas = await html2canvas(elementToCapture, {
                  backgroundColor: '#1e293b',
                  width: elementToCapture.offsetWidth,
                  height: elementToCapture.offsetHeight,
                  scale: 1.5,
              });
              const dataUrl = canvas.toDataURL('image/png');
              const blob = await (await fetch(dataUrl)).blob();
              const base64 = dataUrl.split(',')[1];
              
              const sanitizedReceipt = sanitizeFilenameComponent(jobForSnapshot.receiptNumber);
              let itemPart = "";
              if (jobForSnapshot.mainItemKey === 'TP') itemPart = "P";
              else if (jobForSnapshot.mainItemKey === 'Cl') itemPart = "C";
              else if (jobForSnapshot.mainItemKey !== 'TN') itemPart = sanitizeFilenameComponent(jobForSnapshot.mainItemKey);
              const checklistImageName = `${sanitizedReceipt}${itemPart ? `_${itemPart}` : ''}_checklist.png`;
              
              const checklistImageFile = new File([blob], checklistImageName, { type: 'image/png' });
              const checklistImageInfo: ImageInfo = { file: checklistImageFile, base64, mimeType: 'image/png' };

              const compositeImageName = jobForSnapshot.photos.length > 0 ? generateCompositeImageNameForKtl(jobForSnapshot.receiptNumber) : undefined;
              const zipFileName = jobForSnapshot.photos.length > 0 ? generateZipFileNameForKtl(jobForSnapshot.receiptNumber) : undefined;
              const fileNamesForPreflight = [checklistImageName, compositeImageName, zipFileName].filter(Boolean) as string[];

              const jsonForPreview = generateStructuralKtlJsonForPreview(
                  [{ 
                      ...jobForSnapshot, 
                      siteLocation: siteLocation,
                      updateUser: userName,
                      photoFileNames: {}, 
                      postInspectionDateValue: jobForSnapshot.postInspectionDate 
                  }],
                  siteLocation, undefined, userName, compositeImageName, zipFileName
              );

              setKtlPreflightData({
                  jsonPayload: jsonForPreview,
                  fileNames: fileNamesForPreflight,
                  context: {
                      receiptNumber: jobForSnapshot.receiptNumber,
                      siteLocation,
                      selectedItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === jobForSnapshot.mainItemKey)?.name || jobForSnapshot.mainItemKey,
                      userName,
                  },
                  generatedChecklistImage: checklistImageInfo
              });
              setKtlPreflightModalOpen(true);
          } catch (error) {
              console.error("Error generating checklist image:", error);
              updateActiveJob(job => ({ ...job, submissionStatus: 'error', submissionMessage: '체크리스트 이미지 생성 실패.' }));
          } finally {
              setIsRenderingChecklist(false);
              setJobForSnapshot(null);
          }
      };
      
      // Use a timeout to ensure the DOM is painted after the state change.
      const timer = setTimeout(performSnapshot, 100);
      return () => clearTimeout(timer);

  }, [jobForSnapshot, siteLocation, userName, updateActiveJob]);

  const handleConfirmSendToKtl = async () => {
    if (!activeJob || !ktlPreflightData || !ktlPreflightData.generatedChecklistImage) {
      alert("전송 확인을 위한 데이터가 부족합니다.");
      setKtlPreflightModalOpen(false);
      return;
    }
    setKtlPreflightModalOpen(false);
    updateActiveJob(job => ({...job, submissionStatus: 'sending', submissionMessage: '전송 중...'}));

    try {
      const results = await sendBatchStructuralChecksToKtlApi(
        [activeJob],
        [ktlPreflightData.generatedChecklistImage],
        siteLocation,
        undefined,
        userName
      );

      const result = results[0];
      if (result && result.success) {
        updateActiveJob(job => ({...job, submissionStatus: 'success', submissionMessage: result.message}));
      } else {
        updateActiveJob(job => ({...job, submissionStatus: 'error', submissionMessage: result ? result.message : '알 수 없는 오류가 발생했습니다.'}));
      }

    } catch (error: any) {
      updateActiveJob(job => ({...job, submissionStatus: 'error', submissionMessage: `전송 실패: ${error.message}`}));
    } finally {
      setKtlPreflightData(null);
    }
  };
  
    const handleBatchSendToKtl = async () => {
        if (!siteLocation.trim()) {
            alert("현장 위치를 입력해야 합니다.");
            return;
        }
        if (jobs.length === 0) {
            alert("전송할 작업이 없습니다.");
            return;
        }

        setIsSendingToClaydox(true);
        setBatchSendProgress(`(0/${jobs.length}) 체크리스트 이미지 생성 시작...`);
        setJobs(prev => prev.map(j => ({ ...j, submissionStatus: 'sending', submissionMessage: '대기 중...' })));

        const generatedChecklistImages: ImageInfo[] = [];
        let imageGenError = false;

        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            setBatchSendProgress(`(${(i + 1)}/${jobs.length}) '${job.receiptNumber}' 체크리스트 캡처 중...`);
            
            // This relies on the useEffect hook to perform the snapshot now
            setJobForSnapshot(job);
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for render

            const elementToCapture = document.getElementById(`snapshot-container-for-${job.id}`);
            if (elementToCapture) {
                try {
                    const canvas = await html2canvas(elementToCapture, {
                        backgroundColor: '#1e293b',
                        width: elementToCapture.offsetWidth,
                        height: elementToCapture.offsetHeight,
                        scale: 1.5,
                    });
                    const dataUrl = canvas.toDataURL('image/png');
                    const blob = await (await fetch(dataUrl)).blob();

                    const sanitizedReceipt = sanitizeFilenameComponent(job.receiptNumber);
                    let itemPart = "";
                    if (job.mainItemKey === 'TP') itemPart = "P";
                    else if (job.mainItemKey === 'Cl') itemPart = "C";
                    else if (job.mainItemKey !== 'TN') itemPart = sanitizeFilenameComponent(job.mainItemKey);
                    
                    const filename = `${sanitizedReceipt}${itemPart ? `_${itemPart}` : ''}_checklist.png`;
                    const file = new File([blob], filename, { type: 'image/png' });
                    const base64 = dataUrl.split(',')[1];
                    generatedChecklistImages.push({ file, base64, mimeType: 'image/png' });
                } catch (err) {
                    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, submissionStatus: 'error', submissionMessage: '체크리스트 이미지 생성 실패' } : j));
                    imageGenError = true;
                }
            }
            setJobForSnapshot(null); // Clean up for next iteration
        }

        if (imageGenError) {
            setBatchSendProgress('오류: 일부 체크리스트 이미지를 생성할 수 없습니다.');
            setIsSendingToClaydox(false);
            setJobForSnapshot(null);
            setTimeout(() => setBatchSendProgress(null), 5000);
            return;
        }

        setBatchSendProgress(`모든 체크리스트 이미지 생성 완료. KTL 서버로 전송합니다...`);

        try {
            const results = await sendBatchStructuralChecksToKtlApi(jobs, generatedChecklistImages, siteLocation, undefined, userName);
            results.forEach(result => {
                setJobs(prev => prev.map(j => (j.receiptNumber === result.receiptNo && (MAIN_STRUCTURAL_ITEMS.find(it => it.key === j.mainItemKey)?.name || j.mainItemKey) === result.mainItem)
                    ? { ...j, submissionStatus: result.success ? 'success' : 'error', submissionMessage: result.message }
                    : j
                ));
            });
        } catch (error: any) {
            setJobs(prev => prev.map(j => ({ ...j, submissionStatus: 'error', submissionMessage: `일괄 전송 실패: ${error.message}` })));
        }

        setBatchSendProgress('일괄 전송 완료.');
        setIsSendingToClaydox(false);
        setTimeout(() => setBatchSendProgress(null), 5000);
    };

    const StatusIndicator: React.FC<{ status: StructuralJob['submissionStatus'], message?: string }> = ({ status, message }) => {
        if (status === 'idle' || !message) return null;
        if (status === 'sending') return <span className="text-xs text-sky-400 animate-pulse">{message}</span>;
        if (status === 'success') return <span className="text-xs text-green-400">✅ {message}</span>;
        if (status === 'error') return <span className="text-xs text-red-400" title={message}>❌ {message.length > 30 ? message.substring(0, 27) + '...' : message}</span>;
        return null;
    };
    
    const isControlsDisabled = isLoading || isAnalyzingDetail || isRenderingChecklist || !!batchSendProgress;
    
    const currentMethodOptions = activeJob ? MEASUREMENT_METHOD_OPTIONS[activeJob.mainItemKey] : undefined;
    const currentRangeOptions = activeJob ? MEASUREMENT_RANGE_OPTIONS[activeJob.mainItemKey] : undefined;
    const isFixedDateItem = activeJob?.mainItemKey === 'PH' || activeJob?.mainItemKey === 'TU' || activeJob?.mainItemKey === 'Cl';
    
    const QuickAnalysisButton: React.FC<{ analysisType: AnalysisType }> = ({ analysisType }) => {
        const feedback = quickAnalysisFeedback?.targetItemName === analysisType ? quickAnalysisFeedback : null;
        const wasAnalyzedForJob = analyzedTypesForJob?.[activeJobId!]?.has(analysisType);
        const isThisButtonAnalyzing = quickAnalysisTarget === analysisType;
        const isNotApplicable = (activeJob?.mainItemKey === 'TU' || activeJob?.mainItemKey === 'Cl') && analysisType === '운용프로그램확인';

        return (
            <div className="flex flex-col items-center">
                 <ActionButton
                    onClick={() => handleAnalyzeChecklistItemDetail(analysisType, true)}
                    isAnalyzed={wasAnalyzedForJob && !isThisButtonAnalyzing}
                    className={`text-xs py-1.5 px-2.5 h-fit whitespace-nowrap w-full ${
                        isThisButtonAnalyzing
                        ? 'bg-slate-500 hover:bg-slate-500 text-slate-300'
                        : isNotApplicable
                          ? 'bg-slate-600 !text-slate-400'
                          : wasAnalyzedForJob 
                            ? 'bg-green-600 hover:bg-green-500 focus:ring-green-500 text-white'
                            : 'bg-purple-600 hover:bg-purple-500 focus:ring-purple-500 text-white'
                    }`}
                    disabled={isControlsDisabled || isThisButtonAnalyzing || isNotApplicable}
                    title={isNotApplicable ? '이 항목은 AI 분석이 필요하지 않습니다.' : undefined}
                >
                    {isThisButtonAnalyzing ? <Spinner size="sm" /> : getAnalysisTypeDisplayString(analysisType)}
                </ActionButton>
                {feedback && (
                    <p className={`text-xs mt-1 text-center ${feedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        {feedback.message}
                    </p>
                )}
            </div>
        );
    };

  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      {jobForSnapshot && (
        <div style={{ position: 'fixed', left: '-9999px', top: '0', pointerEvents: 'none', opacity: 0 }}>
          <ChecklistSnapshot job={jobForSnapshot} />
        </div>
      )}
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">구조 확인 (P4)</h2>
      
      {jobs.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-md font-semibold text-slate-200">작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-60 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div key={job.id}
                   className={`p-2.5 rounded-md cursor-pointer transition-all ${activeJobId === job.id ? 'bg-sky-600/30 ring-2 ring-sky-500' : 'bg-slate-700 hover:bg-slate-600/70'}`}
                   onClick={() => setActiveJobId(job.id)}
              >
                 <div className="flex justify-between items-center">
                    <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-sky-300' : 'text-slate-200'}`}>{job.receiptNumber} / {MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name}</span>
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
                 <div className="mt-1 text-right">
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
        <>
            <div className="pt-4 border-t border-slate-700 space-y-4">
            <h3 className="text-lg font-semibold text-slate-100">참고 사진 관리</h3>
            {isCameraOpen ? (
                <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
            ) : (
                <>
                <ImageInput
                    onImagesSet={handleActiveJobPhotosSet}
                    onOpenCamera={handleOpenCamera}
                    isLoading={isControlsDisabled}
                    ref={activeJobFileInputRef}
                    selectedImageCount={activeJob.photos.length}
                />
                {currentPhotoIndexOfActiveJob !== -1 && activeJob.photos[currentPhotoIndexOfActiveJob] && (
                    <ImagePreview
                        imageBase64={activeJob.photos[currentPhotoIndexOfActiveJob].base64}
                        fileName={activeJob.photos[currentPhotoIndexOfActiveJob].file.name}
                        mimeType={activeJob.photos[currentPhotoIndexOfActiveJob].mimeType}
                        receiptNumber={activeJob.receiptNumber}
                        siteLocation={siteLocation}
                        item={MAIN_STRUCTURAL_ITEMS.find(it => it.key === activeJob.mainItemKey)?.name}
                        comment={activeJob.photoComments[activeJob.photos[currentPhotoIndexOfActiveJob].uid]}
                        showOverlay={true}
                        totalSelectedImages={activeJob.photos.length}
                        currentImageIndex={currentPhotoIndexOfActiveJob}
                        onDelete={() => handleDeleteActiveJobImage(currentPhotoIndexOfActiveJob)}
                    />
                )}
                 {currentPhotoIndexOfActiveJob !== -1 && activeJob.photos[currentPhotoIndexOfActiveJob] && (
                     <div className="mt-2">
                        <label htmlFor="photo-comment" className="text-sm font-medium text-slate-300 mb-1 block">사진 코멘트 (선택 사항):</label>
                        <input
                            type="text"
                            id="photo-comment"
                            value={activeJob.photoComments[activeJob.photos[currentPhotoIndexOfActiveJob].uid] || ''}
                            onChange={(e) => handlePhotoCommentChange(activeJob.photos[currentPhotoIndexOfActiveJob].uid, e.target.value)}
                            className="w-full text-sm bg-slate-700 border border-slate-600 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                            placeholder="이 사진에 대한 코멘트 입력..."
                            disabled={isControlsDisabled}
                        />
                     </div>
                 )}
                <ThumbnailGallery 
                    images={activeJob.photos}
                    currentIndex={currentPhotoIndexOfActiveJob}
                    onSelectImage={setCurrentPhotoIndexOfActiveJob}
                    onDeleteImage={handleDeleteActiveJobImage}
                    disabled={isControlsDisabled}
                    analysisStatusForPhotos={analysisStatusForPhotos[activeJobId]}
                />
                 {activeJob.photos.length > 0 && (
                     <div className="mt-4 p-3 bg-slate-700/40 rounded-lg border border-slate-600/50">
                        <h4 className="text-md font-semibold text-slate-200 mb-2">빠른 분석 (선택된 사진 대상)</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <QuickAnalysisButton analysisType="측정범위확인" />
                            <QuickAnalysisButton analysisType="표시사항확인" />
                            <QuickAnalysisButton analysisType="운용프로그램확인" />
                            <QuickAnalysisButton analysisType="정도검사 증명서" />
                            {(activeJob.mainItemKey === 'TU' || activeJob.mainItemKey === 'Cl') && (
                                <>
                                    <QuickAnalysisButton analysisType="지시부 번호" />
                                    <QuickAnalysisButton analysisType="센서부 번호" />
                                </>
                            )}
                        </div>
                     </div>
                 )}
                </>
            )}
            </div>

            <div className="space-y-1 mt-4 p-3 bg-slate-700/40 rounded-lg border border-slate-600/50">
              <div className="flex flex-wrap gap-2 justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-slate-100">체크리스트: {activeJob.receiptNumber} / {MAIN_STRUCTURAL_ITEMS.find(item => item.key === activeJob.mainItemKey)?.name}</h3>
                <ActionButton onClick={handleSetAllSuitableForActiveJob} variant="secondary" className="text-xs py-1.5 px-3 bg-green-600 hover:bg-green-500" disabled={isControlsDisabled}>일괄 적합</ActionButton>
              </div>
              <div id={`checklist-for-${activeJob.id}`}>
                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].map((itemName, index) => {
                  const isRangeItem = itemName === "측정범위확인";
                  const isMethodItem = itemName === "측정방법확인";
                  let itemOptionsForAnalysis: string[] | undefined = undefined;

                  if (isRangeItem) {
                    itemOptionsForAnalysis = currentRangeOptions;
                  } else if (isMethodItem) {
                    itemOptionsForAnalysis = currentMethodOptions;
                  }

                  return (
                    <ChecklistItemRow
                      key={`${activeJob.id}-${itemName}`}
                      mainItemKey={activeJob.mainItemKey}
                      itemName={itemName}
                      itemIndex={index}
                      status={activeJob.checklistData[itemName]?.status || '선택 안됨'}
                      onStatusChange={(newStatus) => handleChecklistItemChange(itemName, 'status', newStatus)}
                      notes={activeJob.checklistData[itemName]?.notes || ''}
                      onNotesChange={notes => handleChecklistItemChange(itemName, 'notes', notes)}
                      specialNotes={activeJob.checklistData[itemName]?.specialNotes || ''}
                      onSpecialNotesChange={specialNotes => handleChecklistItemChange(itemName, 'specialNotes', specialNotes)}
                      confirmedAt={activeJob.checklistData[itemName]?.confirmedAt || null}
                      disabled={isControlsDisabled}
                      itemOptions={itemOptionsForAnalysis}
                      onAnalyzeDetail={(type) => handleAnalyzeChecklistItemDetail(type, false)}
                      isAnalyzingDetail={isAnalyzingDetail}
                      detailAnalysisError={detailAnalysisError}
                      jobPhotosExist={activeJob.photos.length > 0}
                      comparisonNote={itemName === "정도검사 증명서" ? comparisonNoteForActiveJob : null}
                    />
                  );
                })}
              </div>
                
              <div className="mt-4 pt-4 border-t border-slate-600">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div>
                        <label htmlFor="post-inspection-date" className="block text-sm font-medium text-slate-300 mb-1">
                            {isFixedDateItem ? '사후검사일' : '사후검사 유효일자'}
                        </label>
                        {isFixedDateItem ? (
                             <div className="block w-full p-2.5 bg-slate-700/50 border border-slate-600 rounded-md text-slate-300 text-sm">
                                2년 후 (고정)
                             </div>
                        ) : (
                            <select
                                id="post-inspection-date"
                                value={activeJob.postInspectionDate}
                                onChange={(e) => handlePostInspectionDateChange(e.target.value)}
                                disabled={isControlsDisabled}
                                className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
                            >
                                {POST_INSPECTION_DATE_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        )}
                    </div>
                    {activeJob.postInspectionDateConfirmedAt && !isFixedDateItem && (
                        <p className="text-xs text-slate-400 md:text-right pb-2.5">
                            (확인: {activeJob.postInspectionDateConfirmedAt})
                        </p>
                    )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-700">
                    <ActionButton 
                        onClick={handleInitiateSendToKtl}
                        disabled={!siteLocation.trim() || isLoading || isAnalyzingDetail || activeJob.submissionStatus === 'sending' || isRenderingChecklist}
                        fullWidth
                        icon={isRenderingChecklist || activeJob.submissionStatus === 'sending' ? <Spinner size="sm"/> : undefined}
                    >
                        {isRenderingChecklist ? '체크리스트 캡처 중...' : (activeJob.submissionStatus === 'sending' ? '전송 중...' : `활성 작업 KTL로 전송`)}
                    </ActionButton>
                    {activeJob.submissionMessage && activeJob.submissionStatus !== 'sending' && (
                        <p className={`mt-3 text-sm text-center ${activeJob.submissionStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                            {activeJob.submissionStatus === 'success' ? '✅' : '❌'} {activeJob.submissionMessage}
                        </p>
                    )}
                </div>
            </div>
        </>
      )}

      {jobs.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
            <h3 className="text-xl font-bold text-teal-400">KTL 일괄 전송</h3>
            <p className="text-sm text-slate-400">
                이 페이지의 모든 작업을 KTL로 전송합니다. 이 작업은 시간이 걸릴 수 있으며 안정적인 Wi-Fi 환경에서 실행하는 것이 좋습니다.
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
        <KtlPreflightModal isOpen={isKtlPreflightModalOpen} onClose={() => setKtlPreflightModalOpen(false)} onConfirm={handleConfirmSendToKtl} preflightData={ktlPreflightData} />
      )}
    </div>
  );
};

export default StructuralCheckPage;
