import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { OcrControls } from './components/OcrControls';
import { OcrResultDisplay } from './components/OcrResultDisplay';
import { sendToClaydoxApi, ClaydoxPayload, generateKtlJsonForPreview } from './services/claydoxApiService';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';
import KtlPreflightModal, { KtlPreflightData } from './components/KtlPreflightModal';
import { callSaveTempApi, callLoadTempApi, SaveDataPayload, LoadedData, SavedValueEntry } from './services/apiService';
import { ActionButton } from './components/ActionButton';
import { ImageInput, ImageInfo } from './components/ImageInput';
import { CameraView } from './components/CameraView';
import { ImagePreview } from './components/ImagePreview';
import { ThumbnailGallery } from './components/ThumbnailGallery';
import { generateCompositeImage, generateStampedImage, dataURLtoBlob } from './services/imageStampingService';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';


// --- Interfaces ---
export interface ExtractedEntry {
  id: string;
  time: string;
  value: string;
  valueTP?: string;
  identifier?: string;
  isRuleMatched?: boolean; // Keep for type compatibility, though unused here
}

export interface DrinkingWaterJob {
  id: string;
  receiptNumber: string;
  selectedItem: string;
  details: string; // 상세 위치 (예: 배수지)
  processedOcrData: ExtractedEntry[] | null;
  decimalPlaces: number;
  decimalPlacesCl?: number;
  photos: ImageInfo[];
}

type KtlApiCallStatus = 'idle' | 'success' | 'error';

// --- Helper Functions ---
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
  return component.replace(/[/\\[\]:*?"<>|]/g, '_').replace(/__+/g, '_');
};


/**
 * Recursively removes undefined, null, empty strings, empty non-array objects, and a specific key from an object.
 * @param obj The object to clean.
 * @returns A new object with unwanted values removed, or undefined if the result is an empty object or array.
 */
function deepClean(obj: any): any {
  if (obj === null || obj === undefined) return undefined;

  if (Array.isArray(obj)) {
    const cleanedArray = obj
      .map((item) => deepClean(item))
      .filter((item) => item !== undefined);
    return cleanedArray.length > 0 ? cleanedArray : undefined;
  }

  if (typeof obj === 'object') {
    const newObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'raw_data_image') {
        if (typeof console !== 'undefined') console.warn('[Clean] Removing raw_data_image key.');
        continue;
      }
      const cleanedValue = deepClean(value);

      // Check for undefined and also for empty objects (that are not arrays)
      if (
        cleanedValue !== undefined &&
        !(typeof cleanedValue === 'object' && cleanedValue !== null && !Array.isArray(cleanedValue) && Object.keys(cleanedValue).length === 0)
      ) {
        newObj[key] = cleanedValue;
      }
    }
    // Return undefined if the new object is empty, otherwise return the object
    return Object.keys(newObj).length > 0 ? newObj : undefined;
  }

  if (obj === '') return undefined; // Remove empty strings
  return obj;
}


// --- Component ---
interface DrinkingWaterPageProps {
  userName: string;
}

const DrinkingWaterPage: React.FC<DrinkingWaterPageProps> = ({ userName }) => {
  const [jobs, setJobs] = useState<DrinkingWaterJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  
  const [siteLocation, setSiteLocation] = useState<string>(''); // 공통 현장 위치

  const [newJobBaseReceiptNumber, setNewJobBaseReceiptNumber] = useState('');
  const [newJobSuffixReceiptNumber, setNewJobSuffixReceiptNumber] = useState('');
  const [newJobSelectedItem, setNewJobSelectedItem] = useState('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isSendingToClaydox, setIsSendingToClaydox] = useState<boolean>(false);
  const [ktlApiCallStatus, setKtlApiCallStatus] = useState<KtlApiCallStatus>('idle');
  const [isKtlPreflightModalOpen, setIsKtlPreflightModalOpen] = useState<boolean>(false);
  const [ktlPreflightData, setKtlPreflightData] = useState<KtlPreflightData | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [isLoadingDraft, setIsLoadingDraft] = useState<boolean>(false);
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null);
  const [loadDraftMessage, setLoadDraftMessage] = useState<string | null>(null);
  
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPhotoIndexOfActiveJob, setCurrentPhotoIndexOfActiveJob] = useState<number>(-1);
  const dataTableRef = useRef<HTMLDivElement>(null);


  const activeJob = useMemo(() => jobs.find(job => job.id === activeJobId), [jobs, activeJobId]);

  const drinkingWaterItems = useMemo(
    () => ANALYSIS_ITEM_GROUPS.find(group => group.label === '먹는물')?.items || [],
    []
  );

  const resetSubmissionState = useCallback(() => {
    setProcessingError(null);
    setKtlApiCallStatus('idle');
    setSaveDraftMessage(null);
    setLoadDraftMessage(null);
  }, []);
  
  const hypotheticalKtlFileNamesForPreview = useMemo(() => {
    if (!activeJob) return [];
    
    const fileNames: string[] = [];
    const baseName = `${activeJob.receiptNumber}_먹는물_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}`;
    
    if (activeJob.photos.length > 0) {
      fileNames.push(`${baseName}_composite.jpg`);
      fileNames.push(`${baseName}_압축.zip`);
    }

    // Add hypothetical data table image name if there's data to send
    if (activeJob.processedOcrData?.some(d => d.value.trim() !== '' || (d.valueTP && d.valueTP.trim() !== ''))) {
      fileNames.push(`${baseName}_datatable.png`);
    }

    return fileNames;
  }, [activeJob]);


  const ktlJsonPreview = useMemo(() => {
    if (!activeJob || !userName || !siteLocation.trim()) return null;
    const { receiptNumber, selectedItem, processedOcrData, details, decimalPlaces, decimalPlacesCl } = activeJob;

    const finalSiteLocation = details ? `${siteLocation.trim()} / ${details.trim()}` : siteLocation.trim();

    const payload: ClaydoxPayload = {
      receiptNumber,
      siteLocation: finalSiteLocation,
      item: selectedItem,
      ocrData: processedOcrData || [],
      updateUser: userName,
      pageType: 'PhotoLog',
      maxDecimalPlaces: decimalPlaces,
      maxDecimalPlacesCl: decimalPlacesCl,
    };
    return generateKtlJsonForPreview(payload, selectedItem, hypotheticalKtlFileNamesForPreview, decimalPlaces);
  }, [activeJob, userName, siteLocation, hypotheticalKtlFileNamesForPreview]);

  const draftJsonPreview = useMemo(() => {
    if (!activeJob || !userName || !siteLocation.trim()) return null;
    const { receiptNumber, selectedItem, processedOcrData, details } = activeJob;

    const transformedValues: Record<string, Record<string, SavedValueEntry>> = {};
    const itemsToProcess = selectedItem === 'TU/CL' ? ['TU', 'Cl'] : (selectedItem ? [selectedItem] : []);

    if (processedOcrData && itemsToProcess.length > 0) {
      itemsToProcess.forEach(subItem => {
        const subItemData: Record<string, SavedValueEntry> = {};
        processedOcrData.forEach(entry => {
          if (entry.identifier === 'Z 2시간 시작 - 종료' || entry.identifier === '드리프트 완료' || entry.identifier === '반복성 완료') return;
          
          let key: string | null = null;
          let value: string | null = null;

          if (subItem === 'TU') {
            key = entry.identifier || null;
            value = entry.value || null;
          } else if (subItem === 'Cl') {
            key = entry.identifier ? entry.identifier : null;
            if (activeJob.selectedItem === 'TU/CL') {
              value = entry.valueTP || null;
            } else {
              value = entry.value || null;
            }
          }
          
          if (entry.identifier === '응답시간_Cl' && subItem === 'Cl') {
            key = '응답시간';
            value = entry.value;
          } else if (entry.identifier === '응답시간' && subItem === 'TU') {
            key = '응답시간';
            value = entry.value;
          }

          if (key && value && value.trim() !== '') {
            subItemData[key] = { val: value.trim(), time: entry.time };
          }
        });

        if (Object.keys(subItemData).length > 0) {
          transformedValues[subItem] = subItemData;
        }
      });
    }

    const finalSiteLocation = details ? `${siteLocation.trim()} / ${details.trim()}` : siteLocation.trim();

    const payload: SaveDataPayload = {
      receipt_no: receiptNumber,
      site: finalSiteLocation,
      item: [selectedItem],
      user_name: userName,
      values: transformedValues,
    };
    return JSON.stringify(payload, null, 2);
  }, [activeJob, userName, siteLocation]);

  const handleAddJob = () => {
    const baseNum = newJobBaseReceiptNumber.trim();
    const suffixNum = newJobSuffixReceiptNumber.trim();

    if (!baseNum || !suffixNum || !newJobSelectedItem) {
      alert('새 작업에 대한 접수번호 (공통 및 세부)와 항목을 모두 입력/선택해주세요.');
      return;
    }

    const fullReceiptNumber = `${baseNum}-${suffixNum}`;

    const initialDataIdentifiers = [...DRINKING_WATER_IDENTIFIERS];

    const initialData = initialDataIdentifiers.map(identifier => {
      const entry: ExtractedEntry = {
        id: self.crypto.randomUUID(),
        time: '',
        value: '',
        identifier: identifier,
        isRuleMatched: false,
      };
      if (newJobSelectedItem === 'TU/CL') {
        entry.valueTP = '';
      }
      return entry;
    });

    const newJob: DrinkingWaterJob = {
      id: self.crypto.randomUUID(),
      receiptNumber: fullReceiptNumber,
      selectedItem: newJobSelectedItem,
      details: '',
      processedOcrData: initialData,
      decimalPlaces: 2,
      decimalPlacesCl: newJobSelectedItem === 'TU/CL' ? 2 : undefined,
      photos: [],
    };

    setJobs(prev => [...prev, newJob]);
    setActiveJobId(newJob.id);
    setCurrentPhotoIndexOfActiveJob(-1);

    const nextSuffix = (parseInt(suffixNum, 10) || 0) + 1;
    setNewJobSuffixReceiptNumber(String(nextSuffix));

    setNewJobSelectedItem('');
    resetSubmissionState();
  };

  const handleRemoveJob = (jobIdToRemove: string) => {
    setJobs(prevJobs => prevJobs.filter(job => job.id !== jobIdToRemove));
    if (activeJobId === jobIdToRemove) {
      setActiveJobId(jobs.length > 1 ? jobs.find(j => j.id !== jobIdToRemove)?.id || null : null);
      setCurrentPhotoIndexOfActiveJob(-1);
    }
    resetSubmissionState();
  };
  
  const handleJobDetailChange = (field: keyof Pick<DrinkingWaterJob, 'decimalPlaces' | 'decimalPlacesCl' | 'details'>, value: number | string) => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id === activeJobId) {
        return { ...job, [field]: value };
      }
      return job;
    }));
    resetSubmissionState();
  };


  const handleClear = useCallback(() => {
    if (!activeJobId) return;
    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id === activeJobId && job.processedOcrData) {
        const clearedData = job.processedOcrData.map(entry => ({
          ...entry,
          time: '',
          value: '',
          valueTP: entry.valueTP !== undefined ? '' : undefined,
        }));
        return { ...job, processedOcrData: clearedData, photos: [] };
      }
      return job;
    }));
    setCurrentPhotoIndexOfActiveJob(-1);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    resetSubmissionState();
  }, [activeJobId, resetSubmissionState]);

  const updateJobOcrData = (jobId: string, updatedData: ExtractedEntry[]) => {
    setJobs(prevJobs => prevJobs.map(job =>
      job.id === jobId ? { ...job, processedOcrData: updatedData } : job
    ));
    resetSubmissionState();
  };

  const handleEntryValueChange = (entryId: string, valueType: 'primary' | 'tp', newValue: string) => {
    if (!activeJob || !activeJob.processedOcrData) return;

    const updatedData = activeJob.processedOcrData.map(entry => {
      if (entry.id === entryId) {
        const updatedEntry = {
          ...entry,
          ...(valueType === 'primary' ? { value: newValue } : { valueTP: newValue })
        };
        const hasPrimaryValue = (valueType === 'primary' ? newValue : entry.value).trim() !== '';
        const hasTPValue = (valueType === 'tp' ? newValue : entry.valueTP)?.trim() !== '';
        updatedEntry.time = (hasPrimaryValue || hasTPValue) ? getCurrentTimestampForInput() : '';
        return updatedEntry;
      }
      return entry;
    });
    updateJobOcrData(activeJob.id, updatedData);
  };

  const handleEntryValueBlur = (entryId: string, valueType: 'primary' | 'tp') => {
    if (!activeJob || !activeJob.processedOcrData) return;
  
    // Simplified formatter for non-response time values.
    const formatValue = (value: string | undefined, places: number): string => {
      if (value === null || value === undefined || value.trim() === '') return '';
      const num = parseFloat(value);
      if (isNaN(num)) return value;
      return num.toFixed(places);
    };
  
    const updatedData = activeJob.processedOcrData.map(entry => {
      if (entry.id === entryId) {
        const updatedEntry = { ...entry };
        const isResponseTime = entry.identifier?.startsWith('응답시간');
        
        if (isResponseTime) {
          // no-op
        } else { 
          if (valueType === 'primary') {
            updatedEntry.value = formatValue(entry.value, activeJob.decimalPlaces);
          } else if (valueType === 'tp') {
            updatedEntry.valueTP = formatValue(entry.valueTP, activeJob.decimalPlacesCl ?? activeJob.decimalPlaces);
          }
        }
        return updatedEntry;
      }
      return entry;
    });
    updateJobOcrData(activeJob.id, updatedData);
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
    if (!activeJobId) return;
    if (images.length === 0) return;

    setJobs(prevJobs => prevJobs.map(job => {
      if (job.id === activeJobId) {
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

        return { ...job, photos: finalPhotos };
      }
      return job;
    }));
    resetSubmissionState();
  }, [activeJobId, resetSubmissionState]);

  const handleCameraCapture = useCallback((file: File, base64: string, mimeType: string) => {
    if (!activeJobId) return;
    const capturedImageInfo: ImageInfo = { file, base64, mimeType };
    
    let newIndex = -1;
    setJobs(prevJobs =>
      prevJobs.map(job => {
        if (job.id === activeJobId) {
          const newPhotos = [...job.photos, capturedImageInfo];
          newIndex = job.photos.length;
          return { ...job, photos: newPhotos };
        }
        return job;
      })
    );
    
    if (newIndex !== -1) {
      setCurrentPhotoIndexOfActiveJob(newIndex);
    }
    setIsCameraOpen(false);
    resetSubmissionState();
  }, [activeJobId, resetSubmissionState]);
  
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
    } else if (newCurrentIndex > indexToDelete) {
      newCurrentIndex = newCurrentIndex - 1;
    }
    
    setJobs(prevJobs => prevJobs.map(job =>
      job.id === activeJobId ? { ...job, photos: newPhotos } : job
    ));
    setCurrentPhotoIndexOfActiveJob(newCurrentIndex);
    resetSubmissionState();
  }, [activeJobId, jobs, currentPhotoIndexOfActiveJob, resetSubmissionState]);


  const handleInitiateSendToKtl = useCallback(() => {
    if (!activeJob || !userName || !siteLocation.trim()) return;
    if (userName === '게스트') {
      alert('게스트 사용자는 KTL로 전송할 수 없습니다.');
      return;
    }
    const hasValues = activeJob.processedOcrData?.some(entry =>
      (entry.value && entry.value.trim() !== '') || (entry.valueTP && entry.valueTP.trim() !== '')
    );
    if (!hasValues) {
      alert('전송할 입력된 데이터가 없습니다.');
      return;
    }
    const finalSiteLocation = activeJob.details ? `${siteLocation.trim()} / ${activeJob.details.trim()}` : siteLocation.trim();

    setKtlPreflightData({
      jsonPayload: ktlJsonPreview || 'JSON 미리보기를 생성할 수 없습니다.',
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
      setProcessingError('KTL 전송을 위한 필수 데이터가 누락되었습니다.');
      setKtlApiCallStatus('error');
      return;
    }
    setIsSendingToClaydox(true);
    resetSubmissionState();
    
    const finalSiteLocation = activeJob.details ? `${siteLocation.trim()} / ${activeJob.details.trim()}` : siteLocation.trim();

    const payload: ClaydoxPayload = {
      receiptNumber: activeJob.receiptNumber,
      siteLocation: finalSiteLocation,
      item: activeJob.selectedItem,
      ocrData: activeJob.processedOcrData || [],
      updateUser: userName,
      pageType: 'PhotoLog',
      maxDecimalPlaces: activeJob.decimalPlaces,
      maxDecimalPlacesCl: activeJob.decimalPlacesCl,
    };
    
    let filesToUpload: File[] = [];
    let actualKtlFileNames: string[] = [];

    try {
      // Capture data table image
      let dataTableFile: File | null = null;
      if (dataTableRef.current) {
        const canvas = await html2canvas(dataTableRef.current, { 
          backgroundColor: '#1e293b',
          ignoreElements: (element) => element.classList.contains('no-capture')
        });
        const dataUrl = canvas.toDataURL('image/png');
        const blob = dataURLtoBlob(dataUrl);
        const dataTableFileName = `${activeJob.receiptNumber}_먹는물_${sanitizeFilenameComponent(activeJob.selectedItem.replace('/', '_'))}_datatable.png`;
        dataTableFile = new File([blob], dataTableFileName, { type: 'image/png' });
      }
      
      // Process photos if they exist
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
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const zipKtlFileName = `${baseName}_압축.zip`;
          const zipFile = new File([zipBlob], zipKtlFileName, { type: 'application/zip' });
          filesToUpload.push(zipFile);
          actualKtlFileNames.push(zipKtlFileName);
        }
      }

      // Add the data table file to the lists
      if (dataTableFile) {
        filesToUpload.push(dataTableFile);
        actualKtlFileNames.push(dataTableFile.name);
      }

      const response = await sendToClaydoxApi(payload, filesToUpload, activeJob.selectedItem, actualKtlFileNames);
      alert(`KTL API 응답: ${response.message || JSON.stringify(response)}`);
      setKtlApiCallStatus('success');
    } catch (error: any) {
      setProcessingError(`KTL 전송 실패: ${error.message}`);
      setKtlApiCallStatus('error');
    } finally {
      setIsSendingToClaydox(false);
    }
  }, [activeJob, userName, resetSubmissionState, siteLocation]);

  const handleSaveDraft = useCallback(async () => {
    if (!activeJob || !siteLocation.trim()) {
      alert('임시 저장할 작업을 선택하고 현장 위치를 입력해주세요.');
      return;
    }

    const hasDataToSave = activeJob.processedOcrData?.some(
      d => (d.value && d.value.trim() !== '') || (d.valueTP && d.valueTP.trim() !== '')
    );
    if (!hasDataToSave) {
      alert('임시 저장할 데이터가 없습니다.');
      return;
    }

    setIsSavingDraft(true);
    resetSubmissionState();

    try {
      const transformedValues: Record<string, Record<string, SavedValueEntry>> = {};

      if (activeJob.selectedItem === 'TU/CL') {
        const tuData: Record<string, SavedValueEntry> = {};
        const clData: Record<string, SavedValueEntry> = {};
        activeJob.processedOcrData?.forEach(entry => {
          if (!entry.identifier || entry.identifier.includes('시작') || entry.identifier.includes('완료')) return;
          if (entry.identifier === '응답시간') {
            if (entry.value && entry.value.trim() !== '') {
              tuData['응답시간'] = { val: entry.value, time: entry.time };
            }
            if (entry.valueTP && entry.valueTP.trim() !== '') {
              clData['응답시간'] = { val: entry.valueTP, time: entry.time };
            }
          } else {
            if (entry.value && entry.value.trim() !== '') {
              tuData[entry.identifier] = { val: entry.value, time: entry.time };
            }
            if (entry.valueTP && entry.valueTP.trim() !== '') {
              clData[entry.identifier] = { val: entry.valueTP, time: entry.time };
            }
          }
        });
        if (Object.keys(tuData).length > 0) transformedValues.TU = tuData;
        if (Object.keys(clData).length > 0) transformedValues.Cl = clData;
      } else { // Standalone TU or Cl
        const itemData: Record<string, SavedValueEntry> = {};
        activeJob.processedOcrData?.forEach(entry => {
          if (entry.identifier && entry.value && entry.value.trim() !== '' && !entry.identifier.includes('시작') && !entry.identifier.includes('완료')) {
            itemData[entry.identifier] = { val: entry.value, time: entry.time };
          }
        });
        if (Object.keys(itemData).length > 0) {
          transformedValues[activeJob.selectedItem] = itemData;
        }
      }

      const finalSiteLocation = activeJob.details ? `${siteLocation.trim()} / ${activeJob.details.trim()}` : siteLocation.trim();

      const payloadForApi: SaveDataPayload = {
        receipt_no: activeJob.receiptNumber,
        site: finalSiteLocation,
        item: [activeJob.selectedItem],
        user_name: userName,
        values: transformedValues,
      };

      const cleanedPayload = deepClean(payloadForApi);

      if (!cleanedPayload) {
        alert('저장할 유효한 데이터가 없습니다.');
        setIsSavingDraft(false);
        return;
      }

      const response = await callSaveTempApi(cleanedPayload as SaveDataPayload);
      setSaveDraftMessage(response.message || '성공적으로 저장되었습니다.');
      setTimeout(() => setSaveDraftMessage(null), 4000);
    } catch (error: any) {
      console.error('Error saving draft:', error);
      setProcessingError(`임시 저장 실패: ${error.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  }, [activeJob, userName, resetSubmissionState, siteLocation]);


  const handleLoadDraft = useCallback(async () => {
    if (!activeJob) {
      alert('데이터를 가져올 작업을 선택해주세요.');
      return;
    }

    setIsLoadingDraft(true);
    resetSubmissionState();
    try {
      const data: LoadedData = await callLoadTempApi(activeJob.receiptNumber);

      if (data && data.values && data.item?.[0] === activeJob.selectedItem) {
        const siteParts = (data.site || '').split(' / ');
        const loadedGlobalSite = siteParts[0] || '';
        const loadedDetails = siteParts.slice(1).join(' / ');

        setSiteLocation(loadedGlobalSite);

        const tuData = data.values.TU || {};
        const clData = data.values.Cl || {};

        const identifiersToMap = [...DRINKING_WATER_IDENTIFIERS];
        
        const reconstructedOcrData = identifiersToMap.map(identifier => {
          const isDivider = identifier.includes('시작') || identifier.includes('완료');
          
          const entry: ExtractedEntry = {
            id: self.crypto.randomUUID(),
            time: '',
            value: '',
            identifier: identifier,
            isRuleMatched: false,
          };

          if (isDivider) return entry;

          let primaryValue: string | undefined;
          let secondaryValue: string | undefined;
          let timeValue: string | undefined;

          if (activeJob.selectedItem === 'TU') {
            primaryValue = tuData[identifier]?.val;
            timeValue = tuData[identifier]?.time;
          } else if (activeJob.selectedItem === 'Cl') {
            primaryValue = clData[identifier]?.val;
            timeValue = clData[identifier]?.time;
          } else if (activeJob.selectedItem === 'TU/CL') {
            if (identifier === '응답시간') {
              primaryValue = tuData['응답시간']?.val;
              secondaryValue = clData['응답시간']?.val;
              timeValue = tuData['응답시간']?.time || clData['응답시간']?.time;
            } else {
              primaryValue = tuData[identifier]?.val;
              secondaryValue = clData[identifier]?.val;
              timeValue = tuData[identifier]?.time || clData[identifier]?.time;
            }
          }

          entry.value = String(primaryValue ?? '');
          entry.time = timeValue || '';
          if (activeJob.selectedItem === 'TU/CL') {
            entry.valueTP = String(secondaryValue ?? '');
          }
          
          return entry;
        });

        // Combine state updates for the same job atomically
        setJobs(prevJobs => prevJobs.map(job => {
          if (job.id === activeJob.id) {
            return {
              ...job,
              details: loadedDetails,
              processedOcrData: reconstructedOcrData
            };
          }
          return job;
        }));

        setLoadDraftMessage('데이터를 성공적으로 불러왔습니다.');
        setTimeout(() => setLoadDraftMessage(null), 4000);
      } else {
        throw new Error('불러온 데이터가 현재 작업의 항목과 일치하지 않습니다.');
      }
    } catch (error: any) {
      if (error.message && error.message.includes('저장된 임시 데이터를 찾을 수 없습니다')) {
        alert('저장된 데이터가 없습니다.');
      } else {
        setProcessingError(`가져오기 실패: ${error.message}`);
      }
    } finally {
      setIsLoadingDraft(false);
    }
  }, [activeJob, resetSubmissionState]);
  
  const representativeActiveJobPhoto = useMemo(() => 
    activeJob && activeJob.photos.length > 0 && currentPhotoIndexOfActiveJob !== -1
      ? activeJob.photos[currentPhotoIndexOfActiveJob]
      : null
  , [activeJob, currentPhotoIndexOfActiveJob]);

  const isControlsDisabled = isLoading || isSendingToClaydox || isSavingDraft || isLoadingDraft;
  const isClaydoxDisabled = !activeJob || isControlsDisabled || !siteLocation.trim() || !activeJob.processedOcrData?.some(e => e.value.trim() || (e.valueTP && e.valueTP.trim()));

  return (
    <div className="w-full max-w-3xl bg-slate-800 shadow-2xl rounded-xl p-6 sm:p-8 space-y-6">
      <h2 className="text-2xl font-bold text-sky-400 border-b border-slate-700 pb-3">
        물 분석 (P3)
      </h2>
      
      <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
        <div>
          <label htmlFor="dw-site-location" className="block text-sm font-medium text-slate-300 mb-1">
            현장 위치 (일괄 적용) <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            id="dw-site-location"
            value={siteLocation}
            onChange={(e) => { setSiteLocation(e.target.value); resetSubmissionState(); }}
            disabled={isControlsDisabled}
            required
            className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 text-sm placeholder-slate-400"
            placeholder="예: OO정수장"
          />
        </div>
      </div>


      <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50 space-y-3">
        <h3 className="text-lg font-semibold text-slate-100">새 물 분석 작업 추가</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-1">
            <label htmlFor="new-job-receipt-base" className="block text-xs font-medium text-slate-300 mb-1">접수번호 (공통 부분)</label>
            <input
              type="text"
              id="new-job-receipt-base"
              value={newJobBaseReceiptNumber}
              onChange={(e) => setNewJobBaseReceiptNumber(e.target.value)}
              placeholder="예: 25-000000-01"
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm placeholder-slate-400"
              disabled={isControlsDisabled}
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor="new-job-receipt-suffix" className="block text-xs font-medium text-slate-300 mb-1">접수번호 (세부)</label>
            <input
              type="text"
              id="new-job-receipt-suffix"
              value={newJobSuffixReceiptNumber}
              onChange={(e) => setNewJobSuffixReceiptNumber(e.target.value)}
              placeholder="예: 1"
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm placeholder-slate-400"
              disabled={isControlsDisabled}
            />
          </div>
          <div className="md:col-span-1">
            <label htmlFor="new-job-item" className="block text-xs font-medium text-slate-300 mb-1">항목</label>
            <select
              id="new-job-item"
              value={newJobSelectedItem}
              onChange={(e) => setNewJobSelectedItem(e.target.value)}
              className="block w-full p-2 bg-slate-700 border-slate-500 rounded-md text-sm"
              disabled={isControlsDisabled}
            >
              <option value="" disabled>항목 선택...</option>
              {drinkingWaterItems.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <ActionButton
            onClick={handleAddJob}
            disabled={isControlsDisabled || !newJobBaseReceiptNumber.trim() || !newJobSuffixReceiptNumber.trim() || !newJobSelectedItem}
            className="md:col-span-3 h-9">
            작업 추가
          </ActionButton>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-md font-semibold text-slate-200">정의된 작업 목록 ({jobs.length}개):</h3>
          <div className="max-h-48 overflow-y-auto bg-slate-700/20 p-2 rounded-md border border-slate-600/40 space-y-1.5">
            {jobs.map(job => (
              <div
                key={job.id}
                className={`flex justify-between items-center p-2.5 rounded-md cursor-pointer transition-all ${activeJobId === job.id ? 'bg-sky-600 shadow-md ring-2 ring-sky-400' : 'bg-slate-600 hover:bg-slate-500'
                  }`}
                onClick={() => { setActiveJobId(job.id); setCurrentPhotoIndexOfActiveJob(-1); resetSubmissionState(); }}
              >
                <span className={`text-sm font-medium ${activeJobId === job.id ? 'text-white' : 'text-slate-200'}`}>
                  {job.receiptNumber} / {job.selectedItem} {job.details && `(${job.details})`}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveJob(job.id); }}
                  className="text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-red-500/20 text-xs"
                  aria-label={`${job.receiptNumber} 작업 삭제`}
                  disabled={isControlsDisabled}
                >삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeJob && (
        <div className="space-y-4 pt-8 border-t border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">
            활성 작업: {activeJob.receiptNumber} / {activeJob.selectedItem}
          </h3>
          
          <div className="p-4 bg-slate-700/40 rounded-lg border border-slate-600/50 space-y-4">
            <div>
              <label htmlFor="job-details" className="block text-sm font-medium text-slate-300 mb-1">상세 (편집 가능)</label>
                <input
                  id="job-details"
                  value={activeJob.details}
                  onChange={(e) => handleJobDetailChange('details', e.target.value)}
                  disabled={isControlsDisabled}
                  className="block w-full p-2.5 bg-slate-700 border border-slate-500 rounded-md shadow-sm text-sm"
                  placeholder="상세 위치 (예: B배수지)"
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
            isSendingToClaydox={isSendingToClaydox}
            ktlApiCallStatus={ktlApiCallStatus}
            onSaveDraft={handleSaveDraft}
            onLoadDraft={handleLoadDraft}
            isSavingDraft={isSavingDraft}
            isLoadingDraft={isLoadingDraft}
            saveDraftMessage={saveDraftMessage}
            loadDraftMessage={loadDraftMessage}
            loadDraftReceiptNumber={activeJob ? activeJob.receiptNumber : undefined}
            showSaveDraftWarning={true}
          />

          <div ref={dataTableRef}>
            <OcrResultDisplay
              ocrData={activeJob.processedOcrData}
              error={processingError}
              isLoading={isLoadingDraft}
              contextProvided={true}
              hasImage={false}
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
              ktlJsonToPreview={null}
              draftJsonToPreview={null}
              isManualEntryMode={true}
              decimalPlaces={activeJob.decimalPlaces}
            />
          </div>

          <div className="no-capture flex flex-col md:flex-row gap-4 mt-4">
            {draftJsonPreview && (
                <details className="flex-1 text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
                    <summary className="cursor-pointer text-sm font-medium text-amber-400 hover:text-amber-300">
                        임시 저장용 JSON 미리보기
                    </summary>
                    <pre className="mt-2 text-xs text-slate-300 bg-slate-800 p-3 rounded-md overflow-x-auto max-h-60 border border-slate-700">
                        {draftJsonPreview}
                    </pre>
                </details>
            )}
            {ktlJsonPreview && (
                <details className="flex-1 text-left bg-slate-700/30 p-3 rounded-md border border-slate-600/50">
                    <summary className="cursor-pointer text-sm font-medium text-sky-400 hover:text-sky-300">
                        KTL 전송용 JSON 미리보기
                    </summary>
                    <pre className="mt-2 text-xs text-slate-300 bg-slate-800 p-3 rounded-md overflow-x-auto max-h-60 border border-slate-700">
                        {ktlJsonPreview}
                    </pre>
                    <ActionButton 
                        onClick={() => {
                            if (ktlJsonPreview) {
                                navigator.clipboard.writeText(ktlJsonPreview).then(() => alert('KTL JSON 복사 완료!')).catch(() => alert('복사 실패.'));
                            }
                        }}
                        variant="secondary" 
                        className="text-xs mt-2" 
                        disabled={!ktlJsonPreview} 
                        aria-label="KTL JSON 데이터 클립보드에 복사"
                    >
                        KTL JSON 복사
                    </ActionButton>
                </details>
            )}
           </div>
        </div>
      )}

      {!activeJob && jobs.length > 0 && (
        <p className="text-center text-slate-400 p-4">계속하려면 위 목록에서 작업을 선택하세요.</p>
      )}

      {!activeJob && jobs.length === 0 && (
        <p className="text-center text-slate-400 p-4">시작하려면 '새 물 분석 작업 추가'를 통해 작업을 만드세요.</p>
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

export default DrinkingWaterPage;
