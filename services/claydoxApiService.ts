
import axios from 'axios';
import { ExtractedEntry } from '../App';
import { IDENTIFIER_OPTIONS, TN_IDENTIFIERS, TP_IDENTIFIERS } from '../shared/constants';

export interface ClaydoxPayload {
  receiptNumber: string;
  siteLocation: string;
  item: string; // This is the selectedItem from App.tsx
  inspectionStartDate?: string;
  ocrData: ExtractedEntry[];
  updateUser: string;
  uniqueIdentifiersForNaming?: string[];
}

const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const UPLOAD_ENDPOINT = '/uploadfiles';
const DEFAULT_LABVIEW_GUBN = '수질';
const DEFAULT_LABVIEW_DESC_COMMENT = '수질';
const KTL_API_TIMEOUT = 30000;

const ALLOWED_PHOTO_LINK_UIDS_PRIMARY = new Set(TN_IDENTIFIERS); // For primary (TN) identifiers
const ALLOWED_PHOTO_LINK_UIDS_TP = new Set(TP_IDENTIFIERS); // For TP identifiers


const sanitizeFilenameComponent = (component: string): string => {
  if (!component) return '';
  return component.replace(/[/\\[\]:*?"<>| ]/g, '_').replace(/__+/g, '_');
};

const constructKtlApiPayloadObject = (payload: ClaydoxPayload, selectedItem: string) => {
  const labviewItems: { [key: string]: string } = {};

  const sanitizedSiteLocation = sanitizeFilenameComponent(payload.siteLocation);
  // Use a generic "TN_TP" or the actual item for filenames if it's TN/TP
  const sanitizedItemForFilename = sanitizeFilenameComponent(selectedItem === "TN/TP" ? "TN_TP" : selectedItem);

  payload.ocrData.forEach(entry => {
    // Handle primary/TN value and identifier
    if (entry.identifier && typeof entry.value === 'string') {
      const numericValueMatch = entry.value.match(/^-?\d+(\.\d+)?/);
      const valueToUse = numericValueMatch ? numericValueMatch[0] : null; // Use null if no number

      if (valueToUse !== null) { // Only proceed if a numeric value was extracted
        labviewItems[entry.identifier] = valueToUse;

        const imageIndexForPrimaryIdentifier = payload.uniqueIdentifiersForNaming?.indexOf(entry.identifier);
        if (imageIndexForPrimaryIdentifier !== undefined && imageIndexForPrimaryIdentifier !== -1 && ALLOWED_PHOTO_LINK_UIDS_PRIMARY.has(entry.identifier)) {
          const photoKtlFileName = `${payload.receiptNumber}_${sanitizedSiteLocation}_${sanitizedItemForFilename}_${imageIndexForPrimaryIdentifier + 1}.png`;
          labviewItems[`${entry.identifier}_사진`] = photoKtlFileName;
        }
      }
    }

    // Handle TP value and identifier if in TN/TP mode
    if (selectedItem === "TN/TP" && entry.identifierTP && typeof entry.valueTP === 'string') {
      const numericValueMatchTP = entry.valueTP.match(/^-?\d+(\.\d+)?/);
      const valueToUseTP = numericValueMatchTP ? numericValueMatchTP[0] : null; // Use null if no number

      if (valueToUseTP !== null) { // Only proceed if a numeric value was extracted
        labviewItems[entry.identifierTP] = valueToUseTP;

        const imageIndexForTPIdentifier = payload.uniqueIdentifiersForNaming?.indexOf(entry.identifierTP);
        if (imageIndexForTPIdentifier !== undefined && imageIndexForTPIdentifier !== -1 && ALLOWED_PHOTO_LINK_UIDS_TP.has(entry.identifierTP)) {
          if (!labviewItems[`${entry.identifierTP}_사진`]) {
            const photoKtlFileName = `${payload.receiptNumber}_${sanitizedSiteLocation}_${sanitizedItemForFilename}_${imageIndexForTPIdentifier + 1}.png`;
            labviewItems[`${entry.identifierTP}_사진`] = photoKtlFileName;
          }
        }
      }
    }
  });

  const descObject: { comment: string; inspectionStartDate?: string } = {
    comment: `${DEFAULT_LABVIEW_DESC_COMMENT} (항목: ${payload.item}, 현장: ${payload.siteLocation})`
  };
  if (payload.inspectionStartDate) {
    descObject.inspectionStartDate = payload.inspectionStartDate;
  }

  return {
    LABVIEW_RECEIPTNO: payload.receiptNumber,
    LABVIEW_ITEM: JSON.stringify(labviewItems),
    LABVIEW_GUBN: DEFAULT_LABVIEW_GUBN,
    UPDATE_USER: payload.updateUser, // Corrected field name
    LABVIEW_DESC: JSON.stringify(descObject),
  };
};


export const generateKtlJsonForPreview = (payload: ClaydoxPayload, selectedItem: string): string => {
  const ktlJsonObject = constructKtlApiPayloadObject(payload, selectedItem);
  return JSON.stringify(ktlJsonObject, null, 2);
};

export const sendToClaydoxApi = async (payload: ClaydoxPayload, files: File[], selectedItem: string) => {
  console.log('[claydoxApiService] Sending to KTL. Payload:', payload, 'Files count:', files.length, 'SelectedItem:', selectedItem);
  const ktlApiPayload = constructKtlApiPayloadObject(payload, selectedItem);
  console.log('[claydoxApiService] Constructed KTL API JSON (before adding to FormData):', JSON.stringify(ktlApiPayload, null, 2));

  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file, file.name);
    console.log(`[claydoxApiService] Appending file to FormData: ${file.name}, type: ${file.type}, size: ${file.size}`);
  });

  formData.append('jsonData', JSON.stringify(ktlApiPayload));
  console.log('[claydoxApiService] Appended stringified ktlApiPayload as jsonData to FormData.');

  // @ts-ignore
  for (const pair of formData.entries()) {
    if (pair[1] instanceof File) {
      console.log(`[claydoxApiService] FormData entry: ${pair[0]} = File { name: ${(pair[1] as File).name}, size: ${(pair[1] as File).size}, type: ${(pair[1] as File).type} }`);
    } else {
      console.log(`[claydoxApiService] FormData entry: ${pair[0]} = ${pair[1]}`);
    }
  }

  try {
    console.log('[claydoxApiService] Attempting to POST to KTL UPLOAD_ENDPOINT:', `${KTL_API_BASE_URL}${UPLOAD_ENDPOINT}`);
    const uploadResponse = await axios.post(`${KTL_API_BASE_URL}${UPLOAD_ENDPOINT}`, formData, {
      headers: {
        // Content-Type is automatically set by Axios for FormData
      },
      timeout: KTL_API_TIMEOUT,
    });
    console.log('[claydoxApiService] KTL File Upload API Response Status:', uploadResponse.status);
    console.log('[claydoxApiService] KTL File Upload API Response Data:', uploadResponse.data);

    let isSuccess = uploadResponse.status === 200;
    if (uploadResponse.data && typeof uploadResponse.data.Success === 'string') {
        isSuccess = isSuccess && uploadResponse.data.Success.toLowerCase() === 'true';
    } else if (uploadResponse.data && typeof uploadResponse.data.code !== 'undefined') {
        isSuccess = isSuccess && String(uploadResponse.data.code) === '0';
    }


    if (!isSuccess) {
      const errorMessage = uploadResponse.data.message || uploadResponse.data.msg || 'KTL 파일 업로드 실패 (알 수 없는 응답 구조 또는 실패 코드)';
      console.error(`[claydoxApiService] KTL Upload indicated failure: ${errorMessage}`);
      throw new Error(`KTL 파일 업로드 실패: ${errorMessage}`);
    }

    return uploadResponse.data;

  } catch (error: any) {
    console.error('[claydoxApiService] Error during KTL API interaction:', error);
    if (axios.isAxiosError(error)) {
      console.error('[claydoxApiService] Axios error details:', {
        message: error.message,
        code: error.code,
        request_url: error.config?.url,
        request_method: error.config?.method,
        response_data: error.response?.data,
        response_status: error.response?.status,
      });
      if (error.response) {
        const apiErrorMessage = JSON.stringify(error.response.data) || error.message;
        throw new Error(`KTL API 오류 ${error.response.status}: ${apiErrorMessage}`);
      } else if (error.request) {
        throw new Error('KTL 서버에서 응답이 없습니다. 네트워크 연결 또는 서버 상태를 확인하세요. (요청은 전송되었으나 응답 없음)');
      } else {
        throw new Error(`KTL 요청 설정 중 오류 발생: ${error.message}`);
      }
    }
    throw new Error(`KTL API 통신 중 예기치 않은 시스템 오류: ${error.message || '알 수 없는 오류'}`);
  }
};
