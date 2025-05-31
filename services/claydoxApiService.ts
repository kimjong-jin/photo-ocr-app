
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
const UPLOAD_FILES_ENDPOINT = '/uploadfiles';
const UPLOAD_JSON_ENDPOINT = '/env';
const DEFAULT_LABVIEW_GUBN = '수질';
const DEFAULT_LABVIEW_DESC_COMMENT = '수질';
const KTL_API_TIMEOUT = 30000; // 30 seconds

// Constants ALLOWED_PHOTO_LINK_UIDS_PRIMARY and ALLOWED_PHOTO_LINK_UIDS_TP are no longer directly used
// for deciding which identifiers get a "_사진" suffix in constructKtlApiPayloadObject,
// as the logic is now specifically for "M1_사진". They are kept for potential other uses or context.
const ALLOWED_PHOTO_LINK_UIDS_PRIMARY = new Set(TN_IDENTIFIERS);
const ALLOWED_PHOTO_LINK_UIDS_TP = new Set(TP_IDENTIFIERS);


const constructKtlApiPayloadObject = (
  payload: ClaydoxPayload,
  selectedItem: string,
  actualKtlFileNames: string[] // Expects an array with [compositeFilename, zipFilename]
) => {
  const labviewItems: { [key: string]: string } = {};
  
  const compositePhotoFileName = actualKtlFileNames.find(name => name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png'));
  const zipPhotoFileName = actualKtlFileNames.find(name => name.endsWith('.zip'));

  payload.ocrData.forEach(entry => {
    // Handle primary/TN value and its identifier
    if (entry.identifier && typeof entry.value === 'string') {
      const numericValueMatch = entry.value.match(/^-?\d+(\.\d+)?/);
      const valueToUse = numericValueMatch ? numericValueMatch[0] : null;

      if (valueToUse !== null) {
        labviewItems[entry.identifier] = valueToUse;
        // ONLY add _사진 if the identifier is "M1"
        if (compositePhotoFileName && entry.identifier === "M1") {
          labviewItems[`M1_사진`] = compositePhotoFileName;
        }
        // Add _압축 if the primary/TN identifier is "M1"
        if (zipPhotoFileName && entry.identifier === "M1") {
          labviewItems[`M1_압축`] = zipPhotoFileName;
        }
      }
    }

    // Handle TP value and its identifier (only in TN/TP mode)
    if (selectedItem === "TN/TP" && entry.identifierTP && typeof entry.valueTP === 'string') {
      const numericValueMatchTP = entry.valueTP.match(/^-?\d+(\.\d+)?/);
      const valueToUseTP = numericValueMatchTP ? numericValueMatchTP[0] : null;

      if (valueToUseTP !== null) {
        labviewItems[entry.identifierTP] = valueToUseTP;
        // No "_사진" suffix will be added for entry.identifierTP here,
        // because "M1" is not in TP_IDENTIFIERS, so entry.identifierTP === "M1" would be false.
        // This ensures only the primary "M1" identifier (from entry.identifier) gets "M1_사진".
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
    UPDATE_USER: payload.updateUser,
    LABVIEW_DESC: JSON.stringify(descObject),
  };
};


export const generateKtlJsonForPreview = (
  payload: ClaydoxPayload,
  selectedItem: string,
  actualKtlFileNames: string[] // Expects [compositeFilename, zipFilename] for preview
): string => {
  const ktlJsonObject = constructKtlApiPayloadObject(payload, selectedItem, actualKtlFileNames);
  return JSON.stringify(ktlJsonObject, null, 2);
};

export const sendToClaydoxApi = async (
  payload: ClaydoxPayload,
  files: File[], // Expects an array with [compositeFile, zipFile]
  selectedItem: string,
  actualKtlFileNames: string[] // Expects an array with [compositeFilename, zipFilename]
) => {
  console.log('[claydoxApiService] Step 1: Uploading files to /uploadfiles. Files count:', files.length);
  if (files.length === 0) {
    throw new Error("KTL 파일 업로드 오류: 전송할 파일이 없습니다.");
  }
  if (files.length > 0 && files.length < 2) {
      console.warn(`[claydoxApiService] Expected 2 files (composite and zip), but received ${files.length}. Proceeding with what was given.`);
  }


  const fileFormData = new FormData();
  files.forEach((file) => {
    fileFormData.append('files', file, file.name); 
    console.log(`[claydoxApiService] Appending file for /uploadfiles: ${file.name}, type: ${file.type}, size: ${file.size}`);
  });

  let fileUploadResponseData: any;
  try {
    console.log('[claydoxApiService] Attempting to POST files to KTL UPLOAD_FILES_ENDPOINT:', `${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`);
    const fileUploadResponse = await axios.post(`${KTL_API_BASE_URL}${UPLOAD_FILES_ENDPOINT}`, fileFormData, {
      timeout: KTL_API_TIMEOUT,
    });
    console.log('[claydoxApiService] KTL File Upload API (/uploadfiles) Response Status:', fileUploadResponse.status);
    console.log('[claydoxApiService] KTL File Upload API (/uploadfiles) Response Data:', fileUploadResponse.data);
    fileUploadResponseData = fileUploadResponse.data;

    let isFileUploadSuccess = fileUploadResponse.status === 200;
    if (fileUploadResponseData && typeof fileUploadResponseData.Success === 'string') {
        isFileUploadSuccess = isFileUploadSuccess && fileUploadResponseData.Success.toLowerCase() === 'true';
    } else if (fileUploadResponseData && typeof fileUploadResponseData.code !== 'undefined') {
        isFileUploadSuccess = isFileUploadSuccess && (String(fileUploadResponseData.code) === '0' || Number(fileUploadResponseData.code) === 0);
    }


    if (!isFileUploadSuccess) {
      const errorMessage = fileUploadResponseData.message || fileUploadResponseData.msg || 'KTL 파일 업로드 실패 (/uploadfiles)';
      console.error(`[claydoxApiService] KTL File Upload (/uploadfiles) indicated failure: ${errorMessage}`);
      throw new Error(`KTL 파일 업로드 실패: ${errorMessage}`);
    }
    console.log('[claydoxApiService] Step 1: File upload to /uploadfiles successful.');

  } catch (error: any) {
    console.error('[claydoxApiService] Error during KTL File Upload API (/uploadfiles) interaction:', error);
    let detailedErrorMessage = `KTL 파일 업로드 중 오류 (/uploadfiles): ${error.message || '알 수 없는 오류'}`;
    if (axios.isAxiosError(error)) {
        if (error.response) {
            detailedErrorMessage = `KTL 파일 업로드 API 오류 ${error.response.status} (/uploadfiles): ${JSON.stringify(error.response.data) || error.message}`;
        } else if (error.request) {
            detailedErrorMessage = 'KTL 파일 업로드 서버 응답 없음 (/uploadfiles). 네트워크 또는 서버 상태 확인.';
        }
    }
    throw new Error(detailedErrorMessage);
  }

  console.log('[claydoxApiService] Step 2: Sending JSON data to /env.');
  // actualKtlFileNames (composite and zip filenames) are passed here to be included in the JSON payload.
  const ktlApiJsonPayload = constructKtlApiPayloadObject(payload, selectedItem, actualKtlFileNames);
  console.log('[claydoxApiService] Constructed KTL API JSON for /env:', JSON.stringify(ktlApiJsonPayload, null, 2));

  try {
    console.log('[claydoxApiService] Attempting to POST JSON to KTL UPLOAD_JSON_ENDPOINT:', `${KTL_API_BASE_URL}${UPLOAD_JSON_ENDPOINT}`);
    const jsonUploadResponse = await axios.post(`${KTL_API_BASE_URL}${UPLOAD_JSON_ENDPOINT}`, ktlApiJsonPayload, {
      headers: {
        'Content-Type': 'application/json', 
      },
      timeout: KTL_API_TIMEOUT,
    });
    console.log('[claydoxApiService] KTL JSON Upload API (/env) Response Status:', jsonUploadResponse.status);
    console.log('[claydoxApiService] KTL JSON Upload API (/env) Response Data:', jsonUploadResponse.data);

    let isJsonUploadSuccess = jsonUploadResponse.status === 200;
     if (jsonUploadResponse.data && typeof jsonUploadResponse.data.Success === 'string') {
        isJsonUploadSuccess = isJsonUploadSuccess && jsonUploadResponse.data.Success.toLowerCase() === 'true';
    } else if (jsonUploadResponse.data && typeof jsonUploadResponse.data.code !== 'undefined') {
        isJsonUploadSuccess = isJsonUploadSuccess && (String(jsonUploadResponse.data.code) === '0' || Number(jsonUploadResponse.data.code) === 0);
    }

    if (!isJsonUploadSuccess) {
      const errorMessage = jsonUploadResponse.data.message || jsonUploadResponse.data.msg || 'KTL JSON 데이터 전송 실패 (/env)';
      console.error(`[claydoxApiService] KTL JSON Upload (/env) indicated failure: ${errorMessage}`);
      throw new Error(`KTL JSON 데이터 전송 실패: ${errorMessage}`);
    }

    console.log('[claydoxApiService] Step 2: JSON data upload to /env successful.');
    return {
        message: "파일 및 JSON 데이터가 KTL 서버로 성공적으로 전송되었습니다.",
        fileUploadResponse: fileUploadResponseData,
        jsonUploadResponse: jsonUploadResponse.data
    };

  } catch (error: any) {
    console.error('[claydoxApiService] Error during KTL JSON Upload API (/env) interaction:', error);
    let detailedErrorMessage = `KTL JSON 데이터 전송 중 오류 (/env): ${error.message || '알 수 없는 오류'}`;
     if (axios.isAxiosError(error)) {
        if (error.response) {
            detailedErrorMessage = `KTL JSON API 오류 ${error.response.status} (/env): ${JSON.stringify(error.response.data) || error.message}`;
        } else if (error.request) {
            detailedErrorMessage = 'KTL JSON 서버 응답 없음 (/env). 네트워크 또는 서버 상태 확인.';
        }
    }
    throw new Error(detailedErrorMessage);
  }
};
