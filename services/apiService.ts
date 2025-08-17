// services/apiService.ts

export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조를 기반으로 한 인터페이스
export interface SaveDataPayload {
  receipt_no: string;
  site: string;
  item: string[];
  user_name: string;
  values: Record<string, Record<string, SavedValueEntry>>;
}

export interface LoadedData {
  receipt_no: string;
  site: string;
  item: string[];
  user_name: string;
  values: {
    TU?: Record<string, SavedValueEntry>;
    Cl?: Record<string, SavedValueEntry>;
    [key: string]: Record<string, SavedValueEntry> | undefined;
  };
}

// ---- 환경변수 (Vite) ----
const SAVE_TEMP_API_URL =
  import.meta.env.VITE_SAVE_TEMP_API_URL ??
  'https://api-2rhr2hjjjq-uc.a.run.app/save-temp'; // fallback

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  'https://api-2rhr2hjjjq-uc.a.run.app/load-temp'; // fallback

const API_KEY: string | undefined = import.meta.env.VITE_API_KEY;

// 공통 헤더 생성
function buildHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  headers['Accept'] = 'application/json';

  // API 키가 있으면 헤더에 첨부 (x-api-key로 사용)
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

/**
 * 임시 저장 데이터를 Firestore API로 전송합니다.
 * @param payload 저장할 데이터
 * @returns API 응답 메시지
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error('VITE_SAVE_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  try {
    console.log('Firestore 임시 저장 API 호출, 페이로드:', payload);

    const response = await fetch(SAVE_TEMP_API_URL, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) errorMessage = errorData.message;
      } catch {
        /* ignore parse error */
      }
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log('Firestore 임시 저장 성공:', responseData);

    return { message: responseData.message || 'Firestore에 성공적으로 저장되었습니다.' };
  } catch (error: any) {
    console.error('Firestore 임시 저장 API 호출 실패:', error);
    throw new Error(error?.message || 'Firestore에 임시 저장 중 알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * Firestore API에서 임시 저장된 데이터를 불러옵니다.
 * @param receiptNumber 불러올 데이터의 접수번호
 * @returns 불러온 데이터
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error('VITE_LOAD_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  try {
    console.log('Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:', receiptNumber);

    const url = new URL(LOAD_TEMP_API_URL);
    url.searchParams.append('receipt_no', receiptNumber);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(false),
    });

    const notFoundError = new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`);

    if (!response.ok) {
      if (response.status === 404) throw notFoundError;

      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) {
          if (String(errorData.message).toLowerCase().includes('not found')) {
            throw notFoundError;
          }
          errorMessage = errorData.message;
        }
      } catch (e) {
        /* ignore parse error */
      }
      throw new Error(errorMessage);
    }

    const responseData = (await response.json()) as LoadedData;
    console.log('Firestore 데이터 로딩 성공:', responseData);

    if (!responseData || !responseData.values || Object.keys(responseData.values).length === 0) {
      throw notFoundError;
    }

    return responseData;
  } catch (error) {
    console.error('Firestore 임시 저장 데이터 로딩 API 호출 실패:', error);
    throw error;
  }
};
