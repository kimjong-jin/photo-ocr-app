
import axios, { AxiosError, AxiosResponse } from 'axios';
import { ExtractedEntry } from '../PhotoLogPage';
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS } from '../shared/constants';
import { MainStructuralItemKey, ChecklistStatus, MAIN_STRUCTURAL_ITEMS, CertificateDetails, CertificatePresenceStatus, StructuralCheckSubItemData, ANALYSIS_IMPOSSIBLE_OPTION, OTHER_DIRECT_INPUT_OPTION, EMISSION_STANDARD_ITEM_NAME, RESPONSE_TIME_ITEM_NAME } from '../shared/structuralChecklists'; 
import { ImageInfo } from '../components/ImageInput';
import { generateCompositeImage, dataURLtoBlob, generateStampedImage } from './imageStampingService';
import JSZip from 'jszip';
import type { StructuralJob } from '../StructuralCheckPage'; // Import StructuralJob type

// --- Global Constants & Helpers ---
const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const UPLOAD_FILES_ENDPOINT = '/uploadfiles';
const KTL_JSON_ENV_ENDPOINT = '/env'; 
const KTL_KAKAO_API_ENDPOINT = '/kakaotalkmsg'; // New endpoint for KakaoTalk
const KTL_API_TIMEOUT = 90000; // 90 seconds

const PROXY_SERVER_URL = 'https://your-ktl-proxy.example.com'; 
const PROXY_URL_PLACEHOLDER = 'https://your-ktl-proxy.example.com';

// --- Interfaces ---
interface KtlApiResponseData {
  message?: string;
  [key: string]: any; 
}

const sanitizeFilename = (name: string): string => {
  if (!name) return 'untitled';
  return name.replace(/[^\w\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\-]+/g, '_').replace(/__+/g, '_');
};

const getFileExtensionFromMime = (mimeType: string): string => {
    if (mimeType.includes('image/jpeg')) return 'jpg';
    if (mimeType.includes('image/png')) return 'png';
    if (mimeType.includes('image/webp')) return 'webp';
    if (mimeType.includes('image/gif')) return 'gif';
    return 'bin';
};

async function retryKtlApiCall<TResponseData>(
  fn: () => Promise<AxiosResponse<TResponseData>>, 
  retries: number = 2, 
  initialDelayMs: number = 2000,
  operationName: string = "KTL API"
): Promise<AxiosResponse<TResponseData>> { 
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const errorMessage = String(err.message || '').toLowerCase();
      const status = err.isAxiosError ? (err as AxiosError).response?.status : undefined;

      const isRetryable = errorMessage.includes("network error") || status === 503 || status === 504;

      if (attempt === retries) { 
        console.error(`[ClaydoxAPI] ${operationName} call failed after ${attempt + 1} attempt(s). Final error:`, lastError.message || lastError);
        if (errorMessage.includes("network error")) {
          const enhancedError = new Error(
            `${operationName} 전송 실패 (네트워크 오류). 인터넷 연결을 확인하거나 잠시 후 다시 시도해 주세요. ` +
            `문제가 지속될 경우 KTL 서버 또는 프록시 서버의 문제일 수 있습니다. (원인: ${lastError.message})`
          );
          // @ts-ignore
          enhancedError.isNetworkError = true;
          throw enhancedError;
        }
      } else if (!isRetryable) { 
         console.error(`[ClaydoxAPI] ${operationName} call failed with non-retryable error (attempt ${attempt + 1}). Error:`, lastError.message || lastError);
        break; 
      }

      const waitTime = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[ClaydoxAPI] ${operationName} call failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${waitTime}ms... Error:`, err.message || err);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError; 
}


// --- START: Page 1 (Photo Log / OCR Data) Functionality ---

export interface ClaydoxPayload {
  receiptNumber: string;
  siteLocation: string;
  item: string;
  inspectionStartDate?: string;
  ocrData: ExtractedEntry[];
  updateUser: string;
  uniqueIdentifiersForNaming?: string[];
  identifierSequence?: string;
  maxDecimalPlaces?: number;
  pageType?: 'PhotoLog' | 'FieldCount';
}

const constructPhotoLogKtlJsonObject = (
  payload: ClaydoxPayload,
  selectedItem: string, // selectedItem is payload.item, but kept for function signature consistency if called elsewhere.
  actualKtlFileNames: string[],
  maxDecimalPlaces?: number 
): any => {
  const labviewItemObject: { [key: string]: string } = {};

  const compositePhotoFileName = actualKtlFileNames.find(name => name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png'));
  const zipPhotoFileName = actualKtlFileNames.find(name => name.endsWith('.zip'));

  payload.ocrData.forEach(entry => {
    if (entry.identifier && typeof entry.value === 'string') {
      const numericValueMatch = entry.value.match(/^-?\d+(\.\d+)?/);
      const valueToUse = numericValueMatch ? numericValueMatch[0] : null;
      if (valueToUse !== null) {
        labviewItemObject[entry.identifier] = valueToUse;
      }
    }
    if (payload.item === "TN/TP" && entry.identifierTP && typeof entry.valueTP === 'string') { // Use payload.item here
        const numericValueTPMatch = entry.valueTP.match(/^-?\d+(\.\d+)?/);
        const valueTPToUse = numericValueTPMatch ? numericValueTPMatch[0] : null;
        if (valueTPToUse !== null) {
            labviewItemObject[entry.identifierTP] = valueTPToUse;
        }
    }
  });

  let photoKeyBase: string | null = null;
  if (labviewItemObject.hasOwnProperty("M1")) {
    photoKeyBase = "M1";
  } else if (payload.item === "TN/TP" && labviewItemObject.hasOwnProperty("M1P")) { // Use payload.item here
    photoKeyBase = "M1P";
  }

  if (photoKeyBase) {
    if (compositePhotoFileName) {
      labviewItemObject[`${photoKeyBase}_사진`] = compositePhotoFileName;
    }
    if (zipPhotoFileName) {
      labviewItemObject[`${photoKeyBase}_압축`] = zipPhotoFileName;
    }
  } else {
    if (compositePhotoFileName) {
      labviewItemObject["PHOTO_사진"] = compositePhotoFileName;
    }
    if (zipPhotoFileName) {
      labviewItemObject["PHOTO_압축"] = zipPhotoFileName;
    }
  }

  if (payload.ocrData.length === 0) {
      if (compositePhotoFileName && !labviewItemObject["PHOTO_사진"] && (!photoKeyBase || !labviewItemObject[`${photoKeyBase}_사진`])) {
           labviewItemObject["PHOTO_사진"] = compositePhotoFileName;
      }
      if (zipPhotoFileName && !labviewItemObject["PHOTO_압축"] && (!photoKeyBase || !labviewItemObject[`${photoKeyBase}_압축`])) {
           labviewItemObject["PHOTO_압축"] = zipPhotoFileName;
      }
  }


  if (payload.identifierSequence && payload.identifierSequence.length > 0) {
    labviewItemObject['sequence_code'] = payload.identifierSequence;
  }

  if (typeof maxDecimalPlaces === 'number' && maxDecimalPlaces >= 0) {
    labviewItemObject["소수점"] = String(maxDecimalPlaces);
  }

  if (payload.updateUser) {
    labviewItemObject["시험자"] = payload.updateUser;
  }

  const labviewDescComment = `수질 (항목: ${payload.item}, 현장: ${payload.siteLocation})`;
  const labviewDescObject = { comment: labviewDescComment };
  
  const gubnPrefix = payload.pageType === 'FieldCount' ? '현장계수' : '수질';
  const dynamicLabviewGubn = `${gubnPrefix}_${payload.item.replace('/', '_')}`; // Handle "TN/TP" to "TN_TP"

  return {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify(labviewDescObject),
    LABVIEW_RECEIPTNO: payload.receiptNumber,
    UPDATE_USER: payload.updateUser,
    LABVIEW_ITEM: JSON.stringify(labviewItemObject),
  };
};

const KTL_KEY_ORDER = ['LABVIEW_GUBN', 'LABVIEW_DESC', 'LABVIEW_RECEIPTNO', 'UPDATE_USER', 'LABVIEW_ITEM'];

export const generateKtlJsonForPreview = (
  payload: ClaydoxPayload,
  selectedItem: string, // This matches payload.item
  actualKtlFileNames: string[],
  maxDecimalPlaces?: number 
): string => {
  const ktlJsonObject = constructPhotoLogKtlJsonObject(payload, selectedItem, actualKtlFileNames, maxDecimalPlaces); 
  return JSON.stringify(ktlJsonObject, KTL_KEY_ORDER, 2);
};

export const sendToClaydoxApi = async (
  payload: ClaydoxPayload,
  filesToUploadWithOriginalNames: File[],
  selectedItem: string, // This matches payload.item
  actualKtlFileNamesOnServer: string[]
): Promise<{ message: string; data?: KtlApiResponseData }> => {
  const formData = new FormData();
  filesToUploadWithOriginalNames.forEach(file => {
    formData.append('files', file, file.name);
  });

  try {
    if (filesToUploadWithOriginalNames.length > 0) {
      console.log('[ClaydoxAPI - Page 1] Uploading files:', filesToUploadWithOriginalNames.map(f => f.name));
      await retryKtlApiCall<KtlApiResponseData>( 
        () => axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: KTL_API_TIMEOUT,
        }),
        2, 2000, "Page 1 File Upload"
      );
      console.log('[ClaydoxAPI - Page 1] Files uploaded successfully.');
    }

    const ktlJsonObject = constructPhotoLogKtlJsonObject(payload, selectedItem, actualKtlFileNamesOnServer, payload.maxDecimalPlaces); 
    console.log('[ClaydoxAPI - Page 1] Sending JSON data to KTL:', ktlJsonObject);

    const jsonResponse = await retryKtlApiCall<KtlApiResponseData>(
      () => axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`, ktlJsonObject, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        timeout: KTL_API_TIMEOUT,
      }),
      2, 2000, "Page 1 JSON Data Send to /env"
    );
    console.log('[ClaydoxAPI - Page 1] JSON sent successfully. Response:', jsonResponse.data);
    return { message: jsonResponse.data?.message || '데이터 및 파일 전송 완료 (Page 1)', data: jsonResponse.data };

  } catch (error: any) {
    let errorMsg = '알 수 없는 오류 발생 (Page 1)';
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError; 
        const responseData = axiosError.response?.data;
        console.error('[ClaydoxAPI - Page 1] KTL API Error after retries:', responseData || axiosError.message);
        
        if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof responseData.message === 'string') {
            errorMsg = responseData.message;
        } else if (typeof responseData === 'string') { 
            if (responseData.trim().length > 0 && responseData.length < 500) {
                errorMsg = responseData.trim();
            } else {
                 errorMsg = axiosError.message || 'KTL API 응답 문자열 처리 오류 (Page 1)';
            }
        } else if (axiosError.message) {
            errorMsg = axiosError.message;
        } else {
            errorMsg = 'KTL API와 통신 중 알 수 없는 오류가 발생했습니다. (Page 1)';
        }
    } else { 
        // @ts-ignore
        errorMsg = error.isNetworkError ? error.message : (error.message || '알 수 없는 비-Axios 오류 발생 (Page 1)');
    }
    console.error('[ClaydoxAPI - Page 1] Final error message to throw:', errorMsg);
    throw new Error(errorMsg);
  }
};

// --- END: Page 1 (Photo Log / OCR Data) Functionality ---


// --- START: Page 2 (Structural Check) Functionality ---

interface StructuralCheckPayloadForKtl {
  receiptNumber: string;
  siteLocation: string;
  mainItemKey: MainStructuralItemKey;
  inspectionStartDate?: string;
  checklistData: Record<string, StructuralCheckSubItemData>; 
  updateUser: string;
  photos?: ImageInfo[];
  photoFileNames: {
  };
  checklistImageFileName?: string;
  postInspectionDateValue?: string; 
}

export interface ClaydoxJobPhoto extends ImageInfo {
    uid: string;
    jobId: string;
    jobReceipt: string;
    jobItemKey: MainStructuralItemKey;
    jobItemName: string;
}

const constructMergedLabviewItemForStructural = (
  jobsInGroup: StructuralCheckPayloadForKtl[],
  userNameGlobal: string, 
  masterCompositeImageNameOnServer?: string, 
  masterZipFileNameOnServer?: string      
): any => {
  const mergedItems: any = {};
  jobsInGroup.forEach(payload => {
    if (payload.postInspectionDateValue) {
        let periodValue = payload.postInspectionDateValue; 
        let ktlPeriodValue = "";

        if (periodValue === "1년 후") {
            ktlPeriodValue = "1년후";
        } else if (periodValue === "2년 후") {
            ktlPeriodValue = "2년후";
        }
        
        if (ktlPeriodValue) { 
            const periodKey = `구조_사후검사일${payload.mainItemKey === 'TP' ? 'P' : ''}_주기`;
            mergedItems[periodKey] = ktlPeriodValue;
        }
    }

    if (payload.mainItemKey === 'TOC') {
        const emissionStandardData = payload.checklistData[EMISSION_STANDARD_ITEM_NAME];
        if (emissionStandardData && emissionStandardData.notes && emissionStandardData.notes.trim() !== '') {
            mergedItems["구조_배출기준_입력값"] = emissionStandardData.notes.trim();
        }
        const responseTimeData = payload.checklistData[RESPONSE_TIME_ITEM_NAME];
        if (responseTimeData && responseTimeData.notes && responseTimeData.notes.trim() !== '') {
            mergedItems["구조_응답시간_입력값"] = responseTimeData.notes.trim();
        }
    }

    Object.entries(payload.checklistData).forEach(([checklistItemName, data]) => {
        // Skip special TOC items as they are handled above or don't fit the standard pattern
        if (payload.mainItemKey === 'TOC' && (checklistItemName === EMISSION_STANDARD_ITEM_NAME || checklistItemName === RESPONSE_TIME_ITEM_NAME)) {
            return; 
        }

        const sanitizedChecklistItemName = sanitizeFilename(checklistItemName).replace(/_/g, '');
        
        let baseKeyForData = `구조_${sanitizedChecklistItemName}`;
        if (payload.mainItemKey === 'TP') {
            baseKeyForData = `구조_${sanitizedChecklistItemName}P`;
        }

        let statusForKtl: string;
        if (data.status === '선택 안됨') {
            statusForKtl = '';
        } else if (data.status === '적합') {
            statusForKtl = '적 합'; 
        } else {
            statusForKtl = data.status;
        }
        mergedItems[`${baseKeyForData}_상태`] = statusForKtl;

        if (data.confirmedAt && data.confirmedAt.trim() !== '') {
            mergedItems[`${baseKeyForData}_확인일시`] = data.confirmedAt.trim();
        }
        
        if (checklistItemName === "측정범위확인") {
            mergedItems[`${baseKeyForData}_노트`] = data.notes || '';
            let upperLimitValue = '';
            const notesTrimmed = data.notes?.trim();
            if (notesTrimmed && notesTrimmed !== ANALYSIS_IMPOSSIBLE_OPTION) {
                let effectiveRangeString = notesTrimmed;
                if (notesTrimmed.startsWith(OTHER_DIRECT_INPUT_OPTION)) {
                    const matchInParentheses = notesTrimmed.match(/\(([^)]+)\)/);
                    if (matchInParentheses && matchInParentheses[1]) {
                        effectiveRangeString = matchInParentheses[1].trim();
                    } else {
                        effectiveRangeString = ''; 
                    }
                }
                if (effectiveRangeString) {
                    const numbersInString = effectiveRangeString.match(/\d+(\.\d+)?/g);
                    if (numbersInString && numbersInString.length > 0) {
                        upperLimitValue = numbersInString[numbersInString.length - 1];
                    }
                }
            }
            mergedItems[`${baseKeyForData}_상한값`] = upperLimitValue;
        } else if (data.specialNotes && data.specialNotes.trim() !== '') {
             mergedItems[`${baseKeyForData}_특이사항`] = data.specialNotes.trim();
        }


        if (checklistItemName === "정도검사 증명서" && data.notes) {
            try {
                const certDetails: CertificateDetails = JSON.parse(data.notes);
                let statusText = '';
                switch(certDetails.presence) {
                    case 'present': statusText = '있음'; break;
                    case 'initial_new': statusText = '최초정도검사'; break;
                    case 'reissued_lost': statusText = '분실 후 재발행'; break;
                    default: statusText = certDetails.presence && certDetails.presence !== 'not_selected' ? String(certDetails.presence) : '선택 안됨';
                }
                mergedItems[`${baseKeyForData}_세부상태`] = statusText;

                if (certDetails.productName && certDetails.productName.trim() !== '') {
                    mergedItems[`${baseKeyForData}_품명`] = certDetails.productName.trim();
                }
                if (certDetails.manufacturer && certDetails.manufacturer.trim() !== '') {
                    mergedItems[`${baseKeyForData}_제작사`] = certDetails.manufacturer.trim();
                }
                if (certDetails.serialNumber && certDetails.serialNumber.trim() !== '') {
                    mergedItems[`${baseKeyForData}_기기번호`] = certDetails.serialNumber.trim();
                }
                if (certDetails.typeApprovalNumber && certDetails.typeApprovalNumber.trim() !== '') {
                    mergedItems[`${baseKeyForData}_번호`] = certDetails.typeApprovalNumber.trim();
                }
                if (certDetails.inspectionDate && certDetails.inspectionDate.trim() !== '') {
                    const formattedInspectionDate = certDetails.inspectionDate.replace(/\s/g, '').replace(/\./g, '-');
                    mergedItems[`${baseKeyForData}_검사일자`] = formattedInspectionDate;
                }
                if (certDetails.validity && certDetails.validity.trim() !== '') {
                    const formattedValidity = certDetails.validity.replace(/\s/g, '').replace(/\./g, '-');
                    mergedItems[`${baseKeyForData}_유효기간`] = formattedValidity;
                }
                if (certDetails.previousReceiptNumber && certDetails.previousReceiptNumber.trim() !== '') {
                    mergedItems[`${baseKeyForData}_직전접수번호`] = certDetails.previousReceiptNumber.trim();
                }
                if (certDetails.specialNotes && certDetails.specialNotes.trim() !== '' && !mergedItems[`${baseKeyForData}_특이사항`]) { 
                   mergedItems[`${baseKeyForData}_특이사항`] = certDetails.specialNotes.trim();
                }

            } catch (e) { 
                if (data.notes && data.notes.trim() !== '' && !mergedItems[`${baseKeyForData}_특이사항`]) {
                     mergedItems[`${baseKeyForData}_노트`] = data.notes.trim(); 
                }
            }
        } else if (checklistItemName === "표시사항확인") {
          let successfullyParsedAndExpanded = false;
          if (data.notes && data.notes.trim().startsWith("{") && data.notes.trim().endsWith("}")) {
            try {
              const parsedNotes = JSON.parse(data.notes);
              if (typeof parsedNotes === 'object' && parsedNotes !== null) {
                for (const [key, value] of Object.entries(parsedNotes)) {
                  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    const sanitizedExtractedKey = sanitizeFilename(key).replace(/_/g, '');
                    mergedItems[`${baseKeyForData}_${sanitizedExtractedKey}`] = String(value);
                  }
                }
                successfullyParsedAndExpanded = true;
              }
            } catch (parseError) { /* console.warn(...) */ }
          }
          if (!successfullyParsedAndExpanded && data.notes && data.notes.trim() !== '' && !mergedItems[`${baseKeyForData}_특이사항`]) {
            mergedItems[`${baseKeyForData}_노트`] = data.notes.trim();
          }
        } else { 
          if (data.notes && data.notes.trim() !== '' && !mergedItems[`${baseKeyForData}_특이사항`]) { 
            mergedItems[`${baseKeyForData}_노트`] = data.notes.trim();
          }
        }
    });

    let baseFileKey = "구조";
    if (payload.mainItemKey === 'TP') {
        baseFileKey = "구조P";
    }

    if (payload.checklistImageFileName) {
        mergedItems[`${baseFileKey}_체크리스트사진`] = payload.checklistImageFileName;
    }
    if (masterCompositeImageNameOnServer) { 
        mergedItems[`${baseFileKey}_개별사진묶음`] = masterCompositeImageNameOnServer;
    }
    if (masterZipFileNameOnServer) {
        mergedItems[`${baseFileKey}_압축`] = masterZipFileNameOnServer;
    }
  });

  if (userNameGlobal) {
    mergedItems["시험자"] = userNameGlobal;
  }
  return mergedItems;
};


export const generateStructuralKtlJsonForPreview = (
  jobPayloadsForReceipt: StructuralCheckPayloadForKtl[],
  siteLocationGlobal: string,
  inspectionStartDateFromUi: string | undefined,
  userNameGlobal: string,
  hypotheticalCompositeImageName?: string,
  hypotheticalMasterZipName?: string 
): string => {
  if (!jobPayloadsForReceipt || jobPayloadsForReceipt.length === 0) {
    return "미리보기할 작업 데이터가 없습니다.";
  }
  const firstPayload = jobPayloadsForReceipt[0];

  const payloadsWithHypotheticalFileNames = jobPayloadsForReceipt.map(p => {
    const receiptSanitized = sanitizeFilename(p.receiptNumber);
    let checklistImageNamePart = "";
    if (p.mainItemKey === 'TN') {
    } else if (p.mainItemKey === 'TP') {
        checklistImageNamePart = "P"; 
    } else {
        checklistImageNamePart = sanitizeFilename(p.mainItemKey);
    }
    const finalChecklistImageName = `${receiptSanitized}${checklistImageNamePart ? `_${checklistImageNamePart}` : ''}_checklist.png`;

    return {
      ...p,
      photoFileNames: {}, 
      checklistImageFileName: finalChecklistImageName 
    };
  });

  const mergedLabviewItem = constructMergedLabviewItemForStructural(
    payloadsWithHypotheticalFileNames, 
    userNameGlobal, 
    hypotheticalCompositeImageName, 
    hypotheticalMasterZipName      
  );

  const mainItemNamesForDesc = Array.from(new Set(jobPayloadsForReceipt.map(p =>
    MAIN_STRUCTURAL_ITEMS.find(it => it.key === p.mainItemKey)?.name || p.mainItemKey
  )));

  let labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(', ')}, 현장: ${siteLocationGlobal}`;
  if (inspectionStartDateFromUi) {
    labviewDescComment += `, 검사시작일: ${inspectionStartDateFromUi}`;
  }
  const labviewDescObject = { comment: labviewDescComment };

  const uniqueMainItemKeys = Array.from(new Set(jobPayloadsForReceipt.map(job => job.mainItemKey))).sort();
  const dynamicLabviewGubn = `구조_${uniqueMainItemKeys.join(',')}`;

  const objectToFormat = {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify(labviewDescObject),
    LABVIEW_RECEIPTNO: firstPayload.receiptNumber,
    UPDATE_USER: userNameGlobal,
    LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
  };

  return JSON.stringify(objectToFormat, KTL_KEY_ORDER, 2);
};

export const generateCompositeImageNameForKtl = ( 
    receiptNumber: string
): string => {
    const sanitizedReceipt = sanitizeFilename(receiptNumber);
    return `${sanitizedReceipt}_composite.png`;
};

export const generateZipFileNameForKtl = (
    receiptNumber: string
): string => {
    const sanitizedReceipt = sanitizeFilename(receiptNumber);
    return `${sanitizedReceipt}_압축.zip`;
}


export const sendBatchStructuralChecksToKtlApi = async (
  jobs: StructuralJob[],
  generatedChecklistImages: ImageInfo[],
  siteLocationGlobal: string,
  inspectionStartDateFromUi: string | undefined,
  userNameGlobal: string
): Promise<{ receiptNo: string, mainItem: string, success: boolean, message: string }[]> => {

  const results: { receiptNo: string, mainItem: string, success: boolean, message: string }[] = [];
  const filesToUploadDirectly: File[] = [];
  const receiptToCompositeFileNameMap: Map<string, string> = new Map();
  const receiptToZipFileNameMap: Map<string, string> = new Map(); 

  // Reconstruct necessary data structures from jobs array
  const payloadsForKtlService: StructuralCheckPayloadForKtl[] = [];
  const allJobPhotosForService: ClaydoxJobPhoto[] = [];
  for (const job of jobs) {
    job.photos.forEach(photo => {
      allJobPhotosForService.push({
        ...photo,
        jobId: job.id,
        jobReceipt: job.receiptNumber,
        jobItemKey: job.mainItemKey,
        jobItemName: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
      });
    });
    payloadsForKtlService.push({
      receiptNumber: job.receiptNumber,
      siteLocation: siteLocationGlobal,
      mainItemKey: job.mainItemKey,
      checklistData: job.checklistData,
      updateUser: userNameGlobal,
      photoFileNames: {}, 
      postInspectionDateValue: job.postInspectionDate,
    });
  }

  const uniqueReceiptNumbersInBatch = Array.from(new Set(jobs.map(job => job.receiptNumber)));

  for (const receiptNo of uniqueReceiptNumbersInBatch) {
    const photosForThisReceipt = allJobPhotosForService.filter(p => p.jobReceipt === receiptNo);
    
    if (photosForThisReceipt.length > 0) {
      const imageSourcesForComposite = photosForThisReceipt.map(p => ({ base64: p.base64, mimeType: p.mimeType }));
      const itemsForThisReceipt = jobs
        .filter(job => job.receiptNumber === receiptNo)
        .map(job => MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey);
      const itemSummaryForStamp = Array.from(new Set(itemsForThisReceipt)).join(', ');

      const stampDetailsComposite = {
        receiptNumber: receiptNo,
        siteLocation: siteLocationGlobal,
        item: itemSummaryForStamp,
        inspectionStartDate: inspectionStartDateFromUi,
      };

      try {
        const compositeDataUrl = await generateCompositeImage(
          imageSourcesForComposite,
          stampDetailsComposite,
          'image/png'
        );
        const compositeBlob = dataURLtoBlob(compositeDataUrl);
        const compositeFileNameOnServer = generateCompositeImageNameForKtl(receiptNo);
        const compositeFile = new File([compositeBlob], compositeFileNameOnServer, { type: 'image/png' });
        
        filesToUploadDirectly.push(compositeFile);
        receiptToCompositeFileNameMap.set(receiptNo, compositeFileNameOnServer);
      } catch (compositeGenError: any) {
        console.error(`[ClaydoxAPI - Page 2] Error generating composite image for ${receiptNo}:`, compositeGenError);
        jobs.filter(j => j.receiptNumber === receiptNo).forEach(job => {
          if (!results.find(r => r.receiptNo === job.receiptNumber && r.mainItem === (MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey))) {
            results.push({
              receiptNo: job.receiptNumber,
              mainItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
              success: false,
              message: `참고사진 종합 이미지 생성 실패: ${compositeGenError.message || '알 수 없는 오류'}`,
            });
          }
        });
        continue; 
      }
    }

    if (photosForThisReceipt.length > 0) {
        const zip = new JSZip();
        let photoIndexInZip = 1;
        for (const photo of photosForThisReceipt) {
            try {
                const sourceJob = jobs.find(j => j.id === photo.jobId);
                const comment = sourceJob?.photoComments[photo.uid];

                const stampedPhotoDataUrl = await generateStampedImage(
                    photo.base64,
                    photo.mimeType,
                    photo.jobReceipt,
                    siteLocationGlobal,
                    inspectionStartDateFromUi || '', 
                    photo.jobItemName,
                    comment
                );
                const stampedBlob = dataURLtoBlob(stampedPhotoDataUrl);
                const sanitizedItemKey = sanitizeFilename(photo.jobItemKey);
                const extension = getFileExtensionFromMime(photo.mimeType);
                const fileNameInZip = `${sanitizeFilename(photo.jobReceipt)}_${sanitizedItemKey}_${photoIndexInZip++}.${extension}`;
                zip.file(fileNameInZip, stampedBlob);
            } catch (stampError: any) {
                 console.error(`[ClaydoxAPI - Page 2] Error stamping individual photo ${photo.file.name} for ZIP for ${receiptNo}:`, stampError);
            }
        }
        if (Object.keys(zip.files).length > 0) { 
            try {
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const zipFileNameOnServer = generateZipFileNameForKtl(receiptNo);
                const zipFile = new File([zipBlob], zipFileNameOnServer, { type: 'application/zip' });
                filesToUploadDirectly.push(zipFile);
                receiptToZipFileNameMap.set(receiptNo, zipFileNameOnServer);
            } catch (zipGenError: any) {
                 console.error(`[ClaydoxAPI - Page 2] Error generating ZIP file for ${receiptNo}:`, zipGenError);
                 jobs.filter(j => j.receiptNumber === receiptNo).forEach(job => {
                    if (!results.find(r => r.receiptNo === job.receiptNumber && r.mainItem === (MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey) && r.message.includes("ZIP 생성 실패"))) {
                        results.push({
                          receiptNo: job.receiptNumber,
                          mainItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
                          success: false,
                          message: `참고사진 ZIP 생성 실패: ${zipGenError.message || '알 수 없는 오류'}`,
                        });
                    }
                 });
            }
        }
    }
  }
  
  generatedChecklistImages.forEach(chkImgInfo => {
    const blob = dataURLtoBlob(`data:${chkImgInfo.mimeType};base64,${chkImgInfo.base64}`);
    const file = new File([blob], chkImgInfo.file.name, { type: chkImgInfo.mimeType });
    filesToUploadDirectly.push(file);
    
    const relatedJobStrict = payloadsForKtlService.find(jp => {
        const receiptSanitized = sanitizeFilename(jp.receiptNumber);
        let itemPartForFilename = "";
        if (jp.mainItemKey === 'TN') itemPartForFilename = ""; 
        else if (jp.mainItemKey === 'TP') itemPartForFilename = "P"; 
        else itemPartForFilename = sanitizeFilename(jp.mainItemKey);
        
        const expectedFilename = `${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`;
        return chkImgInfo.file.name === expectedFilename;
    });

    if (relatedJobStrict) {
        relatedJobStrict.checklistImageFileName = chkImgInfo.file.name;
    } else {
        console.warn(`[ClaydoxAPI - Page 2] Could not find related job for checklist image: ${chkImgInfo.file.name}`);
    }
  });

  if (filesToUploadDirectly.length > 0) {
    const formDataForAllUploads = new FormData();
    filesToUploadDirectly.forEach(file => {
        formDataForAllUploads.append('files', file, file.name);
    });
    try {
        console.log('[ClaydoxAPI - Page 2] Uploading all files directly to KTL /uploadfiles:', filesToUploadDirectly.map(f => f.name));
        await retryKtlApiCall<KtlApiResponseData>( 
          () => axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, formDataForAllUploads, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: KTL_API_TIMEOUT,
          }),
          2, 2000, "Page 2 All Files Upload (Direct to KTL /uploadfiles)"
        );
        console.log('[ClaydoxAPI - Page 2] All files for Page 2 uploaded successfully to KTL /uploadfiles.');
    } catch (filesUploadError: any) {
        console.error('[ClaydoxAPI - Page 2] Files upload to KTL /uploadfiles failed:', filesUploadError);
         jobs.forEach(job => {
            if (!results.find(r => r.receiptNo === job.receiptNumber && (MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey) === r.mainItem)) {
              results.push({
                  receiptNo: job.receiptNumber,
                  mainItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
                  success: false,
                  message: `파일 업로드 실패 (KTL /uploadfiles): ${filesUploadError.message || '알 수 없는 파일 업로드 오류'}`,
              });
            }
         });
        return results; 
    }
  }

  const jobsByReceiptNumber: Record<string, StructuralCheckPayloadForKtl[]> = {};
  payloadsForKtlService.forEach(payload => {
    payload.inspectionStartDate = inspectionStartDateFromUi; 
    if (!jobsByReceiptNumber[payload.receiptNumber]) {
      jobsByReceiptNumber[payload.receiptNumber] = [];
    }
    jobsByReceiptNumber[payload.receiptNumber].push(payload);
  });

  for (const receiptNo in jobsByReceiptNumber) {
    const currentGroupOfJobs = jobsByReceiptNumber[receiptNo];
    const compositeFileNameForThisReceipt = receiptToCompositeFileNameMap.get(receiptNo);
    const zipFileNameForThisReceipt = receiptToZipFileNameMap.get(receiptNo); 

    const mergedLabviewItem = constructMergedLabviewItemForStructural(
        currentGroupOfJobs, 
        userNameGlobal, 
        compositeFileNameForThisReceipt, 
        zipFileNameForThisReceipt       
    );

    const mainItemNamesForDesc = Array.from(new Set(currentGroupOfJobs.map(p =>
      MAIN_STRUCTURAL_ITEMS.find(it => it.key === p.mainItemKey)?.name || p.mainItemKey
    )));

    let labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(', ')}, 현장: ${siteLocationGlobal}`;
    if (inspectionStartDateFromUi) {
      labviewDescComment += `, 검사시작일: ${inspectionStartDateFromUi}`;
    }
    const labviewDescObject = { comment: labviewDescComment };

    const uniqueMainItemKeys = Array.from(new Set(currentGroupOfJobs.map(job => job.mainItemKey))).sort();
    const dynamicLabviewGubn = `구조_${uniqueMainItemKeys.join(',')}`;

    const finalKtlJsonObject = {
      LABVIEW_GUBN: dynamicLabviewGubn,
      LABVIEW_DESC: JSON.stringify(labviewDescObject),
      LABVIEW_RECEIPTNO: receiptNo,
      UPDATE_USER: userNameGlobal,
      LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
    };

    const jsonTargetUrl = `${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`;
    const operationLogName = `Page 2 JSON Send for ${receiptNo} directly to /env`;
    
    console.log(`[ClaydoxAPI - Page 2] Sending MERGED JSON for ${receiptNo} (Items: ${mainItemNamesForDesc.join(', ')}) directly to URL: ${jsonTargetUrl}`);
    console.log(`[ClaydoxAPI - Page 2] Stringified JSON length for ${receiptNo}: ${JSON.stringify(finalKtlJsonObject).length}`);

    try {
      const jsonResponse = await retryKtlApiCall<KtlApiResponseData>(
        () => axios.post<KtlApiResponseData>(jsonTargetUrl, finalKtlJsonObject, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json' 
          },
          timeout: KTL_API_TIMEOUT,
        }),
        2, 2000, operationLogName
      );

      console.log(`[ClaydoxAPI - Page 2] MERGED JSON for ${receiptNo} sent. Response:`, jsonResponse.data);
      currentGroupOfJobs.forEach(job => {
          results.push({
              receiptNo: job.receiptNumber,
              mainItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
              success: true, 
              message: jsonResponse.data?.message || `성공`,
          });
      });
    } catch (error: any) {
      let errorMsg = `알 수 없는 오류 (직접 전송)`;
      if (axios.isAxiosError(error)) { 
        const axiosError = error as AxiosError; 
        const responseData = axiosError.response?.data;
        console.error(`[ClaydoxAPI - Page 2] Axios MERGED JSON send for ${receiptNo} directly to /env failed. TargetURL: ${jsonTargetUrl}. Error:`, responseData || axiosError.message);
        
        if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof responseData.message === 'string') {
            errorMsg = responseData.message;
        } else if (typeof responseData === 'string') { 
            if (responseData.trim().length > 0 && responseData.length < 500 ) {
                errorMsg = responseData.trim();
            } else {
                errorMsg = axiosError.message || `KTL API 응답 문자열 처리 오류 (${receiptNo}, 직접 Axios 오류)`;
            }
        } else if (axiosError.message) { 
            errorMsg = axiosError.message;
        } else {
            errorMsg = `KTL 서버와 통신 중 알 수 없는 오류 (${receiptNo}, 직접 Axios 오류)`;
        }
      } else { 
        // @ts-ignore
        errorMsg = error.isNetworkError ? error.message : (error.message || `알 수 없는 비-Axios 오류 (${receiptNo}, 직접 전송)`);
      }
      console.error(`[ClaydoxAPI - Page 2] Final error message for ${receiptNo} (direct to /env):`, errorMsg);
      currentGroupOfJobs.forEach(job => {
          results.push({
              receiptNo: job.receiptNumber,
              mainItem: MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey,
              success: false,
              message: `JSON 전송 실패 (직접 전송): ${errorMsg}`,
          });
      });
    }
  }
  return results;
};

// --- END: Page 2 (Structural Check) Functionality ---

// --- START: Page 3 (KakaoTalk) Functionality ---

const KAKAO_API_KEY = '9f04ece57d9f1f613b8888dae1997c57d3f';

interface KakaoTalkInnerPayload {
  APIKEY: string;
  MSG: string;
  PHONE: string;
  RESERVETIME?: string;
}

export const sendKakaoTalkMessage = async (
  message: string,
  phoneNumbers: string,
  reservationTime?: string
): Promise<{ message: string; data?: KtlApiResponseData }> => {
  const innerPayload: KakaoTalkInnerPayload = {
    APIKEY: KAKAO_API_KEY,
    MSG: message,
    PHONE: phoneNumbers,
  };

  if (reservationTime) {
    innerPayload.RESERVETIME = reservationTime;
  }

  const labviewItemValue = JSON.stringify(innerPayload);

  // The KTL Kakao API expects a JSON payload with a single key, "LABVIEW_ITEM",
  // whose value is a stringified JSON object containing the actual parameters.
  const payloadForJsonRequest = {
    LABVIEW_ITEM: labviewItemValue,
  };

  try {
    console.log('[ClaydoxAPI - Page 3] Sending KakaoTalk message with payload:', labviewItemValue);
    const response = await retryKtlApiCall<KtlApiResponseData>(
      () => axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_KAKAO_API_ENDPOINT}`, payloadForJsonRequest, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: KTL_API_TIMEOUT,
      }),
      2, 2000, "Page 3 KakaoTalk Send"
    );
    console.log('[ClaydoxAPI - Page 3] KakaoTalk message sent. Response:', response.data);
    return { message: response.data?.message || '카카오톡 메시지 전송 요청 완료', data: response.data };

  } catch (error: any) {
    let errorMsg = '알 수 없는 오류 발생 (Page 3)';
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const responseData = axiosError.response?.data;
         if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof responseData.message === 'string') {
            errorMsg = responseData.message;
        } else if (typeof responseData === 'string' && responseData.length < 500 && responseData.trim()) {
            errorMsg = responseData.trim();
        } else if (axiosError.message) {
            errorMsg = axiosError.message;
        } else {
            errorMsg = 'KTL API와 통신 중 알 수 없는 오류가 발생했습니다. (Page 3)';
        }
    } else {
        errorMsg = error.message || '알 수 없는 비-Axios 오류 발생 (Page 3)';
    }
    console.error('[ClaydoxAPI - Page 3] Final error message to throw:', errorMsg);
    throw new Error(errorMsg);
  }
};

// --- END: Page 3 (KakaoTalk) Functionality ---
