import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
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
} from './shared/StructuralChecklists';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ChecklistItemRow } from './components/structural/ChecklistItemRow';
import { ActionButton } from './components/ActionButton';
import { Spinner } from './components/Spinner';
import { sendBatchStructuralChecksToKtlApi, generateStructuralKtlJsonForPreview, generateCompositeImageNameForKtl, generateZipFileNameForKtl, sendSingleStructuralCheckToKtlApi } from './services/claydoxApiService';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { ImagePreview } from './components/ImagePreview';
import { extractTextFromImage } from './services/geminiService';
import type { GenerateContentParameters } from "@google/genai";
import { Type } from '@google/genai';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { ChecklistSnapshot } from './components/structural/ChecklistSnapshot';
import PasswordModal from './components/PasswordModal';
import MapView from './components/MapView';
import { preprocessImageForGemini } from './services/imageProcessingService';
import type { StructuralJob, JobPhoto } from './shared/types';


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

const CalendarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18M-4.5 12h22.5" />
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

const getCurrentLocalDateTimeString = (): string => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
};

interface StructuralCheckPageProps {
  userName: string;
  jobs: StructuralJob[];
  setJobs: React.Dispatch<React.SetStateAction<StructuralJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteName: string;
  onDeleteJob: (jobId: string) => void;
  currentGpsAddress: string;
}

const StructuralCheckPage: React.FC<StructuralCheckPageProps> = ({ 
  userName, jobs, setJobs, activeJobId, setActiveJobId, siteName, onDeleteJob,
  currentGpsAddress
}) => {
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
  const snapshotHostRef = useRef<HTMLDivElement | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isDateOverrideUnlocked, setIsDateOverrideUnlocked] = useState(false);
  const [overrideDateTime, setOverrideDateTime] = useState('');

  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const updateActiveJob = useCallback((updater: (job: StructuralJob) => StructuralJob) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => job.id === activeJobId ? updater(job) : job));
  }, [activeJobId, setJobs]);

  useEffect(() => {
    setIsDateOverrideUnlocked(false);
  }, [activeJobId]);

  const handleOverrideDateTimeChange = useCallback((newDateTime: string) => {
    if (!activeJob || !newDateTime) return;

    const formattedDateTime = newDateTime.replace('T', ' ');

    updateActiveJob(job => {
        const updatedChecklistData = { ...job.checklistData };
        for (const itemName in updatedChecklistData) {
            const item = updatedChecklistData[itemName];
            if (item.confirmedAt) {
                updatedChecklistData[itemName] = {
                    ...item,
                    confirmedAt: formattedDateTime,
                };
            }
        }
        
        const newPostInspectionDateConfirmedAt = job.postInspectionDateConfirmedAt ? formattedDateTime : null;
        
        return {
          ...job,
          checklistData: updatedChecklistData,
          submissionStatus: 'idle',
          submissionMessage: undefined,
          postInspectionDateConfirmedAt: newPostInspectionDateConfirmedAt,
        };
    });
  }, [activeJob, updateActiveJob]);

  const handleDateTimeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDateTime = e.target.value;
    setOverrideDateTime(newDateTime);
    handleOverrideDateTimeChange(newDateTime);
  };

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
          updatedItemData.specialNotes = newStatus === '적합' ? '세척 가능' : newStatus === '부적합' ? '없음' : '';
        }
        
        if (job.mainItemKey === 'Cl' && itemName === '검출장치') {
          updatedItemData.specialNotes = newStatus === '적합' ? '(전극식/시약식)에 따른 구성요소 확인 및 내식성 재질 사용, 세척 가능' : '';
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
            updatedChecklistData[itemName].specialNotes = '세척 가능';
          }
          if (job.mainItemKey === 'Cl' && itemName === '검출장치') {
            updatedChecklistData[itemName].specialNotes = '(전극식/시약식)에 따른 구성요소 확인 및 내식성 재질 사용, 세척 가능';
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
You are a highly precise data extraction assistant specializing in official Korean '정도검사 증명서' (Certificate of Inspection). From the provided certificate image(s) for a "${mainItemName}" device, extract ALL fields below. If a field is not visible, use an empty string "" as its value. DO NOT OMIT ANY KEYS. Respond ONLY with a single JSON object (no markdown, no extra text). 

MULTI-IMAGE / RIGHT-CERT SELECTION (CRITICAL):
- If multiple certificate images are provided, you MUST select the single certificate that matches the requested analysis item "${mainItemName}" and extract fields from THAT one only.

CERT MATCHING RULES (MODEL CODE MAY BE MISSING):
- Use BOTH any model code near the type-approval line and the **Korean descriptor** sentence (예: "탁도 연속자동측정기와 그 부속기기", "잔류염소 연속자동측정기와 그 부속기기", "총질소 연속자동측정기와 그 부속기기").
- If the WTMS-/DWMS- prefix is missing or blurred, rely on the **Korean descriptor**.
- **COMBO ⇒ MULTI (강제 규칙):** 대상이 복합 항목이면(예: "${mainItemName}"가 "TN/TP" 또는 "TU/CL" 계열이거나, 한글 서술문에 슬래시 조합이 보이면) 해당 증명서는 **MULTI**로 간주한다.
- 수질: productName은 "WTMS-MULTI" (접두어 불명확하면 "MULTI")
- 먹는물: productName은 "DWMS-MULTI" (접두어 불명확하면 "MULTI")

Descriptor-to-item mapping (case-insensitive, space-insensitive; **한글 서술문이 핵심**):
• 수질:
  - TN: descriptor contains "총질소 연속자동측정기와 그 부속기기"
  - TP: descriptor contains "총인 연속자동측정기와 그 부속기기"
  - COD: descriptor contains "화학적산소요구량 연속자동측정기와 그 부속기기"
  - SS: descriptor contains "부유물질 연속자동측정기와 그 부속기기"
  - pH: descriptor contains "수소이온농도 연속자동측정기와 그 부속기기"
  - TN/TP(MULTI): descriptor contains "총질소/총인 연속자동측정기와 그 부속기기" → **MULTI**

• 먹는물 — **TM/CM 코드 힌트 포함**:
  - 탁도(TU): descriptor contains "탁도 연속자동측정기와 그 부속기기" * Code cues: "DWMS-TM" 또는 "-TM" 패턴 → 탁도로 해석
  - 잔류염소(Cl): descriptor contains "잔류염소 연속자동측정기와 그 부속기기" * Code cues: "DWMS-CM" 또는 "-CM-" 패턴 → 잔류염소로 해석
  - TU/CL(MULTI): descriptor contains "탁도/잔류염소 연속자동측정기와 그 부속기기" → **MULTI**
  - **Conflict rule:** 코드(TM/CM)와 서술문이 충돌하면 **서술문(한글 descriptor)을 우선**한다.

Model code preferences (보일 때만 사용):
- 수질: prefer "WTMS-*" or explicit "WTMS-MULTI".
- 먹는물: prefer "DWMS-*" or explicit "DWMS-MULTI".
- If a choice list like WTMS-"TN"/"TP"/"COD" is shown, choose the one EXACTLY matching ${mainItemName}; **but if ${mainItemName} is a combo or the descriptor shows a slash combo, override to MULTI.**

Tie-breaking (apply in order):
1) **Combo-descriptor/MULTI 신호가 있으면 무조건 MULTI.**
2) Descriptor 정확 일치 > 모델 코드 유사 일치(TM/CM 등).
3) (접두어가 보일 때만) WTMS(수질)/DWMS(먹는물) 우선.
4) 동률이면 가장 구체/긴 모델 문자열.

FIELDS TO EXTRACT (ALL REQUIRED; USE "" IF MISSING):
- productName: **한글 ‘품명’ 서술문을 우선 추출** (예: "탁도 연속자동측정기와 그 부속기기", "잔류염소 연속자동측정기와 그 부속기기", "총질소/총인 연속자동측정기와 그 부속기기").
  - 서술문이 보이지 않을 때만 모델코드(예: "DWMS-TM", "DWMS-CM", "WTMS-TN", "WTMS-MULTI") 또는 접두어 불명확 시 "MULTI"로 대체.
  - 따옴표 제거, 하이픈은 모델코드 사용 시 유지.
- manufacturer: 제작사.
- serialNumber: 제작번호/기기번호.
- typeApprovalNumber: 형식승인번호. MUST start with '제' and end with '호'.
  * 원문이 "DWMS-CM-2018-1", "WTMS-CODmn-2022-2" 등 본체만이면 각각 "제DWMS-CM-2018-1호", "제WTMS-CODmn-2022-2호"로 보완.
  * **먹는물 코드 규칙:** "-CM-" 포함 → 잔류염소(Cl), "-TM-" 또는 "-TU-" 포함 → 탁도(TU).
- inspectionDate: 검사일자. MUST be formatted as YYYY-MM-DD. Convert from any of YYYY.MM.DD / YYYY년 MM월 DD일 / YY.MM.DD to YYYY-MM-DD.
- validity: 유효기간. MUST be formatted as YYYY-MM-DD (same conversion rule).
- previousReceiptNumber: The main certificate ID often labeled '제...호'. Extract ONLY the core number (strip '제' prefix and '호' suffix). Example: from '제21-018279-02-77호' return '21-018279-02-77'.
Priority when multiple '제..호' exist:
1) The current year is ${currentYear}. Search first for numbers starting with two-digit year prefixes in this strict descending priority: '${yearPrefixes}'.
2) If multiple matches exist (e.g., '30-' and '29-'), choose the highest-priority prefix (e.g., '30-').
3) If none match those prefixes, choose any valid main certificate number present.

CRITICAL FORMATTING RULES:
1) Dates: 'inspectionDate' and 'validity' MUST be 'YYYY-MM-DD' exactly (zero-padded).
2) Type Approval: 'typeApprovalNumber' MUST start with '제' and end with '호' (add them if missing).
3) Output Shape: Return a SINGLE JSON object with ALL keys above present (use "" if a value is not visible). No markdown, no additional text.

.trim();

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

TASK:
From the provided image(s), identify the correct '형식승인표' (Type Approval Label) for the target item and extract exactly five fields.

TARGET CONTEXT
- Target main item name: "${mainItemName}"   // 예: "탁도", "잔류염소", "총질소", "총인", "TN/TP", "TU/CL" 등

MULTI-LABEL DISAMBIGUATION (CRITICAL):
If TWO OR MORE labels exist (e.g., 탁도 + 잔류염소 각각의 형식승인표), you MUST select ONE correct label and extract ONLY from that label. Use the following rules in order:

1) **Descriptor-first rule (한글 서술문 우선)**
   - Read the Korean descriptor sentence inside/near the label (e.g., "탁도 연속자동측정기와 그 부속기기", "잔류염소 연속자동측정기와 그 부속기기",
     "총질소 연속자동측정기와 그 부속기기", "총인   연속자동측정기와 그 부속기기").
   - Choose the label whose descriptor BEST MATCHES "${mainItemName}".
     • 탁도 ↔ "탁도 연속자동측정기와 그 부속기기"
     • 잔류염소 ↔ "잔류염소 연속자동측정기와 그 부속기기"
     • 총질소 ↔ "총질소 연속자동측정기와 그 부속기기"
     • 총인   ↔ "총인 연속자동측정기와 그 부속기기"
     • 복합(TN/TP 또는 TU/CL) ↔ "총질소/총인 연속자동측정기와 그 부속기기" 또는 "탁도/잔류염소 연속자동측정기와 그 부속기기"

2) **Code cue rule (보조 단서)**
   - 먹는물(DWMS*) 계열: 형식승인번호/모델코드에
     • **-TM-** 또는 **DWMS-TM / DWMS-TU** 가 보이면 **탁도**용
     • **-CM-** 또는 **DWMS-CM** 가 보이면 **잔류염소**용
   - 수질(WTMS*) 계열: **WTMS-TN/TP/COD/SS/pH** 등 해당 항목과 일치하는 코드가 보이면 그 라벨을 선택.
   - **Conflict:** 코드 단서와 한글 서술문이 충돌하면 **서술문(한글 descriptor)을 우선**한다.

3) **MULTI 강제 규칙(대상 복합일 때)**
   - "${mainItemName}"가 복합 항목(TN/TP 또는 TU/CL)인 경우, 복합(슬래시 포함) 서술문이 있는 라벨을 선택한다.
   - 복합 라벨이 없고 단일 라벨만 여러 개라면, "${mainItemName}"에서 요구되는 두 항목 중 현재 이미지에서 **더 명확하게 보이는 라벨 하나**를 선택한다.

4) **Completeness fallback**
   - 두 후보가 모두 가능한 경우, 5개 필드(제조회사/기기형식/형식승인번호/형식승인일/기기고유번호)가 **가장 완전하게 표기된 라벨**을 선택한다.

Once the single correct label is selected, extract ONLY from that label.

FIELDS TO EXTRACT (keys must be exactly these five, in Korean):
- 제조회사 (Manufacturer)
- 기기형식 (Model Type)
- 형식승인번호 (Type Approval Number)
- 형식승인일 (Type Approval Date)
- 기기고유번호 (Serial Number / S/N)

If a field is missing or unreadable on the selected label, return an empty string "" as its value. Do not omit any key from the JSON structure.

STRUCTURE DETAILS:
- Each field name (e.g., 제조회사, 기기형식, 형식승인번호, 형식승인일, 기기고유번호) appears next to or above its corresponding value.
- Some fields may span multiple lines due to small cell sizes. Merge wrapped lines into a single string separated by a single space.
- Extract the value directly associated with the labeled field (nearest cell/line to the right or below the label).

CRITICAL RULES:
1) Date Format:
   - Convert all detected dates to YYYY-MM-DD (zero-padded): e.g., 2017.8.1 → 2017-08-01, 2017년 8월 21일 → 2017-08-21.
   - If only year-month is visible (e.g., 2017-08), return "" (do not guess the day).

2) Type Approval Number Format:
   - The value for '형식승인번호' must START with '제' and END with '호'.
   - If the label shows a core ID like WTMS-TN-2017-4 or DWMS-CM-2018-1, return '제WTMS-TN-2017-4호' or '제DWMS-CM-2018-1호'.
   - Remove surrounding spaces; preserve internal hyphens and alphanumerics as-is.

3) Label-Value Matching:
   - Always match each value to the field name located immediately to its left or above.
   - Do not reuse a single text fragment for multiple fields unless it is explicitly repeated on the label.

4) Multi-Line Handling:
   - Merge wrapped lines belonging to the same field into a single line with single spaces.
   - Normalize consecutive spaces to a single space; trim leading/trailing spaces.

5) Field Exclusivity:
   - Extract ONLY the five fields listed above. Do not infer, predict, or include any other information.

OUTPUT FORMAT:
- Return ONLY a single valid JSON object with exactly these keys:
  {"제조회사":"", "기기형식":"", "형식승인번호":"", "형식승인일":"", "기기고유번호":""}
- Do not include any explanations, extra text, or markdown.

`.trim();

        modelConfig = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              "제조회사": { type: Type.STRING },
              "기기형식": { type: Type.STRING },
              "형식승인번호": { type: Type.STRING },
              "형식승인일": { type: Type.STRING },
              "기기고유번호": { type: Type.STRING },
            },
            required: ["제조회사", "기기형식", "형식승인번호", "형식승인일", "기기고유번호"],
            additionalProperties: false
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
        prompt = `이미지에서 장비의 운용프로그램 버전 또는 펌웨어 버전 정보를 찾아 문자열로 반환해주세요. '버전' 또는 'Ver.' 텍스트 근처를 우선 확인하세요. 'Ver. X.XX' 형식과 함께 긴 숫자 문자열이 함께 표시되는 경우에는 짧은 'Ver.' 형식이 아닌 그 아래나 근처의 긴 숫자 문자열(예: 210331119121)만 추출해 주세요. 그 외의 경우에는 발견한 버전 텍스트만 반환해 주세요. 응답에는 추출된 문자열만 포함하고 다른 설명은 제외해 주세요.`;
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
        const { base64: processedBase64, mimeType: processedMimeType } = await preprocessImageForGemini(photoToProcess.file, {
            maxWidth: 1600,
            jpegQuality: 0.9,
            grayscale: true,
        });
        const resultText = (await extractTextFromImage(processedBase64, processedMimeType, prompt, modelConfig)).trim();
        
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
    if (!activeJob || !siteName.trim()) {
      alert("활성 작업이 없거나 현장 위치가 입력되지 않았습니다.");
      return;
    }

    setIsRenderingChecklist(true);
    resetActiveJobSubmissionStatus();
    
    if (snapshotHostRef.current) {
        const snapshotRoot = createRoot(snapshotHostRef.current);
        const renderPromise = new Promise<void>(resolve => {
            snapshotRoot.render(
                <ChecklistSnapshot job={activeJob} />
            );
            setTimeout(resolve, 100); 
        });
        await renderPromise;

        const elementToCapture = document.getElementById(`snapshot-container-for-${activeJob.id}`);
        if (!elementToCapture) {
            alert("체크리스트 스냅샷 요소를 찾을 수 없습니다.");
            setIsRenderingChecklist(false);
            snapshotRoot.unmount();
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
            
            const sanitizedReceipt = sanitizeFilenameComponent(activeJob.receiptNumber);
            let itemPart = "";
            if (activeJob.mainItemKey === 'TP') itemPart = "P";
            else if (activeJob.mainItemKey === 'Cl') itemPart = "C";
            else if (activeJob.mainItemKey !== 'TN') itemPart = sanitizeFilenameComponent(activeJob.mainItemKey);
            const checklistImageName = `${sanitizedReceipt}${itemPart ? `_${itemPart}` : ''}_checklist.png`;
            
            const checklistImageFile = new File([blob], checklistImageName, { type: 'image/png' });
            const checklistImageInfo: ImageInfo = { file: checklistImageFile, base64, mimeType: 'image/png' };

            const compositeImageName = activeJob.photos.length > 0 ? generateCompositeImageNameForKtl(activeJob.receiptNumber) : undefined;
            const zipFileName = activeJob.photos.length > 0 ? generateZipFileNameForKtl(activeJob.receiptNumber) : undefined;
            const fileNamesForPreflight = [checklistImageName, compositeImageName, zipFileName].filter(Boolean) as string[];

            const jsonForPreview = generateStructuralKtlJsonForPreview(
                [{ 
                    ...activeJob, 
                    siteName: siteName,
                    updateUser: userName,
                    photoFileNames: {}, 
                    postInspectionDateValue: activeJob.postInspectionDate 
                }],
                siteName,
                userName,
                currentGpsAddress,
                compositeImageName,
                zipFileName
            );

            setKtlPreflightData({
                jsonPayload: jsonForPreview,
                fileNames: fileNamesForPreflight,
                context: {
                      receiptNumber: activeJob.receiptNumber,
                      siteLocation: siteName,
                      selectedItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === activeJob.mainItemKey)?.name || activeJob.mainItemKey,
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
            snapshotRoot.unmount();
        }
    } else {
        setIsRenderingChecklist(false);
    }
  };
  
  const handleConfirmSendToKtl = async () => {
    if (!activeJob || !ktlPreflightData || !ktlPreflightData.generatedChecklistImage) {
      alert("전송 확인을 위한 데이터가 부족합니다.");
      setKtlPreflightModalOpen(false);
      return;
    }
    setKtlPreflightModalOpen(false);

    const onProgress = (message: string) => {
        updateActiveJob(job => ({ ...job, submissionStatus: 'sending', submissionMessage: message }));
    };

    onProgress('전송 시작...');

    try {
      const result = await sendSingleStructuralCheckToKtlApi(
        activeJob,
        ktlPreflightData.generatedChecklistImage,
        siteName,
        userName,
        currentGpsAddress,
        onProgress,
        'p1_check'
      );

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
        if (!siteName.trim()) {
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
            
            if (snapshotHostRef.current) {
                const snapshotRoot = createRoot(snapshotHostRef.current);
                const renderPromise = new Promise<void>(resolve => {
                    snapshotRoot.render(
                        <ChecklistSnapshot job={job} />
                    );
                    setTimeout(resolve, 100); 
                });
                await renderPromise;

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
                snapshotRoot.unmount();
            }
        }

        if (imageGenError) {
            setBatchSendProgress('오류: 일부 체크리스트 이미지를 생성할 수 없습니다.');
            setIsSendingToClaydox(false);
            setTimeout(() => setBatchSendProgress(null), 5000);
            return;
        }

        setBatchSendProgress(`모든 체크리스트 이미지 생성 완료. KTL 서버로 전송합니다...`);

        try {
            const results = await sendBatchStructuralChecksToKtlApi(jobs, generatedChecklistImages, siteName, userName, currentGpsAddress, 'p1_check');
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
    
    const isControlsDisabled = isLoading || isAnalyzingDetail || isRenderingChecklist || !!batchSendProgress || activeJob?.submissionStatus === 'sending';
    
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
                    title={isNotApplicable ? "이 항목은 AI 분석이 필요하지 않습니다." : undefined}
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
      <div ref={snapshotHostRef} style={{ position: 'fixed', left: '-9999px', top: '0', pointerEvents: 'none', opacity: 0 }}></div>
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">구조 확인 (P1)</h2>
      
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
                        siteName={siteName}
                        gpsAddress={currentGpsAddress}
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
                <div className="flex items-center gap-2">
                    {isDateOverrideUnlocked && (
                        <input
                            type="datetime-local"
                            id="datetime-override-input-p4"
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
                    <ActionButton onClick={handleSetAllSuitableForActiveJob} variant="secondary" className="text-xs py-1.5 px-3 bg-green-600 hover:bg-green-500" disabled={isControlsDisabled}>일괄 적합</ActionButton>
                </div>
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
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-700">
                    <ActionButton 
                        onClick={handleInitiateSendToKtl}
                        disabled={!siteName.trim() || isLoading || isAnalyzingDetail || activeJob.submissionStatus === 'sending' || isRenderingChecklist}
                        fullWidth
                        icon={isRenderingChecklist || activeJob.submissionStatus === 'sending' ? <Spinner size="sm"/> : undefined}
                    >
                        {isRenderingChecklist ? '체크리스트 캡처 중...' : (activeJob.submissionStatus === 'sending' ? (activeJob.submissionMessage || '전송 중...') : `활성 작업 KTL로 전송`)}
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
        {isPasswordModalOpen && (
            <PasswordModal
                isOpen={isPasswordModalOpen}
                onClose={() => setIsPasswordModalOpen(false)}
                onSuccess={() => {
                    setIsDateOverrideUnlocked(true);
                    const newDateTime = getCurrentLocalDateTimeString();
                    setOverrideDateTime(newDateTime);
                    handleOverrideDateTimeChange(newDateTime);
                    setIsPasswordModalOpen(false);
                }}
            />
        )}
    </div>
  );
};

export default StructuralCheckPage;
