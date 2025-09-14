//claydoxApiService.ts
import axios, { AxiosError, AxiosResponse } from 'axios';
// FIX: The ExtractedEntry type should be imported from the shared types definition file.
import type { ExtractedEntry } from '../shared/types';
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS, ANALYSIS_ITEM_GROUPS } from '../shared/constants';
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
import { generateCompositeImage, dataURLtoBlob, generateStampedImage, CompositeImageInput } from './imageStampingService';
import JSZip from 'jszip';
import type { StructuralJob } from '../StructuralCheckPage';

// --- Global Constants & Helpers ---
const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const UPLOAD_FILES_ENDPOINT = '/uploadfiles';
const KTL_JSON_ENV_ENDPOINT = '/env';
const KTL_KAKAO_API_ENDPOINT = '/kakaotalkmsg';
const KTL_API_TIMEOUT = 90000; // 90 seconds

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
  item: string;
  inspectionStartDate?: string;
  ocrData: ExtractedEntry[];
  updateUser: string;
  uniqueIdentifiersForNaming?: string[];
  identifierSequence?: string;
  maxDecimalPlaces?: number;
  maxDecimalPlacesCl?: number;
  pageType?: 'PhotoLog' | 'FieldCount' | 'DrinkingWater';
  gpsAddress?: string;
}

const constructPhotoLogKtlJsonObject = (payload: ClaydoxPayload, selectedItem: string, actualKtlFileNames: string[]): any => {
  const labviewItemObject: { [key: string]: string } = {};

  // === (A) 파일 분류 ===
  const compositeFiles = actualKtlFileNames
    .filter(n => /_composite(_\d+)?\.(jpg|jpeg|png)$/i.test(n))
    .sort((a, b) => extractCompositeNo(a) - extractCompositeNo(b));

  const zipPhotoFileName = actualKtlFileNames.find((name) => /_Compression\.zip$/i.test(name) || name.toLowerCase().endsWith('.zip'));
  // PATCH: datatable 탐지 보강 (대소문자 무시, 'datatable' 포함 + .png)
  const dataTableFileName = actualKtlFileNames.find((name) => {
    const n = name.toLowerCase();
    return n.includes('datatable') && n.endsWith('.png');
  });

  // --- Start of new logic for identifier remapping ---
  const identifierRemapping: { [key: string]: string[] } = {
    Z1: ['Z1', 'Z3', 'Z5', 'Z7'],
    Z2: ['Z2', 'Z4', 'Z6'],
    S1: ['S1', 'S3', 'S5', 'S7'],
    S2: ['S2', 'S4', 'S6'],
    현장1: ['현장1', '현장2']
  };
  const identifierRemappingTP: { [key: string]: string[] } = {
    Z1P: ['Z1P', 'Z3P', 'Z5P', 'Z7P'],
    Z2P: ['Z2P', 'Z4P', 'Z6P'],
    S1P: ['S1P', 'S3P', 'S5P', 'S7P'],
    S2P: ['S2P', 'S4P', 'S6P'],
    현장1P: ['현장1P', '현장2P']
  };

  const identifierCounters: { [key: string]: number } = {
    Z1: 0, Z2: 0, S1: 0, S2: 0, 현장1: 0,
    Z1P: 0, Z2P: 0, S1P: 0, S2P: 0, 현장1P: 0
  };

  const getNextKtlIdentifier = (baseIdentifier: string): string => {
    const remapping = baseIdentifier.endsWith('P') ? identifierRemappingTP : identifierRemapping;
    if (remapping[baseIdentifier]) {
      const count = identifierCounters[baseIdentifier] || 0;
      const newIdentifier = remapping[baseIdentifier][count] || baseIdentifier; // fallback
      identifierCounters[baseIdentifier] = count + 1;
      return newIdentifier;
    }
    return baseIdentifier;
  };
  // --- End of new logic ---

  // === (B) 값 매핑(DrinkingWater 보강) ===
  payload.ocrData.forEach((entry) => {
    if (payload.pageType === 'DrinkingWater') {
      const dividerIdentifiers = ['Z 2시간 시작 - 종료', '드리프트 완료', '반복성 완료'];
      if (entry.identifier && dividerIdentifiers.includes(entry.identifier)) return;

      // 응답시간 특수 처리
      if (entry.identifier === '응답') {
        if (entry.value && entry.value.trim().startsWith('[')) {
          try {
            const responseTimeArray = JSON.parse(entry.value);
            if (Array.isArray(responseTimeArray)) {
              const [seconds, minutes, length] = responseTimeArray.map((v) => String(v || '').trim());
              if (seconds) labviewItemObject['응답시간_초'] = seconds;
              if (minutes) labviewItemObject['응답시간_분'] = minutes;
              if (length) labviewItemObject['응답시간_길이'] = length;
            }
          } catch {}
        }
        // TU/CL의 Cl측정치(C 접미사)
        if (payload.item === 'TU/CL' && entry.valueTP && entry.valueTP.trim().startsWith('[')) {
          try {
            const responseTimeArray = JSON.parse(entry.valueTP);
            if (Array.isArray(responseTimeArray)) {
              const [seconds, minutes, length] = responseTimeArray.map((v) => String(v || '').trim());
              if (seconds) labviewItemObject['응답시간_초C'] = seconds;
              if (minutes) labviewItemObject['응답시간_분C'] = minutes;
              if (length) labviewItemObject['응답시간_길이C'] = length;
            }
          } catch {}
        }
        // TN/TP의 TP측정치(P 접미사)
        if (payload.item === 'TN/TP' && entry.valueTP && entry.valueTP.trim().startsWith('[')) {
          try {
            const responseTimeArray = JSON.parse(entry.valueTP);
            if (Array.isArray(responseTimeArray)) {
              const [seconds, minutes, length] = responseTimeArray.map((v) => String(v || '').trim());
              if (seconds) labviewItemObject['응답시간_초P'] = seconds;
              if (minutes) labviewItemObject['응답시간_분P'] = minutes;
              if (length) labviewItemObject['응답시간_길이P'] = length;
            }
          } catch {}
        }
        return;
      }

      // 일반 값 파싱 (PATCH: 문자열 중간 숫자도 허용)
      if (entry.identifier) {
        if (typeof entry.value === 'string' && entry.value.trim()) {
          const valueToUse = entry.value.match(/-?\d+(\.\d+)?/)?.[0] || null;
          if (valueToUse !== null) labviewItemObject[entry.identifier] = valueToUse;
        }

        // TU/CL의 두 번째 값은 C 접미사(예: MC, Z1C)
        if (payload.item === 'TU/CL' && typeof entry.valueTP === 'string' && entry.valueTP.trim()) {
          const valueTPToUse = entry.valueTP.match(/-?\d+(\.\d+)?/)?.[0] || null;
          if (valueTPToUse !== null) {
            const key = entry.identifier === 'M' ? 'MC' : `${entry.identifier}C`;
            labviewItemObject[key] = valueTPToUse;
          }
        }

        // PATCH: TN/TP도 P 접미사(예: MP, Z1P)로 저장
        if (payload.item === 'TN/TP' && typeof entry.valueTP === 'string' && entry.valueTP.trim()) {
          const valueTPToUse = entry.valueTP.match(/-?\d+(\.\d+)?/)?.[0] || null;
          if (valueTPToUse !== null) {
            const key = entry.identifier === 'M' ? 'MP' : `${entry.identifier}P`;
            labviewItemObject[key] = valueTPToUse;
          }
        }
      }
    } else if (payload.item === 'TN/TP') {
      // (기존) TN/TP 분기 - P 접미사 리매핑 사용
      if (entry.identifier && typeof entry.value === 'string' && entry.value.trim()) {
        const valueToUse = entry.value.match(/-?\d+(\.\d+)?/)?.[0] || null; // PATCH: 고정
        if (valueToUse !== null) {
          const ktlIdentifier = getNextKtlIdentifier(entry.identifier);
          labviewItemObject[ktlIdentifier] = valueToUse;
        }
      }
      if (entry.identifierTP && typeof entry.valueTP === 'string' && entry.valueTP.trim()) {
        const valueTPToUse = entry.valueTP.match(/-?\d+(\.\d+)?/)?.[0] || null; // PATCH: 고정
        if (valueTPToUse !== null) {
          const ktlIdentifierTP = getNextKtlIdentifier(entry.identifierTP);
          labviewItemObject[ktlIdentifierTP] = valueTPToUse;
        }
      }
    } else {
      if (entry.identifier && typeof entry.value === 'string' && entry.value.trim()) {
        const valueToUse = entry.value.match(/-?\d+(\.\d+)?/)?.[0] || null; // 기존 로직 대비 개선(앵커 제거)
        if (valueToUse !== null) {
          const ktlIdentifier = getNextKtlIdentifier(entry.identifier);
          labviewItemObject[ktlIdentifier] = valueToUse;
        }
      }
    }
  });

  // === (C) 사진 매핑 ===
  // 1) 합성 JPG 여러 장 → M1_사진, M2_사진, ...
  const order = DEFAULT_PHOTO_KEY_ORDER;
  compositeFiles.forEach((filename, idx) => {
    const keyBase = order[idx] ?? `PHOTO${idx + 1}`;
    labviewItemObject[`${keyBase}_사진`] = filename;
  });

  // 2) 레거시/호환 키도 유지 (첫 장, ZIP, 데이터테이블)
  if (compositeFiles[0]) {
    labviewItemObject['PHOTO_사진'] = compositeFiles[0];
  }
  if (zipPhotoFileName) {
    labviewItemObject['PHOTO_압축'] = zipPhotoFileName;
  }
  if (dataTableFileName) {
    labviewItemObject['PHOTO_데이터테이블'] = dataTableFileName;
  }

  // OCR이 아예 없고 사진만 있는 경우의 방어
  if (payload.ocrData.length === 0) {
    if (compositeFiles[0] && !labviewItemObject['PHOTO_사진']) {
      labviewItemObject['PHOTO_사진'] = compositeFiles[0];
    }
    if (zipPhotoFileName && !labviewItemObject['PHOTO_압축']) {
      labviewItemObject['PHOTO_압축'] = zipPhotoFileName;
    }
  }

  // === (D) 공통 필드 ===
  if (payload.identifierSequence && payload.identifierSequence.length > 0) {
    labviewItemObject['sequence_code'] = payload.identifierSequence;
  }
  if (typeof payload.maxDecimalPlaces === 'number' && payload.maxDecimalPlaces >= 0) {
    labviewItemObject['소수점'] = String(payload.maxDecimalPlaces);
  }
  if (typeof payload.maxDecimalPlacesCl === 'number' && payload.maxDecimalPlacesCl >= 0) {
    labviewItemObject['소수점C'] = String(payload.maxDecimalPlacesCl);
  }
  if (payload.updateUser)   labviewItemObject['시험자'] = payload.updateUser;
  if (payload.siteLocation) labviewItemObject['현장']   = payload.siteLocation;

  if (payload.gpsAddress)   labviewItemObject['주소']   = payload.gpsAddress;

  // === (E) GUBN/ DESC 구성 — FIX(P3): 항목 포함 형식으로 복구 ===
  let gubnPrefix = '수질';
  const drinkingWaterItems = ANALYSIS_ITEM_GROUPS.find((g) => g.label === '먹는물')?.items || [];
  if (payload.pageType === 'FieldCount') gubnPrefix = '현장계수';
  else if (payload.pageType === 'DrinkingWater' || drinkingWaterItems.includes(payload.item)) gubnPrefix = '먹는물';

  let siteLocationForDesc = payload.siteLocation;
  if (gubnPrefix === '먹는물' && payload.siteLocation.includes(' / ')) {
    const parts = payload.siteLocation.split(' / ').map((p) => p.trim()).filter(Boolean);
    const mainSite = parts[0]; const details = parts.slice(1).join(' / ');
    if (mainSite && details) siteLocationForDesc = `${mainSite}_(${details})`;
  }

  const labviewDescComment = `${gubnPrefix} (항목: ${payload.item}, 현장: ${siteLocationForDesc})`;
  const labviewDescObject = { comment: labviewDescComment };

  // ✅ 최종: '먹는물' 고정 제거, 항목 포함하여 전송
  const dynamicLabviewGubn = `${gubnPrefix}_${payload.item.replace('/', '_')}`;

  return {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify(labviewDescObject),
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
  actualKtlFileNamesOnServer: string[]
): Promise<{ message: string; data?: KtlApiResponseData }> => {
  const formData = new FormData();
  filesToUploadWithOriginalNames.forEach((file) => {
    formData.append('files', file, file.name);
  });

  let pageIdentifier = 'Page 1';
  if (payload.pageType === 'FieldCount') {
    pageIdentifier = 'Page 2';
  } else if (payload.pageType === 'DrinkingWater') {
    pageIdentifier = 'Page 3';
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

// --- START: Page 4 (Structural Check) Functionality ---

interface StructuralCheckPayloadForKtl {
  receiptNumber: string;
  siteLocation: string;
  mainItemKey: MainStructuralItemKey;
  inspectionStartDate?: string;
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
  masterCompositeImageNameOnServer?: string,
  masterZipFileNameOnServer?: string
): any => {
  const mergedItems: any = {};
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

      // Default logic for all items
      let baseKeyForData = `구조_${sanitizedChecklistItemName}`;
      if (payload.mainItemKey === 'TP') {
        baseKeyForData = `구조_${sanitizedChecklistItemName}P`;
      } else if (payload.mainItemKey === 'Cl') {
        baseKeyForData = `구조_${sanitizedChecklistItemName}C`;
      }

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

  if (userNameGlobal) {
    mergedItems['시험자'] = userNameGlobal;
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
    return '미리보기할 작업 데이터가 없습니다.';
  }
  const firstPayload = jobPayloadsForReceipt[0];

  const payloadsWithHypotheticalFileNames = jobPayloadsForReceipt.map((p) => {
    const receiptSanitized = sanitizeFilename(p.receiptNumber);
    let itemPartForFilename = '';
    if (p.mainItemKey === 'TN') {
    } else if (p.mainItemKey === 'TP') {
      itemPartForFilename = 'P';
    } else if (p.mainItemKey === 'Cl') {
      itemPartForFilename = 'C';
    } else {
      itemPartForFilename = sanitizeFilename(p.mainItemKey);
    }
    const finalChecklistImageName = `${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`;

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

  const mainItemNamesForDesc = Array.from(
    new Set(jobPayloadsForReceipt.map((p) => MAIN_STRUCTURAL_ITEMS.find((it) => it.key === p.mainItemKey)?.name || p.mainItemKey))
  );

  let labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(', ')}, 현장: ${siteLocationGlobal}`;
  if (inspectionStartDateFromUi) {
    labviewDescComment += `, 검사시작일: ${inspectionStartDateFromUi}`;
  }
  const labviewDescObject = { comment: labviewDescComment };

  const uniqueMainItemKeys = Array.from(new Set(jobPayloadsForReceipt.map((job) => job.mainItemKey))).sort();
  const dynamicLabviewGubn = `구조_${uniqueMainItemKeys.join(',')}`;

  const objectToFormat = {
    LABVIEW_GUBN: dynamicLabviewGubn,
    LABVIEW_DESC: JSON.stringify(labviewDescObject),
    LABVIEW_RECEIPTNO: firstPayload.receiptNumber,
    UPDATE_USER: userNameGlobal,
    LABVIEW_ITEM: JSON.stringify(mergedLabviewItem)
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

// --- ZIP에 원본만 담기 위한 유틸: 사진에서 ZIP용 base64 선택 ---
function pickZipBase64(photo: ClaydoxJobPhoto): string {
  // 우선순위: base64Original > base64(기존) > base64Stamped
  // @ts-ignore - ImageInfo에 base64가 존재한다고 가정
  const fallback = (photo as any).base64 || photo.base64Stamped || '';
  return photo.base64Original || fallback;
}

export const sendBatchStructuralChecksToKtlApi = async (
  jobs: StructuralJob[],
  generatedChecklistImages: ImageInfo[],
  siteLocationGlobal: string,
  inspectionStartDateFromUi: string | undefined,
  userNameGlobal: string
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
      siteLocation: siteLocationGlobal,
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
        siteLocation: siteLocationGlobal,
        item: itemSummaryForStamp,
        inspectionStartDate: inspectionStartDateFromUi
      };

      try {
        const compositeDataUrl = await generateCompositeImage(imageSourcesForComposite, stampDetailsComposite, 'image/png');
        const compositeBlob = dataURLtoBlob(compositeDataUrl);
        const compositeFileNameOnServer = generateCompositeImageNameForKtl(receiptNo);
        const compositeFile = new File([compositeBlob], compositeFileNameOnServer, { type: 'image/png' });
        filesToUploadDirectly.push(compositeFile);
        receiptToCompositeFileNameMap.set(receiptNo, compositeFileNameOnServer);
      } catch (compositeGenError: any) {
        console.error(`[ClaydoxAPI - Page 4] Error generating composite image for ${receiptNo}:`, compositeGenError);
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
          // *** ZIP에는 원본(base64Original)만 사용 ***
          const base64ForZip = pickZipBase64(photo);
          const rawDataUrl = `data:${photo.mimeType};base64,${base64ForZip}`;
          const rawBlob = dataURLtoBlob(rawDataUrl);
          const fileNameInZip = safeNameWithExt(photo.file.name, photo.mimeType);
          zip.file(fileNameInZip, rawBlob);
        } catch (zipError: any) {
          console.error(`[ClaydoxAPI - Page 4] Error adding raw photo ${photo.file.name} to ZIP for ${receiptNo}:`, zipError);
        }
      }
      if (Object.keys(zip.files).length > 0) {
        try {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const zipFileNameOnServer = generateZipFileNameForKtl(receiptNo);
          // NOTE: 브라우저 환경 기준. Node 환경이면 File 대신 Blob 사용 필요.
          const zipFile = new File([zipBlob], zipFileNameOnServer, { type: 'application/zip' });
          filesToUploadDirectly.push(zipFile);
          receiptToZipFileNameMap.set(receiptNo, zipFileNameOnServer);
        } catch (zipGenError: any) {
          console.error(`[ClaydoxAPI - Page 4] Error generating ZIP file for ${receiptNo}:`, zipGenError);
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
    // NOTE: 브라우저 환경 기준. Node 환경이면 File 대신 Blob 사용 필요.
    const file = new File([blob], chkImgInfo.file.name, { type: chkImgInfo.mimeType });
    filesToUploadDirectly.push(file);

    const relatedJobStrict = payloadsForKtlService.find((jp) => {
      const receiptSanitized = sanitizeFilename(jp.receiptNumber);
      let itemPartForFilename = '';
      if (jp.mainItemKey === 'TN') itemPartForFilename = '';
      else if (jp.mainItemKey === 'TP') itemPartForFilename = 'P';
      else if (jp.mainItemKey === 'Cl') itemPartForFilename = 'C';
      else itemPartForFilename = sanitizeFilename(jp.mainItemKey);

      const expectedFilename = `${receiptSanitized}${itemPartForFilename ? `_${itemPartForFilename}` : ''}_checklist.png`;
      return chkImgInfo.file.name === expectedFilename;
    });

    if (relatedJobStrict) {
      relatedJobStrict.checklistImageFileName = chkImgInfo.file.name;
    } else {
      console.warn(`[ClaydoxAPI - Page 4] Could not find related job for checklist image: ${chkImgInfo.file.name}`);
    }
  });

  if (filesToUploadDirectly.length > 0) {
    const formDataForAllUploads = new FormData();
    filesToUploadDirectly.forEach((file) => {
      formDataForAllUploads.append('files', file, file.name);
    });
    try {
      console.log('[ClaydoxAPI - Page 4] Uploading all files directly to KTL /uploadfiles:', filesToUploadDirectly.map((f) => f.name));
      await retryKtlApiCall<KtlApiResponseData>(
        () =>
          axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, formDataForAllUploads, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: KTL_API_TIMEOUT
          }),
        2,
        2000,
        'Page 4 All Files Upload (Direct to KTL /uploadfiles)'
      );
      console.log('[ClaydoxAPI - Page 4] All files for Page 4 uploaded successfully to KTL /uploadfiles.');
    } catch (filesUploadError: any) {
      console.error('[ClaydoxAPI - Page 4] Files upload to KTL /uploadfiles failed:', filesUploadError);
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

    const mergedLabviewItem = constructMergedLabviewItemForStructural(currentGroupOfJobs, userNameGlobal, compositeFileNameForThisReceipt, zipFileNameForThisReceipt);

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    mergedLabviewItem['검사시작일'] = `${year}-${month}-${day}`;

    const mainItemNamesForDesc = Array.from(
      new Set(currentGroupOfJobs.map((p) => MAIN_STRUCTURAL_ITEMS.find((it) => it.key === p.mainItemKey)?.name || p.mainItemKey))
    );

    let labviewDescComment = `구조 (항목: ${mainItemNamesForDesc.join(', ')}, 현장: ${siteLocationGlobal}`;
    if (inspectionStartDateFromUi) {
      labviewDescComment += `, 검사시작일: ${inspectionStartDateFromUi}`;
    }
    const labviewDescObject = { comment: labviewDescComment };

    const uniqueMainItemKeys = Array.from(new Set(currentGroupOfJobs.map((job) => job.mainItemKey))).sort();
    const dynamicLabviewGubn = `구조_${uniqueMainItemKeys.join(',')}`;

    const finalKtlJsonObject = {
      LABVIEW_GUBN: dynamicLabviewGubn,
      LABVIEW_DESC: JSON.stringify(labviewDescObject),
      LABVIEW_RECEIPTNO: receiptNo,
      UPDATE_USER: userNameGlobal,
      LABVIEW_ITEM: JSON.stringify(mergedLabviewItem)
    };

    const jsonTargetUrl = `${KTL_API_BASE_URL}${KTL_JSON_ENV_ENDPOINT}`;
    const operationLogName = `Page 4 JSON Send for ${receiptNo} directly to /env`;

    console.log(
      `[ClaydoxAPI - Page 4] Sending MERGED JSON for ${receiptNo} (Items: ${mainItemNamesForDesc.join(', ')}) directly to URL: ${jsonTargetUrl}`
    );
    console.log(`[ClaydoxAPI - Page 4] Stringified JSON length for ${receiptNo}: ${JSON.stringify(finalKtlJsonObject).length}`);

    try {
      const jsonResponse = await retryKtlApiCall<KtlApiResponseData>(
        () =>
          axios.post<KtlApiResponseData>(jsonTargetUrl, finalKtlJsonObject, {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            timeout: KTL_API_TIMEOUT
          }),
        2,
        2000,
        operationLogName
      );

      console.log(`[ClaydoxAPI - Page 4] MERGED JSON for ${receiptNo} sent. Response:`, jsonResponse.data);
      currentGroupOfJobs.forEach((job) => {
        results.push({
          receiptNo: job.receiptNumber,
          mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey,
          success: true,
          message: jsonResponse.data?.message || `성공`
        });
      });
    } catch (error: any) {
      let errorMsg = `알 수 없는 오류 (직접 전송)`;
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const responseData = axiosError.response?.data;
        console.error(
          `[ClaydoxAPI - Page 4] Axios MERGED JSON send for ${receiptNo} directly to /env failed. TargetURL: ${jsonTargetUrl}. Error:`,
          responseData || axiosError.message
        );

        if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof (responseData as any).message === 'string') {
          errorMsg = (responseData as any).message;
        } else if (typeof responseData === 'string') {
          if (responseData.trim().length > 0 && responseData.length < 500) {
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
        errorMsg = error.isNetworkError ? error.message : error.message || `알 수 없는 비-Axios 오류 (${receiptNo}, 직접 전송)`;
      }
      console.error(`[ClaydoxAPI - Page 4] Final error message for ${receiptNo} (direct to /env):`, errorMsg);
      currentGroupOfJobs.forEach((job) => {
        results.push({
          receiptNo: job.receiptNumber,
          mainItem: MAIN_STRUCTURAL_ITEMS.find((it) => it.key === job.mainItemKey)?.name || job.mainItemKey,
          success: false,
          message: `JSON 전송 실패 (직접 전송): ${errorMsg}`
        });
      });
    }
  }
  return results;
};

// --- END: Page 4 (Structural Check) Functionality ---

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
    PHONE: phoneNumbers
  };

  if (reservationTime) {
    innerPayload.RESERVETIME = reservationTime;
  }

  const labviewItemValue = JSON.stringify(innerPayload);

  // The KTL Kakao API expects a JSON payload with a single key, "LABVIEW_ITEM",
  // whose value is a stringified JSON object containing the actual parameters.
  const payloadForJsonRequest = {
    LABVIEW_ITEM: labviewItemValue
  };

  try {
    console.log('[ClaydoxAPI - Page 5] Sending KakaoTalk message with payload:', labviewItemValue);
    const response = await retryKtlApiCall<KtlApiResponseData>(
      () =>
        axios.post<KtlApiResponseData>(`${KTL_API_BASE_URL}${KTL_KAKAO_API_ENDPOINT}`, payloadForJsonRequest, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: KTL_API_TIMEOUT
        }),
      2,
      2000,
      'Page 5 KakaoTalk Send'
    );
    console.log('[ClaydoxAPI - Page 5] KakaoTalk message sent. Response:', response.data);
    return { message: response.data?.message || '카카오톡 메시지 전송 요청 완료', data: response.data };
  } catch (error: any) {
    let errorMsg = '알 수 없는 오류 발생 (카카오톡)';
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const responseData = axiosError.response?.data;
        if (responseData && typeof responseData === 'object' && 'message' in responseData) {
            errorMsg = (responseData as any).message;
        } else if (axiosError.message) {
            errorMsg = axiosError.message;
        }
    } else {
        errorMsg = error.message || '알 수 없는 비-Axios 오류 발생 (카카오톡)';
    }
    throw new Error(errorMsg);
  }
};
