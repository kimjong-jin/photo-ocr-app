import axios, { AxiosError, AxiosResponse } from 'axios';

// Global Constants & Helpers
const KTL_API_BASE_URL = 'https://mobile.ktl.re.kr/labview/api';
const KTL_KAKAO_API_ENDPOINT = '/kakaotalkmsg';
const KTL_API_TIMEOUT = 90000; // 90 seconds

// Interfaces
interface KtlApiResponseData {
  message?: string;
  status?: string; // Example of additional data that may be returned by the API
  [key: string]: any; 
}

// Retry Logic
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

      if (attempt === retries || !isRetryable) { 
        console.error(`[KtlApiService] ${operationName} call failed after ${attempt + 1} attempt(s). Final error:`, lastError.message || lastError);
        break;
      }

      const waitTime = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[KtlApiService] ${operationName} call failed (attempt ${attempt + 1}/${retries + 1}). Retrying in ${waitTime}ms... Error:`, err.message || err);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError; 
}

// 카카오톡 메시지 전송 (KakaoTalk Messaging)
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
        timeout: KTL_API_TIMEOUT,
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
         if (responseData && typeof responseData === 'object' && 'message' in responseData && typeof responseData.message === 'string') {
            errorMsg = responseData.message;
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