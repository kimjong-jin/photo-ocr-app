import axios, { AxiosError, AxiosResponse } from 'axios';
import { KtlWaterAnalysisPayload } from '../types';

const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const KAKAO_API_ENDPOINT = '/kakaotalkmsg';
const UPLOAD_ENDPOINT = '/uploadfiles';
const ENV_ENDPOINT = '/env';
const KTL_API_TIMEOUT = 90000;
const KAKAO_API_KEY = '9f04ece57d9f1f613b8888dae1997c57d3f';

interface KtlApiResponseData {
  message?: string;
  status?: string;
  [key: string]: any;
}

const formatReservationTime = (isoString?: string): string | undefined => {
    if (!isoString) return undefined;
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return undefined;

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:00`;
    } catch {
        return undefined;
    }
};

const getErrorMessage = (error: any): string => {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof responseData.message === 'string') {
            return responseData.message;
        }
        if (typeof responseData === 'string' && responseData.length > 0 && responseData.length < 500) {
            return responseData.trim();
        }
        return error.message;
    }
    return String(error.message || '알 수 없는 오류가 발생했습니다.');
}

async function retryKtlApiCall<TResponseData>(
  fn: () => Promise<AxiosResponse<TResponseData>>, 
  retries: number = 2, 
  initialDelayMs: number = 1500,
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
      const isRetryable = errorMessage.includes("network error") || errorMessage.includes("timeout") || status === 503 || status === 504;

      if (attempt === retries || !isRetryable) { 
        console.error(`[KtlApiService] ${operationName} call failed after ${attempt + 1} attempt(s).`);
        break;
      }

      const waitTime = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[KtlApiService] ${operationName} call failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError; 
}


export const sendKakaoTalkMessage = async (
  message: string,
  phoneNumber: string,
  reservationTime?: string
): Promise<void> => {
  const formattedTime = formatReservationTime(reservationTime);
  
  const payload = {
    LABVIEW_ITEM: JSON.stringify({
      APIKEY: KAKAO_API_KEY,
      MSG: message,
      PHONE: phoneNumber,
      ...(formattedTime && { RESERVETIME: formattedTime }),
    }),
  };

  try {
    const response = await retryKtlApiCall<KtlApiResponseData>(
      () => axios.post<KtlApiResponseData>(
        `${KTL_API_BASE_URL}${KAKAO_API_ENDPOINT}`,
        payload,
        { headers: { 'Content-Type': 'application/json' }, timeout: KTL_API_TIMEOUT }
      ),
      2, 1500, "KakaoTalk Send"
    );

    if(response.data && response.data.status !== 'success' && response.data.message) {
        throw new Error(response.data.message);
    }
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
};

export const uploadZipFile = async (zipBlob: Blob, zipFileName: string): Promise<void> => {
    const formData = new FormData();
    formData.append("files", zipBlob, zipFileName);

    try {
        await retryKtlApiCall(
            () => axios.post(`${KTL_API_BASE_URL}${UPLOAD_ENDPOINT}`, formData, {
                headers: { "Content-Type": "multipart/form-data" },
                timeout: KTL_API_TIMEOUT,
            }),
            2, 2000, "Zip File Upload"
        );
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};

export const sendWaterAnalysisData = async (payload: KtlWaterAnalysisPayload): Promise<void> => {
    try {
        const response = await retryKtlApiCall(
            () => axios.post(`${KTL_API_BASE_URL}${ENV_ENDPOINT}`, payload, {
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                timeout: KTL_API_TIMEOUT,
            }),
            2, 1500, "Water Analysis Data Send"
        );

        if(response.data && response.data.status !== 'success' && response.data.message) {
            throw new Error(response.data.message);
        }
    } catch (error) {
        throw new Error(getErrorMessage(error));
    }
};