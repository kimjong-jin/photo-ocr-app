// services/apiService.ts (정리본)

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

/** 안전한 JSON 파싱 (실패 시 null) */
const parseJSONSafe = async (res: Response) => {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** 공통 에러 메시지 생성 */
const makeResponseError = async (res: Response, fallback: string) => {
  const js = await parseJSONSafe(res);
  let msg = `${fallback}: ${res.status} ${res.statusText}`;
  if (js && typeof js.message === 'string' && js.message.trim()) {
    msg = js.message;
  }
  // 네트워크/프록시/CORS 환경에서 status 0 이거나 본문 비어있을 때 힌트
  if (res.status === 0) {
    msg += ' (CORS 또는 네트워크 문제 가능성: 서버의 Access-Control-Allow-* / HTTPS 설정을 확인하세요)';
  }
  return new Error(msg);
};

/**
 * 임시 저장: Firestore API
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  const SAVE_TEMP_API_URL = import.meta.env.VITE_SAVE_TEMP_API_URL as string | undefined;
  const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

  if (!SAVE_TEMP_API_URL) {
    throw new Error('저장 API URL이 설정되지 않았습니다. VITE_SAVE_TEMP_API_URL 환경변수를 확인해주세요.');
  }
  if (!API_KEY) {
    throw new Error('API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요.');
  }

  try {
    console.log('Firestore 임시 저장 API 호출, 페이로드:', payload);

    const res = await fetch(SAVE_TEMP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await makeResponseError(res, 'API 오류');
    }

    const data = (await parseJSONSafe(res)) ?? {};
    console.log('Firestore 임시 저장 성공:', data);
    return { message: (data as any).message || 'Firestore에 성공적으로 저장되었습니다.' };
  } catch (err: any) {
    // fetch 레벨 에러(TypeError 등) → 네트워크/CORS 가능성
    if (err?.name === 'TypeError') {
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    throw new Error(err?.message || 'Firestore에 임시 저장 중 알 수 없는 오류');
  }
};

/**
 * 임시 데이터 로드: Firestore API
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  const LOAD_TEMP_API_URL = import.meta.env.VITE_LOAD_TEMP_API_URL as string | undefined;
  const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

  if (!LOAD_TEMP_API_URL) {
    throw new Error('불러오기 API URL이 설정되지 않았습니다. VITE_LOAD_TEMP_API_URL 환경변수를 확인해주세요.');
  }
  if (!API_KEY) {
    throw new Error('API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요.');
  }

  const notFoundMsg = `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`;

  try {
    console.log('Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:', receiptNumber);

    const url = new URL(LOAD_TEMP_API_URL);
    url.searchParams.set('receipt_no', receiptNumber);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-api-key': API_KEY,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(notFoundMsg);
      }
      throw await makeResponseError(res, 'API 오류');
    }

    const data = (await parseJSONSafe(res)) as LoadedData | null;
    if (!data || !data.values || Object.keys(data.values).length === 0) {
      throw new Error(notFoundMsg);
    }

    console.log('Firestore 데이터 로딩 성공:', data);
    return data;
  } catch (err: any) {
    if (err?.name === 'TypeError') {
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    throw err;
  }
};
