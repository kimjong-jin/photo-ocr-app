// services/apiService.ts

// ---------- Types ----------
export interface SavedValueEntry {
  val: string;
  time: string;
}

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

// ---------- Env helpers ----------
type EnvKey = 'VITE_API_KEY' | 'VITE_SAVE_TEMP_API_URL' | 'VITE_LOAD_TEMP_API_URL';

/** 런타임/빌드타임 환경변수 읽기 + 로깅 + 폴백(window.__ENV, globalThis) */
export const readEnv = (key: string): string | undefined => {
  const v =
    (import.meta as any)?.env?.[key] ??
    (typeof window !== 'undefined' ? (window as any).__ENV?.[key] : undefined) ??
    (globalThis as any)?.[key];

  // 어떤 경로로 읽혔는지 로그
  const from =
    (import.meta as any)?.env?.[key] !== undefined
      ? 'import.meta.env'
      : typeof window !== 'undefined' && (window as any).__ENV?.[key] !== undefined
      ? 'window.__ENV'
      : (globalThis as any)?.[key] !== undefined
      ? 'globalThis'
      : 'undefined';

  console.log(`[readEnv] key: ${key}, from: ${from}, value:`, v);
  return typeof v === 'string' && v.trim() ? v : undefined;
};

/** 없으면 즉시 실패 + 환경 덤프 로그 */
const getEnvOrThrow = (key: EnvKey): string => {
  const val = readEnv(key);
  if (!val) {
    // 실패 시 환경별 상태를 함께 로그
    // (globalThis는 너무 커서 키 일부만 표시)
    console.error('환경변수 미설정', {
      key,
      importMetaEnv: (import.meta as any)?.env,
      windowEnv: typeof window !== 'undefined' ? (window as any).__ENV : undefined,
      globalEnvKeys: typeof globalThis !== 'undefined' ? Object.keys(globalThis as any).slice(0, 50) : [],
    });
    throw new Error(`${key} 환경변수가 설정되어 있지 않습니다.`);
  }
  return val;
};

// ---------- Fetch helpers ----------
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

/** 공통 에러 메시지 생성(+ CORS/네트워크 힌트) */
const makeResponseError = async (res: Response, fallback: string) => {
  const js = await parseJSONSafe(res);
  let msg = `${fallback}: ${res.status} ${res.statusText}`;
  if (js && typeof (js as any).message === 'string' && (js as any).message.trim()) {
    msg = (js as any).message;
  }
  if (res.status === 0) {
    msg += ' (CORS 또는 네트워크 문제 가능성: 서버의 Access-Control-Allow-* / HTTPS 설정을 확인하세요)';
  }
  return new Error(msg);
};

// ---------- APIs ----------
/**
 * 임시 저장: Firestore API
 */
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  const SAVE_TEMP_API_URL = getEnvOrThrow('VITE_SAVE_TEMP_API_URL');
  const API_KEY = getEnvOrThrow('VITE_API_KEY');

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
    if (err?.name === 'TypeError') {
      // fetch 레벨 에러(TypeError 등) → 네트워크/CORS 가능성
      console.error('네트워크/CORS 레벨 오류:', err);
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    console.error('Firestore 임시 저장 API 호출 실패:', err);
    throw new Error(err?.message || 'Firestore에 임시 저장 중 알 수 없는 오류');
  }
};

/**
 * 임시 데이터 로드: Firestore API
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  const LOAD_TEMP_API_URL = getEnvOrThrow('VITE_LOAD_TEMP_API_URL');
  const API_KEY = getEnvOrThrow('VITE_API_KEY');

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
      console.error('네트워크/CORS 레벨 오류:', err);
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    console.error('Firestore 임시 저장 데이터 로딩 API 호출 실패:', err);
    throw err;
  }
};
