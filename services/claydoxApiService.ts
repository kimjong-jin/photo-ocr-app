//claydoxApiService.ts
import axios, { AxiosError, AxiosResponse } from 'axios';
import type { ExtractedEntry } from '../shared/types';
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS, ANALYSIS_ITEM_GROUPS, P3_TN_IDENTIFIERS, P3_TP_IDENTIFIERS } from '../shared/constants';
import {
  MainStructuralItemKey,
  ChecklistStatus,
  MAIN_STRUCTURAL_ITEMS,
  CertificateDetails,
  CertificatePresenceStatus,
  StructuralCheckSubItemData,
  ANALYSIS_IMPOSSIBLE_OPTION,
  OTHER_DIRECT_INPUT_OPTION,
  EMISSION_STANDARD_ITEM_NAME,
  RESPONSE_TIME_ITEM_NAME
} from '../shared/StructuralChecklists';
import { ImageInfo } from '../components/ImageInput';
import { generateCompositeImage, dataURLtoBlob, generateStampedImage, CompositeImageInput, compressImage } from './imageStampingService';
import JSZip from 'jszip';
import type { StructuralJob } from '../StructuralCheckPage';
import { supabase } from './supabaseClient';

// --- Global Constants & Helpers ---
const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const UPLOAD_FILES_ENDPOINT = '/uploadfiles';
const KTL_JSON_ENV_ENDPOINT = '/env';
const KTL_KAKAO_API_ENDPOINT = '/kakaotalkmsg';
const KTL_API_TIMEOUT = 300000; // 5 minutes (increased from 90000)

// === Composite naming helpers for Photo Log (Page 1) ===
// 여러 장 합성 JPG를 M1→M2→M3→Z1→Z2→S1→S2… 순으로 매핑할 때 쓰는 기본 키 순서
const DEFAULT_PHOTO_KEY_ORDER = [
  'M1','M2','M3',
  'Z1','Z2',
  'S1','S2','S3','S4','S5','S6','S7','S8','S9','S10'
];

// 파일명 "..._composite_07.jpg"에서 7을 뽑아 정렬에 사용
function extractCompositeNo(name: string): number {
  const m = name.match(/_composite_(\d+)\.(jpg|jpeg|png)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

// --- Interfaces ---
interface KtlApiResponseData {
  message?: string;
  [key: string]: any;
}

export const sanitizeFilename = (name: string): string => {
  if (!name) return 'untitled';
  // 점(.) 허용
  let s = name
    .replace(/[^\w.\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\-]+/g, '_');

  // 중복 언더스코어/점 정리 + 앞/뒤 점 제거(숨김파일 방지)
  s = s
    .replace(/__+/g, '_')
    .replace(/\.{2,}/g, '.')  // ..... → .
    .replace(/^\.+/, '')      // 앞쪽 점 제거
    .replace(/\.+$/, '');     // 뒤쪽 점 제거

  return s || 'untitled';
};

export const getFileExtensionFromMime = (mimeType: string): string => {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image/jpeg') || t.includes('image/jpg')) return 'jpg';
  if (t.includes('image/png')) return 'png';
  if (t.includes('image/webp')) return 'webp';
  if (t.includes('image/gif')) return 'gif';
  return 'bin';
};

export const safeNameWithExt = (originalName: string, mimeType: string): string => {
  const dotIdx = originalName.lastIndexOf('.');
  const baseRaw = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const extRaw  = dotIdx > 0 ? originalName.slice(dotIdx + 1).toLowerCase() : '';

  const sanitizedBase = sanitizeFilename(baseRaw) || 'image';
  const known = new Set(['jpg','jpeg','png','webp','gif']);

  let ext = known.has(extRaw) ? (extRaw === 'jpeg' ? 'jpg' : extRaw) : getFileExtensionFromMime(mimeType);
  if (!ext || ext === 'bin') ext = 'jpg';

  return `${sanitizedBase}.${ext}`;
};

async function retryKtlApiCall<TResponseData>(
  fn: () => Promise<AxiosResponse<TResponseData>>,
  retries: number = 2,
  initialDelayMs: number = 2000,
  operationName: string = 'KTL API'
): Promise<AxiosResponse<TResponseData>> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const errorMessage = String(err.message || '').toLowerCase();
      const status = err.isAxiosError ? (err as AxiosError).response?.status : undefined;

      const isRetryable = errorMessage.includes('network error') || status === 503 || status === 504;

      if (attempt === retries) {
        console.error(`[ClaydoxAPI] ${operationName} call failed after ${attempt + 1} attempt(s). Final error:`, lastError.message || lastError);
        if (errorMessage.includes('network error')) {
          const enhancedError = new Error(
            `${operationName} 전송 실패 (네트워크 오류). 인터넷 연결을 확인하거나 잠시 후 다시 시도해 주세요. ` +
              `문제가 지속될 경우 KTL 서버 또는 프록시 서버의 문제일 수 있습니다. (원인: ${lastError.message})`
          );
          // @ts-ignore
          enhancedError.isNetworkError = true;
          throw enhancedError;
        }
      } else if (!isRetryable) {
        console.error(
          `[ClaydoxAPI] ${operationName} call failed with non-retryable error (attempt ${attempt + 1}). Error:`,
          lastError.message || lastError
        );
        break;
      }

      const waitTime = initialDelayMs * Math.pow(2, attempt);
      console.warn(
        `[ClaydoxAPI] ${operationName} call failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${waitTime}ms... Error:`,
        err.message || err
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}

// --- START: Page 1 (Photo Log / OCR Data) Functionality ---

export interface ClaydoxPayload {
  receiptNumber: string;
  siteLocation: string;
  siteNameOnly: string;
  item: string;
  inspectionStartDate?: string;
  inspectionEndDate?: string;
  ocrData: ExtractedEntry[];
  updateUser: string;
  uniqueIdentifiersForNaming?: string[];
  identifierSequence?: string;
  maxDecimalPlaces?: number;
  maxDecimalPlacesCl?: number;
  pageType?: 'PhotoLog' | 'FieldCount' | 'DrinkingWater';
}

const constructPhotoLogKtlJsonObject = (payload: ClaydoxPayload, selectedItem: string, actualKtlFileNames: string[]): any => {
  const labviewItemObject: { [key: string]: string } = {};

  const compositeFiles = actualKtlFileNames
    .filter(n => /_composite(_\d+)?\.(jpg|jpeg|png)$/i.test(n))
    .sort((a, b) => extractCompositeNo(a) - extractCompositeNo(b));
  const zipPhotoFileName = actualKtlFileNames.find((name) => /_Compression\.zip$/i.test(name) || name.toLowerCase().endsWith('.zip'));
  const dataTableFileName = actualKtlFileNames.find((name) => name.toLowerCase().includes('datatable') && name.toLowerCase().endsWith('.png'));

  const identifierRemapping: { [key: string]: string[] } = {
    Z1: ['Z1', 'Z3', 'Z5', 'Z7'], Z2: ['Z2', 'Z4', 'Z6'],
    S1: ['S1', 'S3', 'S5', 'S7'], S2: ['S2', 'S4', 'S6'],
    현장1: ['현장1', '현장2']
  };
  const identifierRemappingTP: { [key: string]: string[] } = {
    Z1P: ['Z1P', 'Z3P', 'Z5P', 'Z7P'], Z2P: ['Z2P', 'Z4P', 'Z6P'],
    S1P: ['S1P', 'S3P', 'S5P', 'S7P'], S2P: ['S2P', 'S4P', 'S6P'],
    현장1P: ['현장1P', '현장2P']
  };
  const identifierCounters: { [key: string]: number } = { Z1: 0, Z2: 0, S1: 0, S2: 0, 현장1: 0, Z1P: 0, Z2P: 0, S1P: 0, S2P: 0, 현장1P: 0 };

  const getNextKtlIdentifier = (baseIdentifier: string): string => {
    const remapping = baseIdentifier.endsWith('P') ? identifierRemappingTP : identifierRemapping;
    const mappingTable = remapping[baseIdentifier];
    if (mappingTable) {
        const count = identifierCounters[baseIdentifier] || 0;
        const newIdentifier = mappingTable[count] || baseIdentifier;
        identifierCounters[baseIdentifier] = count + 1;
        return newIdentifier;
    }
    return baseIdentifier;
  };

  payload.ocrData.forEach((entry) => {
    if (payload.pageType === 'DrinkingWater') {
      const dividerIdentifiers = ['Z 2시간 시작 - 종료', '드리프트 완료', '반복성 완료'];
      if (entry.identifier && dividerIdentifiers.includes(entry.identifier)) return;

      const parseAndAssign = (key: string, valueStr: string | undefined, suffix: 'C' | 'P' | '' = '') => {
        if (!valueStr || !valueStr.trim()) return;
        const valueToUse = valueStr.match(/-?\d+(\.\d+)?/)?.[0] || null;
        if (valueToUse !== null) {
            const finalKey = key === 'M' ? `M${suffix}` : `${key}${suffix}`;
            labviewItemObject[finalKey] = valueToUse;
        }
      };

      const parseAndAssignResponseTime = (valueStr: string | undefined, suffix: 'C' | 'P' | '' = '') => {
        if (!valueStr || !valueStr.trim()) return;
        try {
            const values = JSON.parse(valueStr);
            if (Array.isArray(values) && values.length >= 3) {
                const [seconds, minutes, length] = values.map(v => String(v || '').trim());
                if (seconds) labviewItemObject[`응답시간_초${suffix}`] = seconds;
                if (minutes) labviewItemObject[`응답시간_분${suffix}`] = minutes;
                if (length) labviewItemObject[`응답시간_길이${suffix}`] = length;
            }
        } catch (e) {
            console.warn('Failed to parse response time JSON string:', valueStr, e);
        }
      };

      if (entry.identifier) {
        if (entry.identifier === '응답') {
          parseAndAssignResponseTime(entry.value);
          if (payload.item === 'TU/CL') {
            parseAndAssignResponseTime(entry.valueTP, 'C');
          }
        } else {
          parseAndAssign(entry.identifier, entry.value);
          if (payload.item === 'TU/CL') {
              parseAndAssign(entry.identifier, entry.valueTP, 'C');
          } else if (payload.item === 'TN/TP') {
              parseAndAssign(entry.identifier, entry.valueTP, 'P');
          }
        }
      }
    } else if (payload.pageType === 'FieldCount') { // ✅ P3(현장 계수)만 제한
      if (entry.identifier
          && P3_TN_IDENTIFIERS.includes(entry.identifier)
          && typeof entry.value === 'string'
          && entry.value.trim()) {
        const valueToUse = entry.value.match(/-?\d+(\.\d+)?/)?.[0] || null;
        if (valueToUse !== null) {
          labviewItemObject[getNextKtlIdentifier(entry.identifier)] = valueToUse;
        }
      }
      if (payload.item === 'TN/TP'
          && entry.identifierTP
          && P3_TP_IDENTIFIERS.includes(entry.identifierTP)
          && typeof entry.valueTP === 'string'
          && entry.valueTP.trim()) {
        const valueTPToUse = entry.valueTP.match(/-?\d+(\.\d+)?/)?.[0] || null;
        if (valueTPToUse !== null) {
          labviewItemObject[getNextKtlIdentifier(entry.identifierTP)] = valueTPToUse;
        }
      }
    } else { // ✅ P2(수질 분석=PhotoLog) - 제한 없음
      if (entry.identifier && typeof entry.value === 'string' && entry.value.trim()) {
        const valueToUse = entry.value.match(/-?\d+(\.\d+)?/)?.[0] || null;
        if (valueToUse !== null) {
          labviewItemObject[getNextKtlIdentifier(entry.identifier)] = valueToUse;
        }
      }
      if (payload.item === 'TN/TP' && entry.identifierTP && typeof entry.valueTP === 'string' && entry.valueTP.trim()) {
        const valueTPToUse = entry.valueTP.match(/-?\d+(\.\d+)?/)?.[0] || null;
        if (valueTPToUse !== null) {
          labviewItemObject[getNextKtlIdentifier(entry.identifierTP)] = valueTPToUse;
        }
      }
    }
  });

  const order = DEFAULT_PHOTO_KEY_ORDER;
  compositeFiles.forEach((filename, idx) => {
    const keyBase = order[idx] ?? `PHOTO${idx + 1}`;
    labviewItemObject[`${keyBase}_사진`] = filename;
  });

  if (compositeFiles[0]) labviewItemObject['PHOTO_사진'] = compositeFiles[0];
  if (zipPhotoFileName) labviewItemObject['PHOTO_압축'] = zipPhotoFileName;
  if (dataTableFileName) labviewItemObject['PHOTO_데이터테이블'] = dataTableFileName;

  if (payload.identifierSequence) labviewItemObject['sequence_code'] = payload.identifierSequence;
  if (typeof payload.maxDecimalPlaces === 'number') labviewItemObject['소수점'] = String(payload.maxDecimalPlaces);
  if (typeof payload.maxDecimalPlacesCl === 'number') labviewItemObject['소수점C'] = String(payload.maxDecimalPlacesCl);
  if (payload.updateUser) labviewItemObject['시험자'] = payload.updateUser;
  if (payload.inspectionStartDate) {
    labviewItemObject['검사시작일'] = payload.inspectionStartDate;
  }
  if (payload.inspectionEndDate) {
    labviewItemObject['검사종료일'] = payload.inspectionEndDate;
  }
  
  if (payload.pageType === 'DrinkingWater') {
    if (payload.siteNameOnly) labviewItemObject['현장'] = payload.siteNameOnly;
  } else {
    if (payload.siteLocation) labviewItemObject['현장'] = payload.siteLocation;
  }


  let gubnPrefix = '수질';
  const drinkingWaterItems = ANALYSIS_ITEM_GROUPS.find((g) => g.label === '먹는물')?.items || [];
  if (payload.pageType === 'FieldCount') gubnPrefix = '현장계수';
  else if (payload.pageType === 'DrinkingWater' || drinkingWaterItems.includes(payload.item)) gubnPrefix = '먹는물';

  const labviewDescComment = `${gubnPrefix} (항목: ${payload.item}, 현장: ${payload.siteNameOnly})`;
  const dynamicLabviewGubn = `${gubnPrefix}_${payload.item.replace('/', '_')}`;

  return {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify({ comment: labviewDescComment }),
    LABVIEW_RECEIPTNO: payload.receiptNumber,
    UPDATE_USER: payload.updateUser,
    LABVIEW_ITEM: JSON.stringify(labviewItemObject)
  };
};

const KTL_KEY_ORDER = ['LABVIEW_GUBN', 'LABVIEW_DESC', 'LABVIEW_RECEIPTNO', 'UPDATE_USER', 'LABVIEW_ITEM'];

export const generateKtlJsonForPreview = (payload: ClaydoxPayload, selectedItem: string, actualKtlFileNames: string[]): string => {
  const ktlJsonObject = constructPhotoLogKtlJsonObject(payload, selectedItem, actualKtlFileNames);
  return JSON.stringify(ktlJsonObject, KTL_KEY_ORDER, 2);
};

export const sendToClaydoxApi = async (
  payload: ClaydoxPayload,
  filesToUploadWithOriginalNames: File[],
  selectedItem: string,
  actualKtlFileNamesOnServer: string[],
  p_key?: string
): Promise<{ message: string; data?: KtlApiResponseData }> => {
  const formData = new FormData();
  filesToUploadWithOriginalNames.forEach((file) => {
    formData.append('files', file, file.name);
  });

  // P2/P3/P4 라벨로 통일
  let pageIdentifier = 'P2 수질 분석';
  if (payload.pageType === 'FieldCount') {
    pageIdentifier = 'P3 현장 계수';
  } else if (payload.pageType === 'DrinkingWater') {
    pageIdentifier = 'P4 먹는물 분석';
  }

  const logIdentifier = `[ClaydoxAPI - ${pageIdentifier}]`;

  try {
    if (filesToUploadWithOriginalNames.length > 0) {
      console.log(`${logIdentifier} Uploading files:`, filesToUploadWithOriginalNames.map((f) => f.name));
      await retryKtlApiCall<KtlApiResponseData>(
        () =>
          axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: KTL_API_TIMEOUT
          }),
        2,
        2000,
        `${pageIdentifier} File Upload`
      );
      console.log(`${logIdentifier} Files uploaded successfully.`);
    }

    const ktlJsonObject = constructPhotoLogKtlJsonObject(payload, selectedItem, actualKtlFileNamesOnServer);
    console.log(`${logIdentifier} Sending JSON data to KTL:`, ktlJsonObject);

    const jsonResponse = await retryKtlApiCall<KtlApiResponseData>(
      () =>
        axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`, ktlJsonObject, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: KTL_API_TIMEOUT
        }),
      2,
      2000,
      `${pageIdentifier} JSON Data Send to /env`
    );
    console.log(`${logIdentifier} JSON sent successfully. Response:`, jsonResponse.data);

    if (supabase && p_key && payload.receiptNumber) {
        const { data, error: updateError } = await supabase
            .from('applications')
            .update({ [p_key]: true })
            .eq('receipt_no', payload.receiptNumber)
            .select();
        if (updateError) {
            console.warn(`[Supabase Check] Failed to update ${p_key} for ${payload.receiptNumber}:`, updateError.message);
        } else if (data && data.length > 0) {
            window.dispatchEvent(new CustomEvent('applicationsUpdated'));
        }
    }

    return { message: jsonResponse.data?.message || `데이터 및 파일 전송 완료 (${pageIdentifier})`, data: jsonResponse.data };
  } catch (error: any) {
    let errorMsg = `알 수 없는 오류 발생 (${pageIdentifier})`;
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data;
      console.error(`${logIdentifier} KTL API Error after retries:`, responseData || axiosError.message);

      if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof (responseData as any).message === 'string') {
        errorMsg = (responseData as any).message;
      } else if (typeof responseData === 'string') {
        if (responseData.trim().length > 0 && responseData.length < 500) {
          errorMsg = responseData.trim();
        } else {
          errorMsg = axiosError.message || `KTL API 응답 문자열 처리 오류 (${pageIdentifier})`;
        }
      } else if (axiosError.message) {
        errorMsg = axiosError.message;
      } else {
        errorMsg = `KTL API와 통신 중 알 수 없는 오류가 발생했습니다. (${pageIdentifier})`;
      }
    } else {
      // @ts-ignore
      errorMsg = error.isNetworkError ? error.message : error.message || `알 수 없는 비-Axios 오류 발생 (${pageIdentifier})`;
    }
    console.error(`${logIdentifier} Final error message to throw:`, errorMsg);
    throw new Error(errorMsg);
  }
};

// --- END: Page 1 (Photo Log / OCR Data) Functionality ---

// --- START: P1 (구조 확인) Functionality ---

interface StructuralCheckPayloadForKtl {
  receiptNumber: string;
  siteName: string;
  mainItemKey: MainStructuralItemKey;
  checklistData: Record<string, StructuralCheckSubItemData>;
  updateUser: string;
  photos?: ImageInfo[];
  photoFileNames: {};
  checklistImageFileName?: string;
  postInspectionDateValue?: string;
}

// 확장: ZIP에는 원본을 넣기 위해 base64Original/base64Stamped를 옵션으로 지원
export interface ClaydoxJobPhoto extends ImageInfo {
  uid: string;
  jobId: string;
  jobReceipt: string;
  jobItemKey: MainStructuralItemKey;
  jobItemName: string;
  /** 스탬프 없는 원본 (ZIP용). 없으면 base64를 사용 */
  base64Original?: string;
  /** 스탬프된 버전 (UI/미리보기용) */
  base64Stamped?: string;
}

const constructMergedLabviewItemForStructural = (
  jobsInGroup: StructuralCheckPayloadForKtl[],
  userNameGlobal: string,
  siteNameGlobal: string,
  gpsAddressGlobal: string,
  masterCompositeImageNameOnServer?: string,
  masterZipFileNameOnServer?: string
): any => {
  const mergedItems: any = {};

  if (userNameGlobal) mergedItems['시험자'] = userNameGlobal;
  if (siteNameGlobal) mergedItems['현장'] = siteNameGlobal;
  if (gpsAddressGlobal) mergedItems['주소'] = gpsAddressGlobal;

  jobsInGroup.forEach((payload) => {
    if (payload.postInspectionDateValue) {
      let periodValue = payload.postInspectionDateValue;
      let ktlPeriodValue = '';

      if (periodValue === '1년 후') {
        ktlPeriodValue = '1년후';
      } else if (periodValue === '2년 후') {
        ktlPeriodValue = '2년후';
      }

      if (ktlPeriodValue) {
        const periodKeySuffix = payload.mainItemKey === 'TP' ? 'P' : payload.mainItemKey === 'Cl' ? 'C' : '';
        const periodKey = `구조_사후검사일${periodKeySuffix}_주기`;
        mergedItems[periodKey] = ktlPeriodValue;
      }
    }

    if (payload.mainItemKey === 'TOC') {
      const emissionStandardData = payload.checklistData[EMISSION_STANDARD_ITEM_NAME];
      if (emissionStandardData && emissionStandardData.notes && emissionStandardData.notes.trim() !== '') {
        mergedItems['구조_배출기준_입력값'] = emissionStandardData.notes.trim();
      }
      const responseTimeData = payload.checklistData[RESPONSE_TIME_ITEM_NAME];
      if (responseTimeData && responseTimeData.notes && responseTimeData.notes.trim() !== '') {
        mergedItems['구조_응답시간_입력값'] = responseTimeData.notes.trim();
      }
    }

    Object.entries(payload.checklistData).forEach(([checklistItemName, data]) => {
      // Skip special TOC items as they are handled above or don't fit the standard pattern
      if (payload.mainItemKey === 'TOC' && (checklistItemName === EMISSION_STANDARD_ITEM_NAME || checklistItemName === RESPONSE_TIME_ITEM_NAME)) {
        return;
      }

      const sanitizedChecklistItemName = sanitizeFilename(checklistItemName).replace(/_/g, '');
      const itemSuffix = payload.mainItemKey === 'TP' ? 'P' : payload.mainItemKey === 'Cl' ? 'C' : '';
      
      const baseKeyForData = `구조_${sanitizedChecklistItemName}${itemSuffix}`;

      if (checklistItemName !== '기기번호 확인') {
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
      }

      if (checklistItemName === '측정범위확인') {
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

      if (checklistItemName === '정도검사 증명서' && data.notes) {
        try {
          const certDetails: CertificateDetails = JSON.parse(data.notes);
          let statusText = '';
          switch (certDetails.presence) {
            case 'present':
              statusText = '있음';
              break;
            case 'initial_new':
              statusText = '최초정도검사';
              break;
            case 'reissued_lost':
              statusText = '분실 후 재발행';
              break;
            default:
              statusText = certDetails.presence && certDetails.presence !== 'not_selected' ? String(certDetails.presence) : '선택 안됨';
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
      } else if (checklistItemName === '표시사항확인') {
        let successfullyParsedAndExpanded = false;
        if (data.notes && data.notes.trim().startsWith('{') && data.notes.trim().endsWith('}')) {
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
          } catch (parseError) {
            /* ignore */
          }
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

    let baseFileKey = '구조';
    if (payload.mainItemKey === 'TP') {
      baseFileKey = '구조P';
    } else if (payload.mainItemKey === 'Cl') {
      baseFileKey = '구조C';
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

  return mergedItems;
};

export const generateStructuralKtlJsonForPreview = (
  jobPayloadsForReceipt: StructuralCheckPayloadForKtl[],
  siteNameGlobal: string,
  userNameGlobal: string,
  gpsAddressGlobal: string,
  hypotheticalCompositeImageName?: string,
  hypotheticalMasterZipName?: string
): string => {
  if (!jobPayloadsForReceipt || jobPayloadsForReceipt.length === 0) {
    return '미리보기할 작업 데이터가 없습니다.';
  }
  const firstPayload = jobPayloadsForReceipt[0];

  const payloadsWithHypotheticalFileNames = jobPayloadsForReceipt.map((p) => {
    const receiptSanitized = sanitizeFilename(p.receiptNumber);
    let itemPartForFilename = '';
    if (p.mainItemKey === 'TN') {
      // 그대로 사용
    } else if (p.mainItemKey === 'TP') {
      itemPartForFilename = 'P';
    } else if (p.mainItemKey === 'Cl') {
      itemPartForFilename = 'C';
    } else {
      itemPartForFilename = sanitizeFilename(p.mainItemKey);
    }
    const finalChecklistImageName = `${receiptSanitized}${
      itemPartForFilename ? `_${itemPartForFilename}` : ''
    }_checklist.png`;

    return {
      ...p,
      photoFileNames: {},
      checklistImageFileName: finalChecklistImageName,
    };
  });

  const mergedLabviewItem = constructMergedLabviewItemForStructural(
    payloadsWithHypotheticalFileNames,
    userNameGlobal,
    siteNameGlobal,
    gpsAddressGlobal,
    hypotheticalCompositeImageName,
    hypotheticalMasterZipName
  );

  const mainItemNamesForDesc = Array.from(
    new Set(
      jobPayloadsForReceipt.map(
        (p) =>
          MAIN_STRUCTURAL_ITEMS.find((it) => it.key === p.mainItemKey)?.name ||
          p.mainItemKey
      )
    )
  );

  const labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(
    ', '
  )}, 현장: ${siteNameGlobal})`;
  const labviewDescObject = { comment: labviewDescComment };

  const uniqueMainItemKeys = Array.from(
    new Set(jobPayloadsForReceipt.map((job) => job.mainItemKey))
  ).sort();
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

export const generateCompositeImageNameForKtl = (receiptNumber: string): string => {
  const sanitizedReceipt = sanitizeFilename(receiptNumber);
  return `${sanitizedReceipt}_composite.png`;
};

export const generateZipFileNameForKtl = (receiptNumber: string): string => {
  const sanitizedReceipt = sanitizeFilename(receiptNumber);
  return `${sanitizedReceipt}_압축.zip`;
};

// ----- ZIP에 원본만 담기 위한 유틸: 사진에서 ZIP용 base64 선택 -----
function pickZipBase64(photo: ClaydoxJobPhoto): string {
  // 우선순위: base64Original > base64(기존) > base64Stamped
  // @ts-ignore - ImageInfo에 base64가 존재한다고 가정
  const fallback = (photo as any).base64 || photo.base64Stamped || '';
  return photo.base64Original || fallback;
}

export const sendSingleStructuralCheckToKtlApi = async (
  job: StructuralJob,
  checklistImage: ImageInfo,
  siteNameGlobal: string,
  userNameGlobal: string,
  gpsAddressGlobal: string,
  onProgress: (message: string) => void,
  p_key?: string
): Promise<{ success: boolean; message: string }> => {
  const filesToUpload: File[] = [];
  let compositeFileNameOnServer: string | undefined;
  let zipFileNameOnServer: string | undefined;

  // 1. Add checklist image (Do not compress this)
  onProgress('(1/4) [P1 구조 확인] 체크리스트 이미지 준비 중...');
  const checklistBlob = dataURLtoBlob(`data:${checklistImage.mimeType};base64,${checklistImage.base64}`);
  filesToUpload.push(new File([checklistBlob], checklistImage.file.name, { type: checklistImage.mimeType }));

  // 2. Process photos if they exist
  if (job.photos && job.photos.length > 0) {
    // 2a. Create composite image and compress it
    onProgress('(2/4) [P1 구조 확인] 참고사진 종합 이미지 생성 중...');
    try {
      const imageSourcesForComposite: CompositeImageInput[] = job.photos.map(p => ({
        base64: p.base64,
        mimeType: p.mimeType,
        comment: job.photoComments[p.uid],
      }));
      const itemSummaryForStamp = MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey;
      const stampDetailsComposite = { receiptNumber: job.receiptNumber, siteLocation: siteNameGlobal, item: itemSummaryForStamp };
      const compositeDataUrl = await generateCompositeImage(imageSourcesForComposite, stampDetailsComposite, 'image/png');
      const compressedCompositeUrl = await compressImage(compositeDataUrl.split(',')[1], 'image/png');
      compositeFileNameOnServer = generateCompositeImageNameForKtl(job.receiptNumber).replace(/\.png$/, '.jpg');
      filesToUpload.push(new File([dataURLtoBlob(compressedCompositeUrl)], compositeFileNameOnServer, { type: 'image/jpeg' }));
    } catch (e: any) {
      throw new Error(`참고사진 종합 이미지 생성 실패: ${e.message}`);
    }

    // 2b. Create ZIP file with compressed stamped images
    onProgress('(3/4) [P1 구조 확인] 참고사진 ZIP 파일 생성 중...');
    try {
      const zip = new JSZip();
      for (const photo of job.photos) {
        const stampedDataUrl = await generateStampedImage(photo.base64, photo.mimeType, job.receiptNumber, siteNameGlobal, '', MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey, job.photoComments[photo.uid]);
        const compressedUrl = await compressImage(stampedDataUrl.split(',')[1], 'image/png');
        const safeName = safeNameWithExt(photo.file.name, photo.mimeType);
        const jpegName = safeName.replace(/\.[^/.]+$/, "") + ".jpg";
        zip.file(jpegName, dataURLtoBlob(compressedUrl));
      }
      zipFileNameOnServer = generateZipFileNameForKtl(job.receiptNumber);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      filesToUpload.push(new File([zipBlob], zipFileNameOnServer, { type: 'application/zip' }));
    } catch (e: any) {
      throw new Error(`참고사진 ZIP 파일 생성 실패: ${e.message}`);
    }
  }

  // 3. Upload all files
  if (filesToUpload.length > 0) {
    onProgress('(4/4) [P1 구조 확인] KTL 서버로 파일 업로드 중...');
    const formData = new FormData();
    filesToUpload.forEach(file => formData.append('files', file, file.name));
    try {
      await retryKtlApiCall(
        () => axios.post(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, formData, { timeout: KTL_API_TIMEOUT }),
        2, 2000, 'P1 Single Upload'
      );
    } catch (e: any) {
      throw new Error(`파일 업로드 실패: ${e.message}`);
    }
  }

  // 4. Construct and send JSON
  onProgress('[P1 구조 확인] KTL 서버로 JSON 데이터 전송 중...');
  const payload: StructuralCheckPayloadForKtl = {
    receiptNumber: job.receiptNumber,
    siteName: siteNameGlobal,
    mainItemKey: job.mainItemKey,
    checklistData: job.checklistData,
    updateUser: userNameGlobal,
    photoFileNames: {},
    checklistImageFileName: checklistImage.file.name,
    postInspectionDateValue: job.postInspectionDate,
  };

  const mergedLabviewItem = constructMergedLabviewItemForStructural(
    [payload],
    userNameGlobal,
    siteNameGlobal,
    gpsAddressGlobal,
    compositeFileNameOnServer,
    zipFileNameOnServer
  );
  
  let inspectionDate = '';
  const rangeCheckData = job.checklistData["측정범위확인"];
  if (rangeCheckData?.confirmedAt) {
      inspectionDate = rangeCheckData.confirmedAt.split(' ')[0];
  } else {
      const today = new Date();
      inspectionDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }
  mergedLabviewItem['검사시작일'] = inspectionDate;
  
  const mainItemName = MAIN_STRUCTURAL_ITEMS.find(it => it.key === job.mainItemKey)?.name || job.mainItemKey;
  const labviewDescComment = `구조 (항목: ${mainItemName}, 현장: ${siteNameGlobal})`;
  const dynamicLabviewGubn = `구조_${job.mainItemKey}`;

  const finalKtlJsonObject = {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify({ comment: labviewDescComment }),
    LABVIEW_RECEIPTNO: job.receiptNumber,
    UPDATE_USER: userNameGlobal,
    LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
  };

  try {
    const jsonResponse = await retryKtlApiCall(
      () => axios.post(`${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`, finalKtlJsonObject, { timeout: KTL_API_TIMEOUT }),
      2, 2000, 'P1 Single JSON Send'
    );
     if (supabase && p_key && job.receiptNumber) {
        const { data, error: updateError } = await supabase
            .from('applications')
            .update({ [p_key]: true })
            .eq('receipt_no', job.receiptNumber)
            .select();
        if (updateError) {
            console.warn(`[Supabase Check] Failed to update ${p_key} for ${job.receiptNumber}:`, updateError.message);
        } else if (data && data.length > 0) {
            window.dispatchEvent(new CustomEvent('applicationsUpdated'));
        }
    }
    return { success: true, message: jsonResponse.data?.message || '데이터 전송 완료' };
  } catch (e: any) {
    throw new Error(`JSON 데이터 전송 실패: ${e.message}`);
  }
};

export const sendBatchStructuralChecksToKtlApi = async (
  jobs: StructuralJob[],
  generatedChecklistImages: ImageInfo[],
  siteNameGlobal: string,
  userNameGlobal: string,
  gpsAddressGlobal: string,
  p_key?: string
): Promise<{ receiptNo: string; mainItem: string; success: boolean; message: string }[]> => {
  const results: { receiptNo: string; mainItem: string; success: boolean; message: string }[] = [];
  const filesToUploadDirectly: File[] = [];
  const receiptToCompositeFileNameMap: Map<string, string> = new Map();
  const receiptToZipFileNameMap: Map<string, string> = new Map();

  // Reconstruct necessary data structures from jobs array
  const payloadsForKtlService: StructuralCheckPayloadForKtl[] = [];
  const allJobPhotosForService: ClaydoxJobPhoto[] = [];
  for (const job of jobs) {
    job.photos.forEach((photo) => {
      allJobPhotosForService.push({
        ...(photo as ClaydoxJobPhoto),
        jobId: job.id,
        jobReceipt: job.receiptNumber,
        jobItemKey: job.mainItemKey,
        jobItemName: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey
      });
    });
    payloadsForKtlService.push({
      receiptNumber: job.receiptNumber,
      siteName: siteNameGlobal,
      mainItemKey: job.mainItemKey,
      checklistData: job.checklistData,
      updateUser: userNameGlobal,
      photoFileNames: {},
      postInspectionDateValue: job.postInspectionDate
    });
  }

  const uniqueReceiptNumbersInBatch = Array.from(new Set(jobs.map((job) => job.receiptNumber)));

  for (const receiptNo of uniqueReceiptNumbersInBatch) {
    const photosForThisReceipt = allJobPhotosForService.filter((p) => p.jobReceipt === receiptNo);

    if (photosForThisReceipt.length > 0) {
      const imageSourcesForComposite: CompositeImageInput[] = photosForThisReceipt.map((p) => {
        const sourceJob = jobs.find((j) => j.id === p.jobId);
        const comment = sourceJob?.photoComments[p.uid];
        // @ts-ignore
        const stampedBase64 = p.base64Stamped || (p as any).base64;
        return {
          base64: stampedBase64,
          mimeType: p.mimeType,
          comment: comment
        };
      });
      const itemsForThisReceipt = jobs
        .filter((job) => job.receiptNumber === receiptNo)
        .map((job) => MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey);
      const itemSummaryForStamp = Array.from(new Set(itemsForThisReceipt)).join(', ');

      const stampDetailsComposite = {
        receiptNumber: receiptNo,
        siteLocation: siteNameGlobal,
        item: itemSummaryForStamp
      };

      try {
        const compositeDataUrl = await generateCompositeImage(imageSourcesForComposite, stampDetailsComposite, 'image/png');
        const compressedCompositeUrl = await compressImage(compositeDataUrl.split(',')[1], 'image/png');
        const compositeBlob = dataURLtoBlob(compressedCompositeUrl);
        const compositeFileNameOnServer = generateCompositeImageNameForKtl(receiptNo).replace(/\.png$/, '.jpg');
        const compositeFile = new File([compositeBlob], compositeFileNameOnServer, { type: 'image/jpeg' });
        filesToUploadDirectly.push(compositeFile);
        receiptToCompositeFileNameMap.set(receiptNo, compositeFileNameOnServer);
      } catch (compositeGenError: any) {
        console.error(`[ClaydoxAPI - P1] Error generating composite image for ${receiptNo}:`, compositeGenError);
        jobs
          .filter((j) => j.receiptNumber === receiptNo)
          .forEach((job) => {
            if (!results.find((r) => r.receiptNo === job.receiptNumber && r.mainItem === (MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey))) {
              results.push({
                receiptNo: job.receiptNumber,
                mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey,
                success: false,
                message: `참고사진 종합 이미지 생성 실패: ${compositeGenError.message || '알 수 없는 오류'}`
              });
            }
          });
        continue;
      }
    }

    if (photosForThisReceipt.length > 0) {
      const zip = new JSZip();
      for (const photo of photosForThisReceipt) {
        try {
          const sourceJob = jobs.find((j) => j.id === photo.jobId);
          const comment = sourceJob?.photoComments[photo.uid];
          const srcBase64 = (photo as any).base64Stamped || (photo as any).base64 || photo.base64Original || '';
          const stampedDataUrl = await generateStampedImage(
            srcBase64,
            photo.mimeType,
            photo.jobReceipt,
            siteNameGlobal,
            '',
            photo.jobItemName,
            comment
          );
          const compressedUrl = await compressImage(stampedDataUrl.split(',')[1], 'image/png');
          const safeName = safeNameWithExt(photo.file.name, photo.mimeType);
          const jpegName = safeName.replace(/\.[^/.]+$/, "") + ".jpg";
          const stampedBlob = dataURLtoBlob(compressedUrl);
          zip.file(jpegName, stampedBlob);
        } catch (zipError: any) {
          console.error(`[ClaydoxAPI - P1] Error adding stamped photo ${photo.file.name} to ZIP for ${receiptNo}:`, zipError);
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
          console.error(`[ClaydoxAPI - P1] Error generating ZIP file for ${receiptNo}:`, zipGenError);
          jobs
            .filter((j) => j.receiptNumber === receiptNo)
            .forEach((job) => {
              if (
                !results.find(
                  (r) =>
                    r.receiptNo === job.receiptNumber &&
                    r.mainItem === (MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey) &&
                    r.message.includes('ZIP 생성 실패')
                )
              ) {
                results.push({
                  receiptNo: job.receiptNumber,
                  mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey,
                  success: false,
                  message: `참고사진 ZIP 생성 실패: ${zipGenError.message || '알 수 없는 오류'}`
                });
              }
            });
        }
      }
    }
  }

  generatedChecklistImages.forEach((chkImgInfo) => {
    const blob = dataURLtoBlob(`data:${chkImgInfo.mimeType};base64,${chkImgInfo.base64}`);
    const file = new File([blob], chkImgInfo.file.name, { type: chkImgInfo.mimeType });
    filesToUploadDirectly.push(file);

    const relatedJobStrict = payloadsForKtlService.find((jp) => {
      const receiptSanitized = sanitizeFilename(jp.receiptNumber);
      let itemPartForFilename = '';
      if (jp.mainItemKey === 'TN') {
        // 그대로 사용
      } else if (jp.mainItemKey === 'TP') {
        itemPartForFilename = 'P';
      } else if (jp.mainItemKey === 'Cl') {
        itemPartForFilename = 'C';
      } else {
        itemPartForFilename = sanitizeFilename(jp.mainItemKey);
      }

      const expectedFilename = `${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`;
      return chkImgInfo.file.name === expectedFilename;
    });

    if (relatedJobStrict) {
      relatedJobStrict.checklistImageFileName = chkImgInfo.file.name;
    } else {
      console.warn(`[ClaydoxAPI - P1] Could not find related job for checklist image: ${chkImgInfo.file.name}`);
    }
  });

  if (filesToUploadDirectly.length > 0) {
    const formDataForAllUploads = new FormData();
    filesToUploadDirectly.forEach((file) => {
      formDataForAllUploads.append('files', file, file.name);
    });
    try {
      console.log('[ClaydoxAPI - P1] Uploading files directly to KTL /uploadfiles (batched):', filesToUploadDirectly.map((f) => f.name));
      const batchSize = 3;
      for (let i = 0; i < filesToUploadDirectly.length; i += batchSize) {
        const slice = filesToUploadDirectly.slice(i, i + batchSize);
        const fd = new FormData();
        slice.forEach((f) => fd.append('files', f, f.name));
        await retryKtlApiCall<KtlApiResponseData>(
          () =>
            axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, fd, {
              // 브라우저에서는 Content-Type을 명시하지 않으면 경계(boundary)가 자동 설정됩니다.
              timeout: Math.max(KTL_API_TIMEOUT, 120000),
              maxBodyLength: Infinity,
              maxContentLength: Infinity
            }),
          2,
          2000,
          `P1 Upload batch ${Math.floor(i / batchSize) + 1}`
        );
      }
      console.log('[ClaydoxAPI - P1] All file batches for P1 uploaded successfully to KTL /uploadfiles.');
    } catch (filesUploadError: any) {
      console.error('[ClaydoxAPI - P1] Files upload to KTL /uploadfiles failed:', filesUploadError);
      jobs.forEach((job) => {
        if (!results.find((r) => r.receiptNo === job.receiptNumber && (MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey) === r.mainItem)) {
          results.push({
            receiptNo: job.receiptNumber,
            mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey,
            success: false,
            message: `파일 업로드 실패 (KTL /uploadfiles): ${filesUploadError.message || '알 수 없는 파일 업로드 오류'}`
          });
        }
      });
      return results;
    }
  }

  const jobsByReceiptNumber: Record<string, StructuralCheckPayloadForKtl[]> = {};
  payloadsForKtlService.forEach((payload) => {
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
      siteNameGlobal,
      gpsAddressGlobal,
      compositeFileNameForThisReceipt, 
      zipFileNameForThisReceipt
    );

    let inspectionDate = '';
    const firstJobInGroup = currentGroupOfJobs[0];
    if (firstJobInGroup) {
        const rangeCheckData = firstJobInGroup.checklistData["측정범위확인"];
        if (rangeCheckData?.confirmedAt) {
            inspectionDate = rangeCheckData.confirmedAt.split(' ')[0];
        }
    }
    if (!inspectionDate) {
        const today = new Date();
        inspectionDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    mergedLabviewItem['검사시작일'] = inspectionDate;

    const mainItemNamesForDesc = Array.from(
      new Set(currentGroupOfJobs.map((p) => MAIN_STRUCTURAL_ITEMS.find((it) => it.key === p.mainItemKey)?.name || p.mainItemKey))
    );

    const labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(', ')}, 현장: ${siteNameGlobal})`;
    const labviewDescObject = { comment: labviewDescComment };

    const uniqueMainItemKeys = Array.from(new Set(currentGroupOfJobs.map((job) => job.mainItemKey))).sort();
    const dynamicLabviewGubn = `구조_${uniqueMainItemKeys.join(',')}`;

    const finalKtlJsonObject = {
      LABVIEW_GUBN: dynamicLabviewGubn,
      LABVIEW_DESC: JSON.stringify(labviewDescObject),
      LABVIEW_RECEIPTNO: receiptNo,
      UPDATE_USER: userNameGlobal,
      LABVIEW_ITEM: JSON.stringify(mergedLabviewItem),
    };

    try {
      console.log(`[ClaydoxAPI - P1] Sending final JSON for ${receiptNo} to KTL /env:`, finalKtlJsonObject);
      const jsonResponse = await retryKtlApiCall<KtlApiResponseData>(
        () =>
          axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`, finalKtlJsonObject, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            timeout: KTL_API_TIMEOUT
          }),
        2,
        2000,
        `P1 JSON Send for ${receiptNo}`
      );
      console.log(`[ClaydoxAPI - P1] JSON for ${receiptNo} sent successfully. Response:`, jsonResponse.data);

       if (supabase && p_key && receiptNo) {
            const { data, error: updateError } = await supabase
                .from('applications')
                .update({ [p_key]: true })
                .eq('receipt_no', receiptNo)
                .select();
            if (updateError) {
                console.warn(`[Supabase Check] Failed to update ${p_key} for ${receiptNo}:`, updateError.message);
            } else if (data && data.length > 0) {
                 window.dispatchEvent(new CustomEvent('applicationsUpdated'));
            }
        }

      currentGroupOfJobs.forEach((jobPayload) => {
        results.push({
          receiptNo: jobPayload.receiptNumber,
          mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === jobPayload.mainItemKey)?.name || jobPayload.mainItemKey,
          success: true,
          message: jsonResponse.data?.message || '데이터 전송 성공'
        });
      });
    } catch (jsonSendError: any) {
      console.error(`[ClaydoxAPI - P1] JSON send for ${receiptNo} failed:`, jsonSendError);
      currentGroupOfJobs.forEach((jobPayload) => {
        results.push({
          receiptNo: jobPayload.receiptNumber,
          mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === jobPayload.mainItemKey)?.name || jobPayload.mainItemKey,
          success: false,
          message: `JSON 데이터 전송 실패: ${jsonSendError.message || '알 수 없는 오류'}`
        });
      });
    }
  }

  return results;
};


// --- START: Page 5 (KakaoTalk) Functionality ---

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

  const payloadForJsonRequest = {
    LABVIEW_ITEM: labviewItemValue,
  };

  try {
    console.log('[KtlApiService] Sending KakaoTalk message with payload:', labviewItemValue);
    const response = await retryKtlApiCall<KtlApiResponseData>(
      () => axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_KAKAO_API_ENDPOINT}`, payloadForJsonRequest, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000, // Use a specific timeout for KakaoTalk
      }),
      2, 2000, "KakaoTalk Send"
    );
    console.log('[KtlApiService] KakaoTalk message sent. Response:', response.data);
    return { message: response.data?.message || '카카오톡 메시지 전송 요청 완료', data: response.data };

  } catch (error: any) {
    let errorMsg = '알 수 없는 오류 발생';
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const responseData = axiosError.response?.data;
         if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof (responseData as any).message === 'string') {
            errorMsg = (responseData as any).message;
        } else if (typeof responseData === 'string' && responseData.length < 500 && responseData.trim()) {
            errorMsg = responseData.trim();
        } else if (axiosError.message) {
            errorMsg = axiosError.message;
        }
    } else if (error.message) {
        errorMsg = error.message;
    }
    console.error('[KtlApiService] Final error message to throw:', errorMsg);
    throw new Error(errorMsg);
  }
};
