import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
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
  STRUCTURAL_ITEM_GROUPS
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


// --- Interfaces ---
export interface JobPhoto extends ImageInfo {
  uid: string;
}

export interface StructuralJob {
  id: string;
  receiptNumber: string;
  mainItemKey: MainStructuralItemKey;
  checklistData: Record<string, StructuralCheckSubItemData>;
  photos: JobPhoto[];
  photoComments: Record<string, string>; // Key: photo uid, Value: comment string
  postInspectionDate: string; 
  postInspectionDateConfirmedAt: string | null;
}

interface StructuralCheckPageProps {
  userName: string;
}

interface QuickAnalysisFeedback {
  targetItemName: AnalysisType;
  message: string;
  type: 'success' | 'error';
}

export type AnalysisType = "측정범위확인" | "측정방법확인" | "표시사항확인" | "운용프로그램확인" | "정도검사 증명서" | "지시부 번호" | "센서부 번호";

type AnalysisStatusForPhotos = Record<string, Record<number, Set<AnalysisType>>>;


// --- Helper Functions ---
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

// --- Component ---
const StructuralCheckPage: React.FC<StructuralCheckPageProps> = ({ userName }) => {
  const [jobs, setJobs] = useState<StructuralJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);

  const [siteLocation, setSiteLocation] = useState<string>('');

  const [newJobBaseReceiptNumber, setNewJobBaseReceiptNumber] = useState<string>('');
  const [newJobSuffixReceiptNumber, setNewJobSuffixReceiptNumber] = useState<string>('');
  const [newJobMainItemKey, setNewJobMainItemKey] = useState<MainStructuralItemKey | '' >('');

  const activeJobFileInputRef = useRef<HTMLInputElement>(null);
  const [currentPhotoIndexOfActiveJob, setCurrentPhotoIndexOfActiveJob] = useState<number>(-1);


  const [isLoading, setIsLoading] = useState<boolean>(false); 
  const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'success' | 'error' | 'analyzing'>('idle');
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);

  const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);

  const [isAnalyzingDetail, setIsAnalyzingDetail] = useState<boolean>(false); 
  const [detailAnalysisError, setDetailAnalysisError] = useState<string | null>(null);
  const [quickAnalysisTarget, setQuickAnalysisTarget] = useState<AnalysisType | null>(null);
  const [quickAnalysisFeedback, setQuickAnalysisFeedback] = useState<QuickAnalysisFeedback | null>(null);
  const [analysisStatusForPhotos, setAnalysisStatusForPhotos] = useState<AnalysisStatusForPhotos>({});


  const resetSubmissionState = useCallback(() => {
    setSubmissionStatus('idle');
    setSubmissionMessage(null);
  }, []);

  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  useEffect(() => {
    const currentActiveJob = jobs.find(job => job.id === activeJobId);
    if (currentActiveJob && currentActiveJob.photos.length > 0) {
      if (currentPhotoIndexOfActiveJob === -1 || currentPhotoIndexOfActiveJob >= currentActiveJob.photos.length) {
         setCurrentPhotoIndexOfActiveJob(0);
      }
    } else {
      setCurrentPhotoIndexOfActiveJob(-1);
    }
    if (quickAnalysisTarget === null) {
        setQuickAnalysisFeedback(null);
    }
  }, [activeJobId, activeJob?.photos, currentPhotoIndexOfActiveJob, quickAnalysisTarget]);

  const handleOpenCamera = useCallback(() => {
    if (!activeJobId) {
      alert('먼저 사진을 추가할 작업을 선택해주세요.');
      return;
    }
    setIsCameraOpen(true);
    resetSubmissionState();
    setQuickAnalysisFeedback(null);
  }, [activeJobId, resetSubmissionState]);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    if (!activeJobId) return;

    const capturedImageInfo: JobPhoto = { file, base64, mimeType, uid: self.crypto.randomUUID() };
    const MAX_PHOTOS_PER_JOB = 20;
    
    let newIndex = -1;
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === activeJobId) {
          const currentPhotos = job.photos || [];
          if (currentPhotos.length >= MAX_PHOTOS_PER_JOB) {
            alert(`각 작업당 참고 사진은 최대 ${MAX_PHOTOS_PER_JOB}장까지 첨부할 수 있습니다.`);
            return job;
          }
          const newPhotos = [...currentPhotos, capturedImageInfo];
          newIndex = currentPhotos.length; // Index of the new photo
          return { ...job, photos: newPhotos };
        }
        return job;
      })
    );
    
    setAnalysisStatusForPhotos(prevStatus => {
        const newStatus = { ...prevStatus };
        if (activeJobId) {
            delete newStatus[activeJobId];
        }
        return newStatus;
    });

    if (newIndex !== -1) {
      setCurrentPhotoIndexOfActiveJob(newIndex);
    }
    setIsCameraOpen(false);
    resetSubmissionState();
  }, [activeJobId, resetSubmissionState]);

  const handleCloseCamera = useCallback(() => {
      setIsCameraOpen(false);
  }, []);

  const handleActiveJobPhotosSet = useCallback((images: ImageInfo[]) => {
    if (!activeJobId) return;
    if (images.length === 0) return;

    const MAX_PHOTOS_PER_JOB = 20;
    const photosWithId: JobPhoto[] = images.map(img => ({...img, uid: self.crypto.randomUUID()}));

    let wasInitialSet = false;

    setJobs(prevJobs => prevJobs.map(job => {
        if (job.id === activeJobId) {
            wasInitialSet = job.photos.length === 0;
            const combined = [...job.photos, ...photosWithId];
            
            const uniqueImageMap = new Map<string, JobPhoto>();
            combined.forEach(img => {
                const key = `${img.file.name}-${img.file.size}-${img.file.lastModified}`;
                if (!uniqueImageMap.has(key)) {
                    uniqueImageMap.set(key, img);
                }
            });
            let finalPhotos = Array.from(uniqueImageMap.values());

            if (finalPhotos.length > MAX_PHOTOS_PER_JOB) {
                alert(`각 작업당 참고 사진은 최대 ${MAX_PHOTOS_PER_JOB}장까지 첨부할 수 있습니다. 초과된 사진은 제외됩니다.`);
                finalPhotos = finalPhotos.slice(0, MAX_PHOTOS_PER_JOB);
            }
            return { ...job, photos: finalPhotos };
        }
        return job;
    }));

    setAnalysisStatusForPhotos(prevStatus => {
        const newStatus = { ...prevStatus };
        if (activeJobId) delete newStatus[activeJobId];
        return newStatus;
    });

    if (wasInitialSet) {
        setCurrentPhotoIndexOfActiveJob(images.length > 0 ? 0 : -1);
    }
    resetSubmissionState();
    setQuickAnalysisFeedback(null);
  }, [activeJobId, resetSubmissionState]);

  const handleDeleteActiveJobImage = useCallback((indexToDelete: number) => {
    if (!activeJobId || indexToDelete < 0) return;

    const currentJob = jobs.find(j => j.id === activeJobId);
    if (!currentJob || indexToDelete >= currentJob.photos.length) return;
    
    const deletedPhotoUid = currentJob.photos[indexToDelete].uid;
    const currentPhotoIndex = currentPhotoIndexOfActiveJob;
    const newPhotos = currentJob.photos.filter((_, index) => index !== indexToDelete);

    let newCurrentIndex = -1;
    if (newPhotos.length === 0) {
        newCurrentIndex = -1;
    } else if (currentPhotoIndex >= newPhotos.length) {
        newCurrentIndex = newPhotos.length - 1;
    } else if (currentPhotoIndex > indexToDelete) {
        newCurrentIndex = currentPhotoIndex - 1;
    } else {
        newCurrentIndex = currentPhotoIndex;
    }

    setJobs(prevJobs => prevJobs.map(job => {
        if (job.id === activeJobId) {
            const newComments = {...job.photoComments};
            delete newComments[deletedPhotoUid];
            return { ...job, photos: newPhotos, photoComments: newComments };
        }
        return job;
    }));
    setCurrentPhotoIndexOfActiveJob(newCurrentIndex);

    setAnalysisStatusForPhotos(prevStatus => {
      const newStatus = { ...prevStatus };
      if (activeJobId) delete newStatus[activeJobId];
      return newStatus;
    });
  }, [activeJobId, jobs, currentPhotoIndexOfActiveJob]);


  const handleClearActiveJobPhotos = () => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job =>
        job.id === activeJobId ? { ...job, photos: [], photoComments: {} } : job
    ));
    setAnalysisStatusForPhotos(prevStatus => {
        const newStatus = { ...prevStatus };
        if (activeJobId) {
            delete newStatus[activeJobId];
        }
        return newStatus;
    });
    setCurrentPhotoIndexOfActiveJob(-1);
    if (activeJobFileInputRef.current) {
        activeJobFileInputRef.current.value = '';
    }
    resetSubmissionState();
    setQuickAnalysisFeedback(null);
  };

  const handleAddJob = () => {
    const baseNum = newJobBaseReceiptNumber.trim();
    const suffixNum = newJobSuffixReceiptNumber.trim();

    if (!baseNum || !suffixNum || !newJobMainItemKey) {
      alert("새 작업에 대한 접수번호 (공통 및 세부)와 주요 항목을 모두 입력/선택해주세요.");
      return;
    }

    const fullReceiptNumber = `${baseNum}-${suffixNum}`;

    const newChecklist: Record<string, StructuralCheckSubItemData> = {};
    CHECKLIST_DEFINITIONS[newJobMainItemKey].forEach(itemName => {
      let defaultNotes = '';
      if (itemName === "정도검사 증명서") {
        const initialCertDetails: CertificateDetails = {
            presence: 'not_selected',
            productName: '',
            manufacturer: '',
            serialNumber: '',
            typeApprovalNumber: '',
            inspectionDate: '',
            validity: '',
            previousReceiptNumber: '', 
            specialNotes: ''
        };
        defaultNotes = JSON.stringify(initialCertDetails);
      } else if (itemName === "측정방법확인" && newJobMainItemKey !== 'TOC') { // TOC will not have default for special items.
        switch (newJobMainItemKey) {
          case 'TN':
            defaultNotes = "자외선 흡수법";
            break;
          case 'TP':
            defaultNotes = "흡수분광법";
            break;
          case 'SS':
            defaultNotes = "광산란법";
            break;
          case 'PH':
            defaultNotes = "유리전극법";
            break;
          default:
            const methodOpts = MEASUREMENT_METHOD_OPTIONS[newJobMainItemKey as MainStructuralItemKey];
            if (methodOpts && methodOpts.length > 0 && methodOpts[0] !== ANALYSIS_IMPOSSIBLE_OPTION && methodOpts[0] !== OTHER_DIRECT_INPUT_OPTION) {
            } else {
              defaultNotes = '';
            }
        }
      }
      newChecklist[itemName] = { status: '선택 안됨', notes: defaultNotes, confirmedAt: null, specialNotes: '' };
    });

    if (newJobMainItemKey === 'PH') {
        if (newChecklist["측정범위확인"]) {
            newChecklist["측정범위확인"].notes = "pH 0-14";
        }
    } else if (newJobMainItemKey === 'TU') {
        if (newChecklist["측정범위확인"]) {
            newChecklist["측정범위확인"].notes = "0-10 NTU";
        }
        if (newChecklist["측정방법확인"]) {
            newChecklist["측정방법확인"].notes = "산란된 빛 검출";
        }
    } else if (newJobMainItemKey === 'Cl') {
      if (newChecklist["측정범위확인"]) {
        newChecklist["측정범위확인"].notes = "0-2 mg/L";
      }
    }

    const defaultPostInspectionDate = ['PH', 'TU', 'Cl'].includes(newJobMainItemKey)
      ? "2년 후"
      : POST_INSPECTION_DATE_OPTIONS[0];

    const newJobToAdd: StructuralJob = {
      id: self.crypto.randomUUID(),
      receiptNumber: fullReceiptNumber,
      mainItemKey: newJobMainItemKey,
      checklistData: newChecklist,
      photos: [],
      photoComments: {},
      postInspectionDate: defaultPostInspectionDate,
      postInspectionDateConfirmedAt: defaultPostInspectionDate === POST_INSPECTION_DATE_OPTIONS[0] ? null : getCurrentTimestamp(),
    };
    setJobs(prevJobs => [...prevJobs, newJobToAdd]);
    setActiveJobId(newJobToAdd.id);

    // UX Improvement: Auto-increment suffix for the next job
    const nextSuffix = (parseInt(suffixNum, 10) || 0) + 1;
    setNewJobSuffixReceiptNumber(String(nextSuffix));
    
    setNewJobMainItemKey('');
    resetSubmissionState();
  };

  const handleRemoveJob = (jobIdToRemove: string) => {
    setJobs(prevJobs => prevJobs.filter(job => job.id !== jobIdToRemove));
    setAnalysisStatusForPhotos(prevStatus => {
        const newStatus = { ...prevStatus };
        delete newStatus[jobIdToRemove];
        return newStatus;
    });
    if (activeJobId === jobIdToRemove) {
      setActiveJobId(jobs.length > 1 ? jobs.find(j => j.id !== jobIdToRemove)?.id || null : null);
    }
    resetSubmissionState();
  };

  const handleChecklistItemChange = (
    jobId: string,
    itemName: string,
    field: 'status' | 'notes' | 'specialNotes',
    value: ChecklistStatus | string
  ) => {
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === jobId) {
          const updatedItemData = { ...job.checklistData[itemName] };

          if (field === 'status') {
            const newStatus = value as ChecklistStatus;
            updatedItemData.status = newStatus;
            if (newStatus === '적합' || newStatus === '부적합') {
              updatedItemData.confirmedAt = getCurrentTimestamp();
            }
            if (job.mainItemKey === 'TU' && itemName === '세척 기능') {
              if (newStatus === '적합') {
                updatedItemData.specialNotes = '있음';
              } else if (newStatus === '부적합') {
                updatedItemData.specialNotes = '없음';
              } else {
                updatedItemData.specialNotes = '';
              }
            }
          } else if (field === 'notes') {
            updatedItemData.notes = value as string;
          } else if (field === 'specialNotes') {
            updatedItemData.specialNotes = value as string;
          }

          return {
            ...job,
            checklistData: {
              ...job.checklistData,
              [itemName]: updatedItemData,
            },
          };
        }
        return job;
      })
    );
    resetSubmissionState();
  };

  const handlePhotoCommentChange = useCallback((photoUid: string, comment: string) => {
    if (!activeJobId) return;
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === activeJobId) {
          return {
            ...job,
            photoComments: {
              ...job.photoComments,
              [photoUid]: comment,
            },
          };
        }
        return job;
      })
    );
  }, [activeJobId]);


  const handlePostInspectionDateChange = (jobId: string, newDateValue: string) => {
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === jobId) {
          return {
            ...job,
            postInspectionDate: newDateValue,
            postInspectionDateConfirmedAt: newDateValue === POST_INSPECTION_DATE_OPTIONS[0] ? null : getCurrentTimestamp(),
          };
        }
        return job;
      })
    );
    resetSubmissionState();
  };


  const handleSetAllSuitableForActiveJob = useCallback(() => {
    if (!activeJobId) return;
    const timestamp = getCurrentTimestamp();
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === activeJobId) {
          const updatedChecklistData: Record<string, StructuralCheckSubItemData> = {};
          Object.keys(job.checklistData).forEach(itemName => {
            if (job.mainItemKey === 'TOC' && (itemName === EMISSION_STANDARD_ITEM_NAME || itemName === RESPONSE_TIME_ITEM_NAME)) {
              // For special TOC items, don't change status or confirmedAt, keep notes
              updatedChecklistData[itemName] = job.checklistData[itemName];
            } else {
              updatedChecklistData[itemName] = {
                ...job.checklistData[itemName],
                status: '적합',
                confirmedAt: timestamp,
              };
              if (job.mainItemKey === 'TU' && itemName === '세척 기능') {
                updatedChecklistData[itemName].specialNotes = '있음';
              }
            }
          });
          return { ...job, checklistData: updatedChecklistData };
        }
        return job;
      })
    );
    resetSubmissionState();
    setQuickAnalysisFeedback(null);
  }, [activeJobId, resetSubmissionState]);

  const handleAnalyzeChecklistItemDetail = useCallback(async (
    jobIdToAnalyze: string,
    mainItemKeyForAnalysis: MainStructuralItemKey,
    photosToAnalyze: JobPhoto[],
    itemNameForAnalysis: AnalysisType,
    isQuickAnalysis: boolean = false
  ) => {
    if (!photosToAnalyze || photosToAnalyze.length === 0) {
      const errorMsg = `판별을 위해 먼저 현재 작업에 사진을 첨부해주세요.`;
      if (isQuickAnalysis) {
        setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: errorMsg, type: 'error' });
      } else {
        setDetailAnalysisError(errorMsg);
      }
      return;
    }

    const photoToProcess = photosToAnalyze[0]; 


    let itemOptionsForCurrentAnalysis: string[] | undefined;
    if (itemNameForAnalysis === "측정방법확인") {
        itemOptionsForCurrentAnalysis = MEASUREMENT_METHOD_OPTIONS[mainItemKeyForAnalysis];
    } else if (itemNameForAnalysis === "측정범위확인") {
        itemOptionsForCurrentAnalysis = MEASUREMENT_RANGE_OPTIONS[mainItemKeyForAnalysis];
    }
    
    let currentPrompt: string = "";
    let modelConfigForCall: GenerateContentParameters['config'] | undefined = undefined;
    const mainItemDisplayName = MAIN_STRUCTURAL_ITEMS.find(it => it.key === mainItemKeyForAnalysis)?.name || mainItemKeyForAnalysis;


    if ((itemNameForAnalysis === "측정방법확인" || itemNameForAnalysis === "측정범위확인") && (!itemOptionsForCurrentAnalysis || itemOptionsForCurrentAnalysis.length === 0)) {
      const errorMsg = `이 항목(${itemNameForAnalysis})에 대해 정의된 옵션이 없습니다.`;
       if (isQuickAnalysis) {
        setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: errorMsg, type: 'error' });
      } else {
        setDetailAnalysisError(errorMsg);
      }
      return;
    }

    if (isQuickAnalysis) {
      setQuickAnalysisTarget(itemNameForAnalysis);
      setQuickAnalysisFeedback(null);
    }
    setIsAnalyzingDetail(true);
    setDetailAnalysisError(null);

    let analysisErrorForFeedback: string | null = null;
    let autoComment = '';

    try {
      if (itemNameForAnalysis === "측정방법확인") {
        autoComment = "측정방법";
        const actualMethodOptions = itemOptionsForCurrentAnalysis?.filter(opt => opt !== OTHER_DIRECT_INPUT_OPTION && opt !== ANALYSIS_IMPOSSIBLE_OPTION) || [];
        const promptOptionsStringForDisplay = actualMethodOptions.join(' / ');

        currentPrompt = `**주요 분석 항목: ${mainItemDisplayName}**

이번 작업은 제공된 사진 속 "${mainItemDisplayName}" 항목의 **측정 방법**을 식별하는 것입니다. 당신의 목표는 다음 제시된 **사전 정의된 측정 방법 옵션 목록** 중에서 사진의 내용과 가장 적합한 측정 방법을 선택하거나, 확실하게 판단할 수 없는 경우 "${ANALYSIS_IMPOSSIBLE_OPTION}"을 반환하는 것입니다.

**사전 정의된 측정 방법 옵션 목록 (이 중에서만 선택해야 합니다):**
[${promptOptionsStringForDisplay}]

**지침 (매우 주의 깊게 따라주세요):**

1.  **판단 우선 순위 및 기본 원칙:**
    *   **명확한 텍스트 증거 최우선:** 사진에서 측정 방법을 **명시적으로 나타내는 텍스트**(예: 장비 라벨, 화면 표시)가 있다면 이를 최우선으로 사용합니다.
    *   **강력한 시각적 단서 활용:** 텍스트 증거가 없더라도, **${mainItemDisplayName} 측정 장비에 대한 일반적인 지식과 사진 속 명백하고 혼동의 여지가 없는 시각적 단서**(예: ${mainItemDisplayName} 측정에만 사용되는 매우 특징적인 센서 모양, 특정 시약병의 색상이나 라벨 일부 등)를 통해 합리적인 추론이 가능하다면 판단을 시도해주세요.
    *   **불확실하거나 증거 부족 시:** 위 두 경우에 해당하지 않거나, 추론의 근거가 약하다고 판단되면 **"${ANALYSIS_IMPOSSIBLE_OPTION}"** 을 반환하세요. 단순히 가능성이 있다는 이유만으로 추측하는 것은 피해야 합니다.

2.  **정보 분석 및 옵션 매칭:**
    *   위 1번 규칙을 통해 얻은 **명확한 텍스트 정보 또는 강력한 시각적 단서**를 바탕으로, 해당 측정 방법이 위에서 제시된 **사전 정의된 측정 방법 옵션 목록** 중 하나와 **정확히 일치하거나 가장 가깝다고 판단**된다면, 그 옵션 문자열 **하나만** 반환하세요.
    *   만약 제공된 **사전 정의된 측정 방법 옵션 목록** 중 어느 것과도 명확히 일치시키기 어렵거나, 사진에서 관련 정보를 전혀 찾을 수 없다면, 반드시 "${ANALYSIS_IMPOSSIBLE_OPTION}"이라고만 응답하세요. **옵션 목록에 없는 다른 방법은 제시하지 마세요.**

3.  **최종 점검:**
    *   위 규칙들을 모두 적용한 후에도 측정 방법을 명확히 식별할 수 없다면 (즉, 1번 규칙의 '불확실하거나 증거 부족 시' 조건이 적용되는 경우), 응답은 반드시 "${ANALYSIS_IMPOSSIBLE_OPTION}" 이어야 합니다.

**응답 형식 (매우 중요):**
- 귀하의 응답은 반드시 위 규칙에 따른 결과 문자열 중 **하나**여야 합니다 (즉, **사전 정의된 측정 방법 옵션 목록** 중 하나 또는 "${ANALYSIS_IMPOSSIBLE_OPTION}").
- 응답에는 그 외 어떠한 추가 설명, 부연, 소개, 노트, 마크다운(\`\`\`)도 포함해서는 **절대 안 됩니다.**
- 오직 요구된 형식의 문자열 하나만을 반환해주세요.`;
      } else if (itemNameForAnalysis === "정도검사 증명서") {
        autoComment = "정도검사 증명서";
        currentPrompt = `귀하는 매우 정확한 데이터 추출 AI입니다. 귀하의 임무는 제공된 "${mainItemDisplayName}" 장비의 '정도검사 증명서' 이미지에서 특정 세부 정보를 추출하는 것입니다.

**정보 추출 규칙 (매우 중요):**

1.  **문서 유형 확인:** 먼저, 이미지가 '정도검사 증명서'가 맞는지 제목이나 내용을 통해 확인합니다.
2.  **항목 관련성 확인:** 다음으로, 이 증명서가 "${mainItemDisplayName}" 항목과 관련된 것인지 '품명', '기기명칭', '측정항목' 등의 필드에서 확인합니다. 만약 관련이 없다면, 모든 필드를 null로 하여 빈 JSON 객체에 가까운 응답을 반환하세요.
3.  **필드 추출 (관련성이 확인된 경우):**
    *   \`product_name\`: '품명' 또는 '모델명' 필드에서 값을 추출합니다. (예: 'DWMS-CM')
    *   \`manufacturer\`: '제작사' 또는 '제조사' 필드에서 값을 추출합니다. (예: 'KORBI')
    *   \`serial_number\`: '기기번호' 또는 '제작번호', 'S/N' 필드에서 값을 추출합니다. (예: 'KHG2O017')
    *   \`type_approval_number\`: '형식승인번호' 필드에서 값을 추출합니다. '제'와 '호'를 포함할 수 있습니다. (예: '제WTMS-CODmn-2022-2호')
    *   \`inspection_date\`: '검사일자' 또는 '발행일' 필드에서 값을 추출합니다. 반드시 'YYYY-MM-DD' 형식으로 변환해주세요. (예: '2024년 01월 15일' -> '2024-01-15')
    *   \`validity_period\`: '유효기간' 필드에서 값을 추출합니다. '다음 검사일' 또는 만료일을 나타냅니다. 반드시 'YYYY-MM-DD' 형식으로 변환해주세요.
    *   \`previous_receipt_number\`: 증명서 상단의 가장 눈에 띄는 주요 번호를 '직전 접수번호'로 간주하여 추출합니다. 보통 '제 ... 호' 형식입니다. (예: '제21-018279-02-77호')
4.  **정보 부재 시:** 특정 필드의 값을 읽을 수 없거나 문서에 존재하지 않는 경우, JSON 응답에서 해당 키를 생략하거나 값을 \`null\`로 설정하세요.

**출력 형식 (반드시 준수):**

- 귀하의 전체 응답은 반드시 제공된 스키마를 준수하는 **단일 JSON 객체**여야 합니다.
- 응답은 \`{\`로 시작해서 \`}\`로 끝나야 합니다.
- 응답에 \`\`\`json\`\`\`과 같은 마크다운 구분 기호나 JSON 객체 외부의 텍스트, 설명, 주석을 **절대 포함하지 마세요.**
`;
       modelConfigForCall = {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              previous_receipt_number: { type: Type.STRING, description: "The main certificate number, numbers and hyphens only." },
              product_name: { type: Type.STRING, description: "The model name." },
              manufacturer: { type: Type.STRING, description: "The manufacturer." },
              serial_number: { type: Type.STRING, description: "The device serial number." },
              type_approval_number: { type: Type.STRING, description: "The type approval number." },
              inspection_date: { type: Type.STRING, description: "Date of inspection, YYYY-MM-DD." },
              validity_period: { type: Type.STRING, description: "Expiration date, YYYY-MM-DD." },
            },
          }
        };
      } else if (itemNameForAnalysis === "표시사항확인") {
        autoComment = "표시사항";
        let keywords: string = mainItemKeyForAnalysis;
        switch (mainItemKeyForAnalysis) {
            case 'TN':
                keywords = 'TN, WTMS-TN, TPNA-500N, 질소';
                break;
            case 'TP':
                keywords = 'TP, WTMS-TP, TPNA-500P, 인';
                break;
            case 'Cl':
                keywords = 'Cl, 잔류염소, DWMS-CM';
                break;
            case 'TU':
                keywords = 'TU, 탁도, DWMS-TM';
                break;
        }

        currentPrompt = `귀하는 장비 라벨 전문가입니다. 귀하의 임무는 이미지에서 "${mainItemDisplayName}" 장비의 '표시사항' 라벨을 찾아 특정 정보를 추출하는 것입니다. 이 라벨에는 "${keywords}"와 같은 키워드가 포함될 수 있습니다.

**정보 추출 규칙 (매우 중요):**

1.  **정확한 라벨 찾기:** 먼저 이미지 내 여러 라벨 중에서 "${mainItemDisplayName}"에 해당하는 '표시사항' 라벨을 정확히 식별합니다.
2.  **키-값 쌍 추출:** 식별된 라벨에서 다음 키에 해당하는 값을 정확하게 추출합니다:
    *   "제조회사"
    *   "기기형식"
    *   "형식승인번호"
    *   "형식승인일"
    *   "기기고유번호"
3.  **값 처리:**
    *   각 키에 대한 값을 최대한 정확하게 읽어주세요.
    *   값이 여러 줄에 걸쳐 있더라도 하나의 문자열로 합쳐주세요.
    *   '형식승인일'은 가능한 경우 'YYYY-MM-DD' 형식으로 변환해주세요.
4.  **정보 부재 시:**
    *   라벨을 찾을 수 없거나 특정 정보가 라벨에 없는 경우, JSON 응답에서 해당 키를 생략하거나 값을 \`null\`로 설정하세요.
    *   라벨에서 어떠한 정보도 추출할 수 없는 경우, 빈 JSON 객체 \`{}\`를 반환하세요.

**출력 형식 (반드시 준수):**

- 귀하의 전체 응답은 반드시 제공된 스키마를 준수하는 **단일 JSON 객체**여야 합니다.
- 응답은 \`{\`로 시작해서 \`}\`로 끝나야 합니다.
- 응답에 \`\`\`json\`\`\`과 같은 마크다운 구분 기호나 JSON 객체 외부의 텍스트, 설명, 주석을 **절대 포함하지 마세요.**
`;
        modelConfigForCall = { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
                "제조회사": { type: Type.STRING },
                "기기형식": { type: Type.STRING },
                "형식승인번호": { type: Type.STRING },
                "형식승인일": { type: Type.STRING },
                "기기고유번호": { type: Type.STRING }
            },
          }
        }; 
      } else if (itemNameForAnalysis === "측정범위확인") {
        autoComment = "측정범위";
        const promptOptionsString = itemOptionsForCurrentAnalysis!.filter(opt => opt !== OTHER_DIRECT_INPUT_OPTION && opt !== ANALYSIS_IMPOSSIBLE_OPTION).join(' / ');
        currentPrompt = `제공된 장비 화면 이미지에서 "${mainItemDisplayName}" 항목의 "측정 범위" 정보를 찾아주세요.

**매우 중요 지침 (순서대로 엄격히 적용):**

1.  **"측정 범위" 또는 "Range" 레이블 검색:**
    *   이미지에서 **"측정 범위"(띄어쓰기 유무 무관, 예: "측정범위", "측정 범위") 또는 영문 "Range" 라는 레이블을 정확히 찾으세요.** 이 레이블은 보통 "교정값 정보" 또는 유사한 섹션 내에 있을 수 있습니다.
    *   **만약 위에서 언급된 정확한 레이블을 이미지에서 명확히 찾을 수 없다면, 다른 숫자들을 바탕으로 추측하지 말고 반드시 "${ANALYSIS_IMPOSSIBLE_OPTION}"으로 응답해야 합니다.** 특히, "배출허용기준" 표에 있는 값이나 다른 설정 값 목록은 "측정 범위"가 아닙니다.

2.  **레이블 확인 후 값 추출 및 해석:**
    *   **정확한 "측정 범위" (또는 "Range") 레이블을 찾았다면, 해당 레이블 바로 옆이나 아래에 표시된 실제 값(이하 "관찰된 값")을 식별하세요.**
    *   **관찰된 값 해석 규칙 (중요):**
        *   만약 관찰된 값이 **단일 숫자** (예: "100.00", "50", "0.1")로 표시된 경우, 이는 **"0"부터 해당 숫자까지의 범위**를 의미하는 것으로 간주합니다. (예: "100.00"은 "0-100.00" 범위로 해석, "0.1"은 "0-0.1" 범위로 해석). 단위는 명시되어 있다면 함께 고려합니다 (예: "100.00 mg/L"는 "0-100.00 mg/L"로 해석).
        *   만약 관찰된 값이 명시적인 범위 (예: "0-50", "0 ~ 100 mg/L", "10 ~ 200 ppm")로 표시된 경우, 그대로 사용합니다.

3.  **응답 결정 (해석된 값을 바탕으로):**
    *   위 2번에서 해석된 값을 가지고 다음 규칙에 따라 응답을 결정하세요:
        *   **규칙 A (사전 정의된 옵션과 일치):** 해석된 값이 다음 사전 정의된 옵션 목록 중 하나와 **의미상 및 수치상으로 정확히 일치**한다면 (단위 및 띄어쓰기는 유연하게 비교), 해당 옵션 문자열 **하나만을** 응답으로 사용하세요: [${promptOptionsString}].
            *   예: 옵션에 "0-100 mg/L"가 있고, 사진에서 레이블 옆에 "100.00 mg/L" (2번 규칙에 의해 "0-100.00 mg/L"로 해석됨) 또는 "0-100mg/L"가 관찰되면, "0-100 mg/L" 옵션로 응답합니다.
        *   **규칙 B (직접 입력 옵션 사용):** 해석된 값이 규칙 A의 옵션 목록에 없고, 그것이 명확히 식별된 유효한 숫자 범위(2번 규칙에 따른 해석 포함)라면, "${OTHER_DIRECT_INPUT_OPTION} (실제 관찰된 값 또는 해석된 범위 그대로)" 형식으로 응답하세요.
            *   예: 사진에서 "150.0" (즉, "0-150.0")이 관찰되고 옵션에 없다면, "${OTHER_DIRECT_INPUT_OPTION} (0-150.0)" 또는 "${OTHER_DIRECT_INPUT_OPTION} (0-150.0 mg/L)" (단위 포함 시)로 응답합니다.
            *   예: 사진에서 "10-200 ppm"이 관찰되고 옵션에 없다면, "${OTHER_DIRECT_INPUT_OPTION} (10-200 ppm)"으로 응답합니다.
        *   **규칙 C (판별 불가):** 위 조건(규칙 A, B)에 해당하지 않거나, "측정 범위" 또는 "Range" 레이블은 찾았으나 관련된 값을 명확히 식별/해석할 수 없다면, "${ANALYSIS_IMPOSSIBLE_OPTION}"이라고만 응답하세요.

**응답 형식 (반드시 준수):**
*   귀하의 응답은 반드시 위 3번 규칙에 따른 결과 문자열 중 **하나**여야 합니다.
*   응답에는 그 외 어떠한 추가 설명, 부연, 소개, 노트, 마크다운(\`\`\`)도 포함해서는 **절대 안 됩니다.**
*   오직 요구된 형식의 문자열 하나만을 반환해주세요. (예: "0-50 mg/L", 또는 "${OTHER_DIRECT_INPUT_OPTION} (0-150.0)", 또는 "${ANALYSIS_IMPOSSIBLE_OPTION}")
`;
      } else if (itemNameForAnalysis === "운용프로그램확인") {
         autoComment = "운용프로그램";
         currentPrompt = `You are a highly specialized AI assistant for extracting version numbers. Your ONLY task is to find a program version number in the image that consists of **exactly 12 consecutive digits (0-9)**.

**Rules (Strictly follow):**

1.  **Primary Target:** Look for the label "Program No." and check if the value next to it is a 12-digit number.
2.  **Secondary Search:** If the primary target is not found, scan the entire image for any other string that is exactly 12 consecutive digits.
3.  **Failure Condition:** If you cannot find any string that is exactly 12 digits long (and contains only numbers), your response MUST be the exact string: "${ANALYSIS_IMPOSSIBLE_OPTION}".
4.  **Exclusions:** Do NOT return version numbers in other formats like "Ver. 1.0.2" or "V1.23.A". If you see these but not a 12-digit number, you must still return "${ANALYSIS_IMPOSSIBLE_OPTION}".

**CRITICAL: Output Format**

- Your response must be EITHER the 12-digit number OR the exact string "${ANALYSIS_IMPOSSIBLE_OPTION}".
- **ABSOLUTELY DO NOT** include any other text, labels, explanations, or markdown formatting.
`;
      } else if (itemNameForAnalysis === "지시부 번호") {
        autoComment = "지시부 번호";
        currentPrompt = `이미지에서 측정 장비의 지시부(display unit)를 찾으세요. 'S/N', 'Serial No.', '기기번호', '제조번호' 또는 이와 유사한 레이블이 붙은 시리얼 번호나 기기 번호를 찾아주세요. 오직 숫자와 영문자로 구성된 번호 자체만 추출하고, 레이블이나 다른 텍스트는 포함하지 마세요. 번호를 찾을 수 없으면 "${ANALYSIS_IMPOSSIBLE_OPTION}"이라고만 응답하세요.`;
      } else if (itemNameForAnalysis === "센서부 번호") {
        autoComment = "센서부 번호";
        currentPrompt = `이미지에서 측정 장비의 센서부(sensor unit)를 찾으세요. 센서에 부착된 라벨이나 각인에서 시리얼 번호나 기기 번호를 찾아주세요. 오직 숫자와 영문자로 구성된 번호 자체만 추출하고, 레이블이나 다른 텍스트는 포함하지 마세요. 번호를 찾을 수 없으면 "${ANALYSIS_IMPOSSIBLE_OPTION}"이라고만 응답하세요.`;
      }

      let resultText = (await extractTextFromImage(photoToProcess.base64, photoToProcess.mimeType, currentPrompt, modelConfigForCall)).trim();

      if (itemNameForAnalysis === "지시부 번호" || itemNameForAnalysis === "센서부 번호") {
          const jobToUpdate = jobs.find(j => j.id === jobIdToAnalyze);
          if (jobToUpdate) {
              const currentNotes = jobToUpdate.checklistData["기기번호 확인"]?.notes || '';
              const parts = currentNotes.split(',').map(p => p.trim());
              const newResult = resultText !== ANALYSIS_IMPOSSIBLE_OPTION ? resultText.trim().replace(/,/g, '') : '';
      
              let displayPart = parts[0] || '';
              let sensorPart = parts.length > 1 ? parts[1] : '';
      
              if (itemNameForAnalysis === "지시부 번호") {
                  // If we're setting the display part, and there's currently only one part,
                  // assume that single part was the sensor part, based on user workflow.
                  if (parts.length === 1 && displayPart !== '' && sensorPart === '') {
                      sensorPart = displayPart;
                  }
                  displayPart = newResult;
              } else { // "센서부 번호"
                  // If we're setting the sensor part, any single existing part is assumed to be the display part.
                  sensorPart = newResult;
              }
              
              const newNotes = [displayPart, sensorPart].map(p => p.trim()).filter(Boolean).join(', ');
              
              handleChecklistItemChange(jobIdToAnalyze, "기기번호 확인", "notes", newNotes);
          }
      } else if (itemNameForAnalysis === "정도검사 증명서") {
          const jobToUpdate = jobs.find(j => j.id === jobIdToAnalyze);
          if (jobToUpdate) {
              const currentNotes = jobToUpdate.checklistData[itemNameForAnalysis]?.notes;
              let certDetails: CertificateDetails = { 
                presence: 'not_selected', 
                specialNotes: jobToUpdate.checklistData[itemNameForAnalysis]?.specialNotes || '' , 
                previousReceiptNumber: '' 
              };
              try {
                  if (currentNotes && currentNotes.trim().startsWith("{")) {
                     const parsed = JSON.parse(currentNotes);
                     certDetails = { ...certDetails, ...parsed }; 
                  }
              } catch (e) { console.warn("Could not parse current certificate notes"); }

              let parsedAiResponse: {
                product_name?: string | null;
                manufacturer?: string | null;
                serial_number?: string | null;
                type_approval_number?: string | null;
                inspection_date?: string | null;
                validity_period?: string | null;
                previous_receipt_number?: string | null;
              } = {};
              try {
                let jsonStr = resultText;
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                    jsonStr = match[2].trim();
                }
                parsedAiResponse = JSON.parse(jsonStr);
              } catch (parseError: any) {
                analysisErrorForFeedback = `AI 응답 파싱 실패: ${parseError.message}. 응답: ${resultText}`;
              }

              const { product_name, manufacturer, serial_number, type_approval_number, inspection_date, validity_period, previous_receipt_number } = parsedAiResponse;
              let foundAnyDetail = false;

              if (product_name && product_name !== ANALYSIS_IMPOSSIBLE_OPTION) { certDetails.productName = product_name; foundAnyDetail = true; }
              if (manufacturer && manufacturer !== ANALYSIS_IMPOSSIBLE_OPTION) { certDetails.manufacturer = manufacturer; foundAnyDetail = true; }
              if (serial_number && serial_number !== ANALYSIS_IMPOSSIBLE_OPTION) { certDetails.serialNumber = serial_number; foundAnyDetail = true; }
              
              let finalPrevReceiptNumberCleaned = previous_receipt_number;
              if (finalPrevReceiptNumberCleaned && typeof finalPrevReceiptNumberCleaned === 'string') {
                  let tempNum = finalPrevReceiptNumberCleaned.trim();
                   if (tempNum.startsWith("제")) {
                      tempNum = tempNum.substring(1).trim();
                  }
                  if (tempNum.endsWith("호")) {
                      tempNum = tempNum.substring(0, tempNum.length - 1).trim();
                  }
                  finalPrevReceiptNumberCleaned = tempNum;
              }
              if (finalPrevReceiptNumberCleaned && finalPrevReceiptNumberCleaned !== ANALYSIS_IMPOSSIBLE_OPTION) {
                  certDetails.previousReceiptNumber = finalPrevReceiptNumberCleaned;
                  foundAnyDetail = true;
              }

              let finalTypeApprovalNumber = type_approval_number;
              if (finalTypeApprovalNumber && typeof finalTypeApprovalNumber === 'string' && finalTypeApprovalNumber.trim() !== '') {
                  let tempNum = finalTypeApprovalNumber.trim();
                  if (!tempNum.startsWith("제")) {
                      tempNum = `제${tempNum}`;
                  }
                  if (!tempNum.endsWith("호")) {
                      tempNum = `${tempNum}호`;
                  }
                  finalTypeApprovalNumber = tempNum;
              }

              if (finalTypeApprovalNumber && finalTypeApprovalNumber !== ANALYSIS_IMPOSSIBLE_OPTION) {
                  certDetails.typeApprovalNumber = finalTypeApprovalNumber;
                  foundAnyDetail = true;
              }
              if (inspection_date && inspection_date !== ANALYSIS_IMPOSSIBLE_OPTION) { certDetails.inspectionDate = inspection_date; foundAnyDetail = true;}
              if (validity_period && validity_period !== ANALYSIS_IMPOSSIBLE_OPTION) { 
                certDetails.validity = validity_period; 
                foundAnyDetail = true; 
                try {
                    const validityDate = new Date(validity_period);
                    if (!isNaN(validityDate.getTime())) {
                        const now = new Date();
                        const oneYearFromNow = new Date(now);
                        oneYearFromNow.setFullYear(now.getFullYear() + 1);
                        const twoYearsFromNow = new Date(now);
                        twoYearsFromNow.setFullYear(now.getFullYear() + 2);
                        const tolerance = 60 * 24 * 60 * 60 * 1000;
                        const diffOneYear = Math.abs(validityDate.getTime() - oneYearFromNow.getTime());
                        const diffTwoYears = Math.abs(validityDate.getTime() - twoYearsFromNow.getTime());
                        if (diffOneYear < tolerance) {
                            handlePostInspectionDateChange(jobIdToAnalyze, "1년 후");
                        } else if (diffTwoYears < tolerance) {
                            handlePostInspectionDateChange(jobIdToAnalyze, "2년 후");
                        }
                    } else {
                        console.warn("Could not parse validity date for auto-setting post-inspection date:", validity_period);
                    }
                } catch(dateError) {
                    console.error("Error processing validity date:", dateError);
                }
              }
              
              if (foundAnyDetail && certDetails.presence === 'not_selected') {
                  certDetails.presence = 'present';
              }

              if (!foundAnyDetail && !analysisErrorForFeedback) { 
                 analysisErrorForFeedback = `AI가 증명서 정보를 찾지 못했습니다.`;
              }

              handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", JSON.stringify(certDetails));
          }
      } else if (itemNameForAnalysis === "표시사항확인") {
          try {
              let jsonString = resultText.trim();
              const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
              const match = jsonString.match(fenceRegex);
              if (match && match[2]) {
                  jsonString = match[2].trim();
              }
              
              const parsedData = JSON.parse(jsonString);

              if (Object.keys(parsedData).length === 0) {
                  analysisErrorForFeedback = `AI가 표시사항 정보를 사진에서 찾을 수 없습니다.`;
                  // Do not update notes, just show feedback
              } else {
                  const keyToCheck = "형식승인번호";
                  if (parsedData[keyToCheck] && typeof parsedData[keyToCheck] === 'string' && parsedData[keyToCheck].trim() !== '') {
                      let tempNum = parsedData[keyToCheck].trim();
                      if (!tempNum.startsWith("제")) {
                          tempNum = `제${tempNum}`;
                      }
                      if (!tempNum.endsWith("호")) {
                          tempNum = `${tempNum}호`;
                      }
                      parsedData[keyToCheck] = tempNum;
                  }
                  handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", JSON.stringify(parsedData));
              }

          } catch (parseError: any) {
              console.warn("표시사항확인 AI 응답이 JSON이 아니거나 파싱 실패:", parseError, "원본 응답:", resultText);
              analysisErrorForFeedback = `AI 응답 파싱 실패: ${parseError.message}. 응답: ${resultText}`;
          }
      } else if (itemNameForAnalysis === "운용프로그램확인") {
        handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", resultText);
      } else if (itemOptionsForCurrentAnalysis && itemNameForAnalysis === "측정방법확인") {
          const actualMethodOptions = itemOptionsForCurrentAnalysis.filter(opt => opt !== OTHER_DIRECT_INPUT_OPTION && opt !== ANALYSIS_IMPOSSIBLE_OPTION);
          const matchedOption = actualMethodOptions.find(opt => resultText === opt);

          if (matchedOption) {
              handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", matchedOption);
          } else if (resultText === ANALYSIS_IMPOSSIBLE_OPTION) {
              handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", ANALYSIS_IMPOSSIBLE_OPTION);
          } else {
              analysisErrorForFeedback = `AI가 측정 방법 옵션 중 하나를 명확히 식별하지 못했습니다. AI 응답: "${resultText}". "${ANALYSIS_IMPOSSIBLE_OPTION}"으로 설정되었습니다.`;
              handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", ANALYSIS_IMPOSSIBLE_OPTION);
          }
      } else if (itemOptionsForCurrentAnalysis && itemNameForAnalysis === "측정범위확인") {
          let processedValueForChecklist = resultText;

          if (resultText === ANALYSIS_IMPOSSIBLE_OPTION) {
              processedValueForChecklist = ANALYSIS_IMPOSSIBLE_OPTION;
          } else {
              let valueFromAiCore = resultText;
              if (resultText.startsWith(OTHER_DIRECT_INPUT_OPTION)) {
                  const matchInParentheses = resultText.match(/\(([^)]+)\)/);
                  if (matchInParentheses && matchInParentheses[1]) {
                      valueFromAiCore = matchInParentheses[1].trim();
                  }
              }

              const normalizedValueFromAiCore = valueFromAiCore.replace(/\s+/g, '');
              const matchedPredefinedOption = itemOptionsForCurrentAnalysis.find(opt => {
                  if (opt === OTHER_DIRECT_INPUT_OPTION || opt === ANALYSIS_IMPOSSIBLE_OPTION) return false;
                  return opt.replace(/\s+/g, '') === normalizedValueFromAiCore;
              });

              if (matchedPredefinedOption) {
                  processedValueForChecklist = matchedPredefinedOption;
              } else {
                  processedValueForChecklist = resultText;
              }
          }
          handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", processedValueForChecklist);
      }

      if (isQuickAnalysis && !analysisErrorForFeedback && jobIdToAnalyze && currentPhotoIndexOfActiveJob !== -1) {
        if (autoComment) {
            handlePhotoCommentChange(photoToProcess.uid, autoComment);
        }
        setAnalysisStatusForPhotos(prevStatus => {
            const newStatus = { ...prevStatus };
            if (!newStatus[jobIdToAnalyze]) {
                newStatus[jobIdToAnalyze] = {};
            }
            if (!newStatus[jobIdToAnalyze][currentPhotoIndexOfActiveJob]) {
                newStatus[jobIdToAnalyze][currentPhotoIndexOfActiveJob] = new Set();
            }
            newStatus[jobIdToAnalyze][currentPhotoIndexOfActiveJob].add(itemNameForAnalysis);
            return newStatus;
        });
      }


    } catch (error: any) {
      console.error(`Error analyzing ${itemNameForAnalysis}:`, error);
      let detailedErrorMessage = error.message || '알 수 없는 오류가 발생했습니다.';
      if (error instanceof SyntaxError) {
          detailedErrorMessage = `AI가 잘못된 형식의 데이터를 반환했습니다. 수동으로 입력하거나 다시 시도해주세요. (오류: ${error.message})`;
      } else if (error.message?.toLowerCase().includes('network')) {
          detailedErrorMessage = '네트워크 오류입니다. 인터넷 연결을 확인 후 다시 시도해주세요.';
      }
      analysisErrorForFeedback = `${itemNameForAnalysis} 분석 중 오류 발생: ${detailedErrorMessage}`;
      
      if (itemNameForAnalysis !== "표시사항확인" && itemNameForAnalysis !== "운용프로그램확인" && itemNameForAnalysis !== "정도검사 증명서" && itemNameForAnalysis !== "지시부 번호" && itemNameForAnalysis !== "센서부 번호") {
          handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", ANALYSIS_IMPOSSIBLE_OPTION);
      } else if (itemNameForAnalysis === "정도검사 증명서") {
          const jobToUpdate = jobs.find(j => j.id === jobIdToAnalyze);
           if (jobToUpdate) {
              const currentNotes = jobToUpdate.checklistData[itemNameForAnalysis]?.notes;
              let certDetails: CertificateDetails = { 
                presence: 'not_selected', 
                specialNotes: jobToUpdate.checklistData[itemNameForAnalysis]?.specialNotes || '' , 
                previousReceiptNumber: '' 
              };
              try {
                  if (currentNotes && currentNotes.trim().startsWith("{")) {
                     const parsed = JSON.parse(currentNotes);
                     certDetails = { ...certDetails, ...parsed };
                  }
              } catch (e) { /* ignore */ }
              handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", JSON.stringify(certDetails));
           }
      } else {
          const currentJob = jobs.find(j => j.id === jobIdToAnalyze);
          const currentNotesValue = currentJob?.checklistData[itemNameForAnalysis]?.notes;
          if (!currentNotesValue?.toLowerCase().includes("ai 분석 오류")) {
             handleChecklistItemChange(jobIdToAnalyze, itemNameForAnalysis, "notes", `AI 분석 결과 처리 오류: ${error.message}`);
          }
      }
    } finally {
      setIsAnalyzingDetail(false);
      if (isQuickAnalysis) {
        let feedbackMsg = `${itemNameForAnalysis} 판별 완료`;
         if ((itemNameForAnalysis === "표시사항확인" || itemNameForAnalysis === "운용프로그램확인" || itemNameForAnalysis === "정도검사 증명서" || itemNameForAnalysis === "지시부 번호" || itemNameForAnalysis === "센서부 번호") && !analysisErrorForFeedback) {
            feedbackMsg = `${MAIN_STRUCTURAL_ITEMS.find(it => it.key === mainItemKeyForAnalysis)?.name || mainItemKeyForAnalysis}의 ${itemNameForAnalysis} 판별 완료 (세부사항 확인)`;
        }

        if (analysisErrorForFeedback) {
          setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: analysisErrorForFeedback, type: 'error' });
        } else {
          setQuickAnalysisFeedback({ targetItemName: itemNameForAnalysis, message: feedbackMsg, type: 'success' });
        }
        setQuickAnalysisTarget(null);
      } else {
        setDetailAnalysisError(analysisErrorForFeedback);
      }
    }
  }, [handleChecklistItemChange, jobs, currentPhotoIndexOfActiveJob, handlePhotoCommentChange, handlePostInspectionDateChange]);


  const isBatchValidForSubmission = useMemo(() => {
    if (jobs.length === 0 || siteLocation.trim() === '') {
      return false;
    }
    return true;
  }, [jobs, siteLocation]);

  const generateChecklistImageForJob = async (job: StructuralJob): Promise<ImageInfo> => {
    const tempDiv = document.createElement('div');
    document.body.appendChild(tempDiv);
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '800px';
    tempDiv.style.fontFamily = 'Inter, sans-serif';

    let currentItemNumber = 0; // For standard checklist items

    const ChecklistCaptureComponent = (
      <div style={{ padding: '20px', backgroundColor: '#1f2937', color: 'white', border: '1px solid #374151' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#38bdf8', borderBottom: '1px solid #475569', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
          구조 확인 체크리스트: {job.receiptNumber} / {MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name}
        </h3>
        
        {job.postInspectionDate && job.postInspectionDate !== POST_INSPECTION_DATE_OPTIONS[0] && (
          <div style={{ padding: '0.5rem 0.25rem', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '40px' }}>
            <div style={{ flex: 1, marginRight: '1rem' }}>
              <span style={{ color: '#e5e7eb', fontWeight: 'bold' }}>사후검사일:</span>
              <span style={{ color: '#a5f3fc', marginLeft: '0.5rem', fontWeight: 500 }}>{job.postInspectionDate}</span>
              {job.postInspectionDateConfirmedAt && (
                <span style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'block', marginTop: '0.125rem' }}>
                  (확인: {job.postInspectionDateConfirmedAt})
                </span>
              )}
            </div>
          </div>
        )}

        {CHECKLIST_DEFINITIONS[job.mainItemKey].map((itemName) => {
          const itemData = job.checklistData[itemName];
          const isSpecialTocItemForImage = job.mainItemKey === 'TOC' && (itemName === EMISSION_STANDARD_ITEM_NAME || itemName === RESPONSE_TIME_ITEM_NAME);
          
          if (!isSpecialTocItemForImage) {
            currentItemNumber++;
          }

          let noteToDisplay = itemData?.notes || '';
          let specialNoteToDisplay = itemData?.specialNotes || '';

          if (itemName === "정도검사 증명서") {
            try {
              const certDetailsParsed: CertificateDetails = JSON.parse(noteToDisplay);
              let displayParts = [];
              if (certDetailsParsed.presence === 'present') displayParts.push("상태: 있음");
              else if (certDetailsParsed.presence === 'initial_new') displayParts.push("상태: 최초정도검사");
              else if (certDetailsParsed.presence === 'reissued_lost') displayParts.push("상태: 분실 후 재발행");
              
              if (certDetailsParsed.previousReceiptNumber) displayParts.push(`직전 접수번호: ${certDetailsParsed.previousReceiptNumber}`);
              if (certDetailsParsed.productName) displayParts.push(`품명: ${certDetailsParsed.productName}`);
              if (certDetailsParsed.manufacturer) displayParts.push(`제작사: ${certDetailsParsed.manufacturer}`);
              if (certDetailsParsed.serialNumber) displayParts.push(`제작번호: ${certDetailsParsed.serialNumber}`);
              if (certDetailsParsed.typeApprovalNumber) displayParts.push(`형식승인번호: ${certDetailsParsed.typeApprovalNumber}`);
              if (certDetailsParsed.inspectionDate) displayParts.push(`검사일자: ${certDetailsParsed.inspectionDate}`);
              if (certDetailsParsed.validity) displayParts.push(`유효기간: ${certDetailsParsed.validity}`);
              
              noteToDisplay = displayParts.join('; ');
              specialNoteToDisplay = certDetailsParsed.specialNotes || '';
            } catch (e) { /* use raw note if not parsable */ }
          } else if (itemName === "표시사항확인") {
            try {
                const parsedJson = JSON.parse(noteToDisplay);
                noteToDisplay = Object.entries(parsedJson).map(([key, value]) => `${key}: ${value}`).join('; ');
            } catch (e) { /* use raw note if not parsable */ }
          } else if (itemName === "측정방법확인" || itemName === "측정범위확인" || itemName === "운용프로그램확인" || itemName === "기기번호 확인") {
             const prefix = itemName === "측정방법확인" ? "방법" : itemName === "측정범위확인" ? "범위" : itemName === "운용프로그램확인" ? "버전/정보" : "기기번호";
             noteToDisplay = itemData?.notes && itemData.notes !== ANALYSIS_IMPOSSIBLE_OPTION && itemData.notes.trim() !== '' ? `${prefix}: ${noteToDisplay}` : `${prefix}: 정보 없음`;
          } else if (isSpecialTocItemForImage) {
             noteToDisplay = itemData?.notes && itemData.notes.trim() !== '' ? `${itemData.notes.trim()}` : '값 없음';
          }
          
          return (
          <div key={itemName} style={{ padding: '0.5rem 0.25rem', borderBottom: '1px solid #374151', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '40px' }}>
            <div style={{ flex: 1, marginRight: '1rem' }}>
              <div>
                {!isSpecialTocItemForImage && (
                    <span style={{ marginRight: '0.5rem', color: '#cbd5e1' }}>{currentItemNumber}.</span>
                )}
                <span style={{ color: '#e5e7eb', fontWeight: isSpecialTocItemForImage ? 600 : 'normal' }}>{itemName}</span>
              </div>
              {!isSpecialTocItemForImage && itemData?.confirmedAt && (
                <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: 'calc(0.5rem + 0.7ch)', display: 'block', marginTop: '0.125rem' }}>
                  (확인: {itemData.confirmedAt})
                </span>
              )}
               {noteToDisplay && (
                 <span style={{ fontSize: '0.8rem', color: isSpecialTocItemForImage ? '#67e8f9' : '#a5f3fc', marginLeft: isSpecialTocItemForImage ? '0' : 'calc(0.5rem + 0.7ch)', display: 'block', marginTop: '0.125rem', fontWeight: isSpecialTocItemForImage ? 600 : 500, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {noteToDisplay}
                  </span>
               )}
               {specialNoteToDisplay && !isSpecialTocItemForImage && (
                 <span style={{ fontSize: '0.8rem', color: '#fcd34d', marginLeft: 'calc(0.5rem + 0.7ch)', display: 'block', marginTop: '0.125rem', fontWeight: 500, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    특이사항: {specialNoteToDisplay}
                  </span>
               )}
            </div>
            {!isSpecialTocItemForImage && (
                <span style={{
                    padding: '0.375rem 0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'white',
                    backgroundColor: itemData?.status === '적합' ? '#22c55e' :
                                    itemData?.status === '부적합' ? '#ef4444' :
                                    '#64748b',
                    alignSelf: 'center' 
                }}>
                    {itemData?.status || '선택 안됨'}
                </span>
            )}
          </div>
        )})}
      </div>
    );

    const tempRoot = ReactDOM.createRoot(tempDiv);
    return new Promise<ImageInfo>((resolve, reject) => {
      tempRoot.render(<React.StrictMode>{ChecklistCaptureComponent}</React.StrictMode>);
      requestAnimationFrame(async () => {
        try {
          const canvas = await html2canvas(tempDiv.firstChild as HTMLElement, { backgroundColor: '#1f2937', scale: 1.5 });
          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1];

          const receiptSanitized = sanitizeFilenameComponent(job.receiptNumber);
          let itemPartForFilename = "";
          if (job.mainItemKey === 'TN') {
              itemPartForFilename = "";
          } else if (job.mainItemKey === 'TP') {
              itemPartForFilename = "P";
          } else if (job.mainItemKey === 'Cl') {
              itemPartForFilename = "C";
          } else {
              itemPartForFilename = sanitizeFilenameComponent(job.mainItemKey);
          }
          const fileName = `${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`;

          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], fileName, { type: 'image/png' });
          resolve({ file, base64, mimeType: 'image/png' });
        } catch (error) {
          reject(error);
        } finally {
          tempRoot.unmount();
          document.body.removeChild(tempDiv);
        }
      });
    });
  };

  const generateHypotheticalCompositeImageName = (
    receiptNumber: string | undefined
  ): string | undefined => {
    if (!receiptNumber) return undefined;
    const jobsWithThisReceipt = jobs.filter(job => job.receiptNumber === receiptNumber);
    if (!jobsWithThisReceipt.some(job => job.photos.length > 0)) {
        return undefined;
    }
    return generateCompositeImageNameForKtl(receiptNumber);
  };

  const generateHypotheticalZipFileName = (
    receiptNumber: string | undefined
  ): string | undefined => {
    if (!receiptNumber) return undefined;
    const jobsWithThisReceipt = jobs.filter(job => job.receiptNumber === receiptNumber);
    if (!jobsWithThisReceipt.some(job => job.photos.length > 0)) {
        return undefined;
    }
    return generateZipFileNameForKtl(receiptNumber);
  };


  const hypotheticalFileNamesForPreflight = useMemo(() => {
    const filesArray: string[] = [];
    if (siteLocation.trim() === '' || jobs.length === 0) return filesArray;

    const uniqueReceiptsWithPhotos = Array.from(new Set(
        jobs.filter(job => job.photos.length > 0).map(job => job.receiptNumber)
    ));

    uniqueReceiptsWithPhotos.forEach(receiptNo => {
        const compositeName = generateCompositeImageNameForKtl(receiptNo);
        if (compositeName) filesArray.push(compositeName);
        const zipName = generateZipFileNameForKtl(receiptNo);
        if (zipName) filesArray.push(zipName);
    });

    jobs.forEach(job => {
      const receiptSanitized = sanitizeFilenameComponent(job.receiptNumber);
      let itemPartForFilename = "";
      if (job.mainItemKey === 'TN') itemPartForFilename = "";
      else if (job.mainItemKey === 'TP') itemPartForFilename = "P";
      else if (job.mainItemKey === 'Cl') itemPartForFilename = "C";
      else itemPartForFilename = sanitizeFilenameComponent(job.mainItemKey);
      filesArray.push(`${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`);
    });

    return Array.from(new Set(filesArray)).sort(); 
  }, [jobs, siteLocation]);


  const ktlJsonToPreview = useMemo(() => {
    const jobForPreviewContext = activeJob || (jobs.length > 0 ? jobs[0] : null);
    if (!jobForPreviewContext || !isBatchValidForSubmission || !userName || siteLocation.trim() === '') return null;

    const jobsWithSameReceipt = jobs.filter(j => j.receiptNumber === jobForPreviewContext.receiptNumber);
    if (jobsWithSameReceipt.length === 0) return null;

    const payloadsForPreview: any[] = jobsWithSameReceipt.map(job => {
        const checklistDataForKtl: Record<string, StructuralCheckSubItemData> = {};
        Object.entries(job.checklistData).forEach(([key, value]) => {
            checklistDataForKtl[key] = { status: value.status, notes: value.notes, confirmedAt: value.confirmedAt, specialNotes: value.specialNotes };
        });
        const receiptSanitizedPreview = sanitizeFilenameComponent(job.receiptNumber);
        let itemPartForFilenamePreview = "";
        if (job.mainItemKey === 'TN') itemPartForFilenamePreview = "";
        else if (job.mainItemKey === 'TP') itemPartForFilenamePreview = "P";
        else if (job.mainItemKey === 'Cl') itemPartForFilenamePreview = "C";
        else itemPartForFilenamePreview = sanitizeFilenameComponent(job.mainItemKey);
        const checklistImageFileNameForPreview = `${receiptSanitizedPreview}${itemPartForFilenamePreview ? `_${itemPartForFilenamePreview}` : ''}_checklist.png`;

        return {
            receiptNumber: job.receiptNumber,
            siteLocation: siteLocation,
            mainItemKey: job.mainItemKey,
            checklistData: checklistDataForKtl,
            updateUser: userName,
            photos: job.photos,
            photoFileNames: {},
            checklistImageFileName: checklistImageFileNameForPreview,
            postInspectionDateValue: job.postInspectionDate, 
        };
    });

    const overallCompositeImageNameForPreview = generateHypotheticalCompositeImageName(jobForPreviewContext.receiptNumber);
    const overallZipFileNameForPreview = generateHypotheticalZipFileName(jobForPreviewContext.receiptNumber);

    return generateStructuralKtlJsonForPreview(
        payloadsForPreview,
        siteLocation,
        undefined,
        userName,
        overallCompositeImageNameForPreview,
        overallZipFileNameForPreview
    );
  }, [activeJob, jobs, siteLocation, isBatchValidForSubmission, userName]);

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
    } catch (e) { /* Not valid JSON for marking */ }

    let certDetails: CertificateDetails | null = null;
    try {
        const parsed = JSON.parse(certificateData.notes);
        if (typeof parsed === 'object' && parsed !== null) certDetails = parsed as CertificateDetails;
    } catch (e) { /* Not valid JSON for certificate */ }

    if (!markingDetails || !certDetails || certDetails.presence !== 'present') {
        return null;
    }

    const norm = (s: string | undefined) => (s || '').toLowerCase().replace(/\s+/g, '');

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
        return `(주의) 표시사항과 증명서 정보가 다릅니다:\n- ${messages.join('\n- ')}\n내용을 확인하고 일치시켜 주세요.`;
    }
}, [activeJob]);


  const handleInitiateSendToKtl = () => {
    if (userName === "게스트") {
      alert("게스트 사용자는 KTL로 전송할 수 없습니다.");
      return;
    }
    if (!isBatchValidForSubmission) {
      alert("모든 필수 항목(하나 이상의 작업 정의, 현장 위치)을 입력하고, 각 작업의 체크리스트를 확인해주세요.");
      return;
    }
     if (jobs.length === 0) {
        alert("전송할 작업이 없습니다. 먼저 '새 구조 확인 작업 추가'를 통해 작업을 정의해주세요.");
        return;
    }
    const jsonForPreviewInModal = ktlJsonToPreview;
    if (!jsonForPreviewInModal && jobs.length > 0) {
        alert("KTL JSON 미리보기를 생성할 수 없습니다. (활성) 작업의 데이터를 확인해주세요.");
        return;
    }

    const jobForContext = activeJob || (jobs.length > 0 ? jobs[0] : null);
    let contextReceiptNumber = `일괄 작업 (${jobs.length}개)`;
    let contextSelectedItem = `구조확인 작업: ${jobs.map(j => `${j.receiptNumber} / ${MAIN_STRUCTURAL_ITEMS.find(it => it.key === j.mainItemKey)?.name || j.mainItemKey}`).join('; ')}`;

    if (jobForContext) {
        const jobsWithSameReceipt = jobs.filter(j => j.receiptNumber === jobForContext.receiptNumber);
        if (jobsWithSameReceipt.length > 0) {
            contextReceiptNumber = jobForContext.receiptNumber;
            const mainItemNamesForModalSummary = Array.from(new Set(jobsWithSameReceipt.map(j => MAIN_STRUCTURAL_ITEMS.find(it => it.key === j.mainItemKey)?.name || j.mainItemKey)));
            contextSelectedItem = `항목: ${mainItemNamesForModalSummary.join(', ')}`;
        }
    }
    const inspectionStartDate = new Date().toISOString().split('T')[0];


    setKtlPreflightData({
        jsonPayload: jsonForPreviewInModal || "표시할 JSON 예시가 없습니다. (참고: 모든 정의된 작업이 전송됩니다)",
        fileNames: hypotheticalFileNamesForPreflight,
        context: {
            receiptNumber: contextReceiptNumber,
            siteLocation: siteLocation,
            selectedItem: contextSelectedItem,
            userName: userName,
            inspectionStartDate: inspectionStartDate,
        }
    });
    setIsKtlPreflightModalOpen(true);
  };

  const handleConfirmSendToKtl = async () => {
    setIsKtlPreflightModalOpen(false);
    if (userName === "게스트") {
        setSubmissionMessage("전송 실패: 게스트 사용자는 KTL로 전송할 수 없습니다.");
        setSubmissionStatus('error');
        return;
    }
    if (!isBatchValidForSubmission) {
      setSubmissionMessage("전송 실패: 필수 정보가 누락되었습니다.");
      setSubmissionStatus('error');
      return;
    }

    setIsLoading(true);
    resetSubmissionState();
    setSubmissionMessage('데이터, 사진 및 체크리스트 이미지를 준비하고 KTL 서버로 전송 중입니다...');

    const checklistImagesForUpload: ImageInfo[] = [];

    try {
      for (const job of jobs) {
        const checklistImageInfo = await generateChecklistImageForJob(job);
        checklistImagesForUpload.push(checklistImageInfo);
      }
    } catch (error: any) {
        setIsLoading(false);
        setSubmissionStatus('error');
        setSubmissionMessage(`준비 단계 (이미지 생성) 실패: ${error.message}`);
        return;
    }

    try {
      const inspectionStartDate = new Date().toISOString().split('T')[0];
      const results = await sendBatchStructuralChecksToKtlApi(
        jobs,
        checklistImagesForUpload,
        siteLocation,
        inspectionStartDate,
        userName
      );

      const allSuccessful = results.every(r => r.success);
      const resultMessages = results.map(r => `${r.receiptNo} (${r.mainItem}): ${r.message}`).join('\n');

      if (allSuccessful) {
        setSubmissionStatus('success');
        setSubmissionMessage(`모든 작업이 성공적으로 전송되었습니다.\n${resultMessages}`);
      } else {
        setSubmissionStatus('error');
        setSubmissionMessage(`일부 작업 전송 실패:\n${resultMessages}`);
      }

    } catch (error: any) {
      setSubmissionStatus('error');
      let detailedError = error.message || '알 수 없는 오류';
      if (typeof detailedError === 'string' && detailedError.toLowerCase().includes('network error')) {
        detailedError += "\n(네트워크 연결 상태, KTL 서버의 CORS 정책 또는 방화벽 설정을 확인해주세요.)";
      }
      setSubmissionMessage(`전체 일괄 전송 중 오류 발생: ${detailedError}`);
    } finally {
      setIsLoading(false);
    }
  };

  const currentChecklistItems = activeJob ? CHECKLIST_DEFINITIONS[activeJob.mainItemKey] : [];
  const representativeActiveJobPhoto: JobPhoto | null =
    activeJob && activeJob.photos.length > 0 && currentPhotoIndexOfActiveJob !== -1 && currentPhotoIndexOfActiveJob < activeJob.photos.length
    ? activeJob.photos[currentPhotoIndexOfActiveJob]
    : null;

  const currentMethodOptions = activeJob ? MEASUREMENT_METHOD_OPTIONS[activeJob.mainItemKey] : undefined;
  const currentRangeOptions = activeJob ? MEASUREMENT_RANGE_OPTIONS[activeJob.mainItemKey] : undefined;
  
  const displayJobForSummary = activeJob || (jobs.length > 0 ? jobs[0] : null);
  let previewSummaryText = "KTL 전송용 JSON 미리보기";
  if (displayJobForSummary && isBatchValidForSubmission) {
    const jobsWithSameReceipt = jobs.filter(j => j.receiptNumber === displayJobForSummary.receiptNumber);
    if (jobsWithSameReceipt.length > 0) {
        const mainItemNamesForSummary = Array.from(new Set(jobsWithSameReceipt.map(j => MAIN_STRUCTURAL_ITEMS.find(it => it.key === j.mainItemKey)?.name || j.mainItemKey)));
        previewSummaryText = `KTL 전송용 JSON 미리보기 (접수번호: ${displayJobForSummary.receiptNumber}, 항목: ${mainItemNamesForSummary.join(', ')})`;
    } else {
        previewSummaryText = `KTL 전송용 JSON 미리보기 (예시: ${displayJobForSummary.receiptNumber} / ${MAIN_STRUCTURAL_ITEMS.find(it => it.key === displayJobForSummary.mainItemKey)?.name})`;
    }
  }


  return (
    <div className="w-full max-w-4xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        구조 확인 (P4)
      </h2>

       <div className="grid grid-cols-1 sm:grid-cols-1 gap-x-6 gap-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
          <div>
            <label htmlFor="struct-site-location" className="block text-sm font-medium text-slate-300 mb-1">
              현장 위치 (일괄 적용) <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              id="struct-site-location"
              value={siteLocation}
              onChange={(e) => { setSiteLocation(e.target.value); resetSubmissionState(); }}
              disabled={isLoading || isAnalyzingDetail}
              required
              className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400"
              placeholder="예: OO처리장 최종방류구"
            />
          </div>
        </div>

      <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50 space-y-3">
        <h3 className="text-lg font-semibold text-slate-100">새 구조 확인 작업 추가</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label htmlFor="new-job-receipt-base" className="block text-xs font-medium text-slate-300 mb-1">접수번호 (공통 부분)</label>
            <input
              type="text"
              id="new-job-receipt-base"
              value={newJobBaseReceiptNumber}
              onChange={(e) => setNewJobBaseReceiptNumber(e.target.value)}
              placeholder="예: 25-000000-01"
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm placeholder-slate-400"
              disabled={isLoading || isAnalyzingDetail}
            />
          </div>
          <div>
            <label htmlFor="new-job-receipt-suffix" className="block text-xs font-medium text-slate-300 mb-1">접수번호 (세부)</label>
            <input
              type="text"
              id="new-job-receipt-suffix"
              value={newJobSuffixReceiptNumber}
              onChange={(e) => setNewJobSuffixReceiptNumber(e.target.value)}
              placeholder="예: 1"
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm placeholder-slate-400"
              disabled={isLoading || isAnalyzingDetail}
            />
          </div>
          <div>
            <label htmlFor="new-job-main-item" className="block text-xs font-medium text-slate-300 mb-1">주요 항목</label>
            <select
              id="new-job-main-item"
              value={newJobMainItemKey}
              onChange={(e) => setNewJobMainItemKey(e.target.value as MainStructuralItemKey)}
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm"
              disabled={isLoading || isAnalyzingDetail}
            >
              <option value="" disabled>선택...</option>
              {STRUCTURAL_ITEM_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map(item => (
                    <option key={item.key} value={item.key}>{item.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <ActionButton onClick={handleAddJob} disabled={isLoading || isAnalyzingDetail || !newJobBaseReceiptNumber.trim() || !newJobSuffixReceiptNumber.trim() || !newJobMainItemKey} className="md:col-span-4 h-9">
            작업 추가
          </ActionButton>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-md font-semibold text-slate-200">정의된 작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-60 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div
                key={job.id}
                className={`flex justify-between items-center p-2.5 rounded-md cursor-pointer transition-all duration-150 ease-in-out
                            ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'}`}
                onClick={() => { setActiveJobId(job.id); setDetailAnalysisError(null); setQuickAnalysisFeedback(null); }}
              >
                <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                  {job.receiptNumber} / {MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveJob(job.id); }}
                  className="text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-red-500/20 text-xs"
                  aria-label={`${job.receiptNumber} / ${job.mainItemKey} 작업 삭제`}
                  disabled={isLoading || isAnalyzingDetail}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeJob && (
        <div className="space-y-1 mt-4 p-3 bg-slate-700/40 rounded-lg border border-slate-600/50">
          <div className="flex flex-wrap gap-2 justify-between items-center mb-2">
            <h3 className="text-lg font-semibold text-slate-100">
              체크리스트: {activeJob.receiptNumber} / {MAIN_STRUCTURAL_ITEMS.find(item => item.key === activeJob.mainItemKey)?.name}
            </h3>
            <div className="flex flex-wrap gap-2">
                <ActionButton
                onClick={handleSetAllSuitableForActiveJob}
                variant="secondary"
                className="text-xs py-1.5 px-3 bg-green-600 hover:bg-green-500 focus:ring-green-500"
                disabled={isLoading || isAnalyzingDetail}
                >
                일괄 적합
                </ActionButton>
            </div>
          </div>

           <div className="py-3 px-2 border-b border-slate-700 last:border-b-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                <div className="md:col-span-1 flex flex-col">
                    <label htmlFor={`post-inspection-date-${activeJob.id}`} className="text-sm font-medium text-slate-200">
                        사후검사일
                    </label>
                    {activeJob.postInspectionDateConfirmedAt && (
                        <span className="text-xs text-slate-400 mt-0.5">
                            (확인: {activeJob.postInspectionDateConfirmedAt})
                        </span>
                    )}
                </div>
                <div className="md:col-span-1">
                    <select
                        id={`post-inspection-date-${activeJob.id}`}
                        value={activeJob.postInspectionDate}
                        onChange={(e) => handlePostInspectionDateChange(activeJob.id, e.target.value)}
                        className="w-full text-xs bg-slate-700 border border-slate-600 rounded-md p-1.5 focus:ring-sky-500 focus:border-sky-500 text-slate-200 placeholder-slate-400 disabled:opacity-70"
                        disabled={isLoading || isAnalyzingDetail}
                        aria-label="사후검사일 선택"
                    >
                        {POST_INSPECTION_DATE_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
            </div>
          </div>


          {currentChecklistItems.map((itemName, index) => {
             const isMethodItem = itemName === "측정방법확인";
             const isRangeItem = itemName === "측정범위확인";
             const isDisplayedInfoItem = itemName === "표시사항확인";
             const isOperatingProgramItem = itemName === "운용프로그램확인";
             const isCertificateItem = itemName === "정도검사 증명서";

             let itemOptionsForAnalysis: string[] | undefined = undefined;
             if (isMethodItem) itemOptionsForAnalysis = currentMethodOptions;
             else if (isRangeItem) itemOptionsForAnalysis = currentRangeOptions;

             return (
                <ChecklistItemRow
                  key={`${activeJob.id}-${itemName}`}
                  mainItemKey={activeJob.mainItemKey}
                  itemName={itemName}
                  itemIndex={index} // Pass the raw index
                  status={activeJob.checklistData[itemName]?.status || '선택 안됨'}
                  onStatusChange={(newStatus) => handleChecklistItemChange(activeJob.id, itemName, 'status', newStatus)}
                  notes={activeJob.checklistData[itemName]?.notes || ''}
                  onNotesChange={notes => handleChecklistItemChange(activeJob.id, itemName, 'notes', notes)}
                  specialNotes={activeJob.checklistData[itemName]?.specialNotes || ''}
                  onSpecialNotesChange={specialNotes => handleChecklistItemChange(activeJob.id, itemName, 'specialNotes', specialNotes)}
                  confirmedAt={activeJob.checklistData[itemName]?.confirmedAt || null}
                  disabled={isLoading || isAnalyzingDetail}
                  itemOptions={itemOptionsForAnalysis} 
                  onAnalyzeDetail={
                      (isMethodItem || isRangeItem || isDisplayedInfoItem || isOperatingProgramItem || isCertificateItem)
                      ? () => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, activeJob.photos, itemName as any)
                      : undefined
                  }
                  isAnalyzingDetail={(isMethodItem || isRangeItem || isDisplayedInfoItem || isOperatingProgramItem || isCertificateItem) && isAnalyzingDetail && !quickAnalysisTarget}
                  detailAnalysisError={(isMethodItem || isRangeItem || isDisplayedInfoItem || isOperatingProgramItem || isCertificateItem) && !quickAnalysisTarget ? detailAnalysisError : null}
                  jobPhotosExist={activeJob.photos.length > 0}
                  comparisonNote={itemName === "정도검사 증명서" ? comparisonNoteForActiveJob : undefined}
                />
             );
            })}
          
          <div className="mt-4 pt-3 border-t border-slate-600 space-y-3">
            <h4 className="text-md font-semibold text-slate-200">
                '{MAIN_STRUCTURAL_ITEMS.find(item => item.key === activeJob.mainItemKey)?.name}' 작업 참고 사진
            </h4>
            {isCameraOpen ? (
                <CameraView onCapture={handleCameraCapture} onClose={handleCloseCamera} />
            ) : (
                <>
                    <ImageInput
                        onImagesSet={handleActiveJobPhotosSet}
                        onOpenCamera={handleOpenCamera}
                        isLoading={isLoading || isAnalyzingDetail}
                        ref={activeJobFileInputRef}
                        selectedImageCount={activeJob.photos.length}
                    />
                    {activeJob.photos.length > 0 && (
                        <ActionButton onClick={handleClearActiveJobPhotos} variant="secondary" fullWidth disabled={isLoading || isAnalyzingDetail}>
                            '{MAIN_STRUCTURAL_ITEMS.find(item => item.key === activeJob.mainItemKey)?.name}' 작업 사진 모두 지우기 ({activeJob.photos.length}장)
                        </ActionButton>
                    )}
                    {representativeActiveJobPhoto && (
                      <>
                        <ImagePreview
                            imageBase64={representativeActiveJobPhoto.base64}
                            fileName={representativeActiveJobPhoto.file.name}
                            mimeType={representativeActiveJobPhoto.mimeType}
                            receiptNumber={activeJob.receiptNumber}
                            siteLocation={siteLocation}
                            item={MAIN_STRUCTURAL_ITEMS.find(it => it.key === activeJob.mainItemKey)?.name || activeJob.mainItemKey}
                            comment={activeJob.photoComments[representativeActiveJobPhoto.uid]}
                            showOverlay={true}
                            totalSelectedImages={activeJob.photos.length}
                            currentImageIndex={currentPhotoIndexOfActiveJob}
                            onDelete={() => handleDeleteActiveJobImage(currentPhotoIndexOfActiveJob)}
                        />
                        <div className="mt-2">
                          <label htmlFor="photo-comment" className="block text-sm font-medium text-slate-300 mb-1">
                              사진 코멘트
                          </label>
                          <textarea
                              id="photo-comment"
                              value={activeJob.photoComments[representativeActiveJobPhoto.uid] || ''}
                              onChange={(e) => handlePhotoCommentChange(representativeActiveJobPhoto.uid, e.target.value)}
                              placeholder="이 사진에 대한 코멘트를 입력하세요 (판별 시 자동 입력)..."
                              rows={2}
                              className="w-full text-sm bg-slate-700 border border-slate-600 rounded-md p-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 disabled:opacity-70"
                              disabled={isLoading || isAnalyzingDetail}
                          />
                        </div>
                      </>
                    )}
                     <ThumbnailGallery
                        images={activeJob.photos}
                        currentIndex={currentPhotoIndexOfActiveJob}
                        onSelectImage={setCurrentPhotoIndexOfActiveJob}
                        onDeleteImage={handleDeleteActiveJobImage}
                        disabled={isLoading || isAnalyzingDetail}
                        analysisStatusForPhotos={analysisStatusForPhotos[activeJob.id]}
                    />
                    {activeJob.photos.length > 0 && representativeActiveJobPhoto && (
                        <div className="mt-3 pt-3 border-t border-slate-600/50 space-y-2">
                            <h5 className="text-sm font-semibold text-slate-300">판별 (현재 보이는 사진 사용):</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("측정범위확인") && (
                                    <div className="flex-1">
                                        <ActionButton
                                            onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "측정범위확인", true)}
                                            variant="secondary"
                                            className="w-full bg-sky-600 hover:bg-sky-500 focus:ring-sky-500 text-white text-xs"
                                            disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "측정범위확인") || !representativeActiveJobPhoto}
                                            title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 측정범위 판별"}
                                            isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("측정범위확인")}
                                        >
                                            {(isAnalyzingDetail && quickAnalysisTarget === "측정범위확인") ? <Spinner size="sm"/> : null}
                                            선택사진 측정범위 판별
                                        </ActionButton>
                                        {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "측정범위확인" && (
                                            <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {quickAnalysisFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("측정방법확인") && (
                                    <div className="flex-1">
                                        <ActionButton
                                            onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "측정방법확인", true)}
                                            variant="secondary"
                                            className="w-full bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-500 text-white text-xs"
                                            disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "측정방법확인") || !representativeActiveJobPhoto}
                                            title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 측정방법 판별"}
                                            isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("측정방법확인")}
                                        >
                                            {(isAnalyzingDetail && quickAnalysisTarget === "측정방법확인") ? <Spinner size="sm"/> : null}
                                            선택사진 측정방법 판별
                                        </ActionButton>
                                        {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "측정방법확인" && (
                                            <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {quickAnalysisFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("표시사항확인") && (
                                    <div className="flex-1">
                                        <ActionButton
                                            onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "표시사항확인", true)}
                                            variant="secondary"
                                            className="w-full bg-teal-600 hover:bg-teal-500 focus:ring-teal-500 text-white text-xs"
                                            disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "표시사항확인") || !representativeActiveJobPhoto}
                                            title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 표시사항 판별"}
                                            isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("표시사항확인")}
                                        >
                                            {(isAnalyzingDetail && quickAnalysisTarget === "표시사항확인") ? <Spinner size="sm"/> : null}
                                            선택사진 표시사항 판별
                                        </ActionButton>
                                        {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "표시사항확인" && (
                                            <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {quickAnalysisFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("운용프로그램확인") && (
                                    <div className="flex-1">
                                        <ActionButton
                                            onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "운용프로그램확인", true)}
                                            variant="secondary"
                                            className="w-full bg-rose-600 hover:bg-rose-500 focus:ring-rose-500 text-white text-xs"
                                            disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "운용프로그램확인") || !representativeActiveJobPhoto}
                                            title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 버전정보 판별"}
                                            isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("운용프로그램확인")}
                                        >
                                            {(isAnalyzingDetail && quickAnalysisTarget === "운용프로그램확인") ? <Spinner size="sm"/> : null}
                                            선택사진 버전정보 판별
                                        </ActionButton>
                                        {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "운용프로그램확인" && (
                                            <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {quickAnalysisFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("정도검사 증명서") && (
                                    <div className="flex-1">
                                        <ActionButton
                                            onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "정도검사 증명서", true)}
                                            variant="secondary"
                                            className="w-full bg-amber-600 hover:bg-amber-500 focus:ring-amber-500 text-white text-xs"
                                            disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "정도검사 증명서") || !representativeActiveJobPhoto}
                                            title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 증명서 정보 판별"}
                                            isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("정도검사 증명서")}
                                        >
                                            {(isAnalyzingDetail && quickAnalysisTarget === "정도검사 증명서") ? <Spinner size="sm"/> : null}
                                            선택사진 증명서 정보 판별
                                        </ActionButton>
                                        {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "정도검사 증명서" && (
                                            <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {quickAnalysisFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                )}
                                {CHECKLIST_DEFINITIONS[activeJob.mainItemKey].includes("기기번호 확인") && (
                                    <>
                                        <div className="flex-1">
                                            <ActionButton
                                                onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "지시부 번호", true)}
                                                variant="secondary"
                                                className="w-full bg-cyan-600 hover:bg-cyan-500 focus:ring-cyan-500 text-white text-xs"
                                                disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "지시부 번호") || !representativeActiveJobPhoto}
                                                title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 지시부 번호 판별"}
                                                isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("지시부 번호")}
                                            >
                                                {(isAnalyzingDetail && quickAnalysisTarget === "지시부 번호") ? <Spinner size="sm"/> : null}
                                                선택사진 지시부 번호 판별
                                            </ActionButton>
                                            {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "지시부 번호" && (
                                                <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {quickAnalysisFeedback.message}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <ActionButton
                                                onClick={() => handleAnalyzeChecklistItemDetail(activeJob.id, activeJob.mainItemKey, representativeActiveJobPhoto ? [representativeActiveJobPhoto] : [], "센서부 번호", true)}
                                                variant="secondary"
                                                className="w-full bg-cyan-600 hover:bg-cyan-500 focus:ring-cyan-500 text-white text-xs"
                                                disabled={isLoading || (isAnalyzingDetail && quickAnalysisTarget === "센서부 번호") || !representativeActiveJobPhoto}
                                                title={!representativeActiveJobPhoto ? "판별할 사진이 선택되지 않았습니다." : "현재 선택된 사진으로 센서부 번호 판별"}
                                                isAnalyzed={!!analysisStatusForPhotos[activeJob.id]?.[currentPhotoIndexOfActiveJob]?.has("센서부 번호")}
                                            >
                                                {(isAnalyzingDetail && quickAnalysisTarget === "센서부 번호") ? <Spinner size="sm"/> : null}
                                                선택사진 센서부 번호 판별
                                            </ActionButton>
                                            {quickAnalysisFeedback && quickAnalysisFeedback.targetItemName === "센서부 번호" && (
                                                <p className={`text-xs mt-1 ${quickAnalysisFeedback.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {quickAnalysisFeedback.message}
                                                </p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
            </div>
        </div>
      )}

        {ktlJsonToPreview && displayJobForSummary && (
            <details className="mt-4 text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
                <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
                    {previewSummaryText}
                </summary>
                <pre className="mt-2 text-xs text-slate-300 bg-slate-900 p-3 rounded-md overflow-x-auto max-h-60 border border-slate-700">
                    {ktlJsonToPreview}
                </pre>
            </details>
        )}

      {jobs.length > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-700">
          <ActionButton
            onClick={handleInitiateSendToKtl}
            disabled={!isBatchValidForSubmission || isLoading || isAnalyzingDetail || userName === "게스트"}
            fullWidth
          >
            {isLoading ? <Spinner size="sm" /> : `정의된 모든 작업 (${jobs.length}개) KTL로 일괄 전송`}
          </ActionButton>
          {submissionMessage && (
            <p className={`mt-3 text-sm text-center whitespace-pre-wrap ${
                submissionStatus === 'error' ? 'text-red-400' :
                submissionStatus === 'success' ? 'text-green-400' :
                submissionStatus === 'analyzing' ? 'text-sky-400' : 'text-slate-400'
            }`}
               role={submissionStatus === 'error' || submissionStatus === 'success' ? 'alert' : undefined}
            >
              {submissionMessage}
            </p>
          )}
        </div>
      )}

      {isKtlPreflightModalOpen && ktlPreflightData && (
        <KtlPreflightModal
          isOpen={isKtlPreflightModalOpen}
          onClose={() => setIsKtlPreflightModalOpen(false)}
          onConfirm={handleConfirmSendToKtl}
          preflightData={ktlPreflightData}
        />
      )}
    </div>
  );
};

export default StructuralCheckPage;