// services/apiService.ts

// ---------- Types ----------
export interface SavedValueEntry { val: string; time: string; }

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
const readEnv = (key: string): string | undefined => {
  const v =
    (import.meta as any)?.env?.[key] ??
    (typeof window !== 'undefined' ? (window as any).__ENV?.[key] : undefined) ??
    (globalThis as any)?.[key];
  console.log(`[readEnv] key: ${key}, value:`, v);
  return typeof v === 'string' && v.trim() ? v : undefined;
};

const getEnvOr = (key: string, fallback?: string) => readEnv(key) ?? fallback;

// 배포 도메인에서는 ENV 우선, 없으면 하드코딩 URL 사용
const SAVE_TEMP_API_URL = getEnvOr(
  'VITE_SAVE_TEMP_API_URL',
  'https://api-2rhr2hjjjq-uc.a.run.app/save-temp'
);
const LOAD_TEMP_API_URL = getEnvOr(
  'VITE_LOAD_TEMP_API_URL',
  'https://api-2rhr2hjjjq-uc.a.run.app/load-temp'
);
// 키가 필요하다면 ENV에서 읽어서 헤더로 보냄(없어도 동작 가능한 서버면 undefined 처리)
const API_KEY = readEnv('VITE_API_KEY');

// ---------- Fetch helpers ----------
const parseJSONSafe = async (res: Response) => {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

const makeResponseError = async (res: Response, fallback: string) => {
  const js = await parseJSONSafe(res);
  let msg = `${fallback}: ${res.status} ${res.statusText}`;
  if (js && typeof (js as any).message === 'string' && (js as any).message.trim()) {
    msg = (js as any).message;
  }
  if (res.status === 0) {
    msg += ' (CORS 또는 네트워크 문제 가능성: 서버의 Access-Control-Allow-* / HTTPS 설정 확인)';
  }
  return new Error(msg);
};

// ---------- APIs ----------
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  try {
    console.log('[SAVE] url=', SAVE_TEMP_API_URL, 'hasApiKey=', !!API_KEY);
    console.log('[SAVE] payload=', payload);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    const res = await fetch(SAVE_TEMP_API_URL!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn('[SAVE][status]', res.status, res.statusText);
      const raw = await res.clone().text().catch(() => '');
      console.warn('[SAVE][raw]', raw);
      throw await makeResponseError(res, 'API 오류');
    }

    const data = (await parseJSONSafe(res)) ?? {};
    console.log('[SAVE] success:', data);
    return { message: (data as any).message || 'Firestore에 성공적으로 저장되었습니다.' };
  } catch (err: any) {
    if (err?.name === 'TypeError') {
      console.error('[SAVE] Network/CORS error:', err);
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    console.error('[SAVE] failed:', err);
    throw new Error(err?.message || 'Firestore에 임시 저장 중 알 수 없는 오류');
  }
};

export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  const notFoundMsg = `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`;

  try {
    const url = new URL(LOAD_TEMP_API_URL!);
    url.searchParams.set('receipt_no', receiptNumber);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (API_KEY) headers['x-api-key'] = API_KEY;

    console.log('[LOAD] url =', url.toString(), 'hasApiKey=', !!API_KEY);

    const res = await fetch(url.toString(), { method: 'GET', headers });

    console.log('[LOAD][status]', res.status, res.statusText);
    const raw = await res.clone().text().catch(() => '');
    console.log('[LOAD][raw]', raw);

    if (!res.ok) {
      if (res.status === 404) {
        console.warn('[LOAD] 404 Not Found for', receiptNumber);
        throw new Error(notFoundMsg);
      }
      throw await makeResponseError(res, 'API 오류');
    }

    const data = (raw ? JSON.parse(raw) : null) as LoadedData | null;
    console.log('[LOAD][parsed]', data);

    if (!data || !data.values || Object.keys(data.values).length === 0) {
      console.warn('[LOAD] empty values payload');
      throw new Error(notFoundMsg);
    }

    return data;
  } catch (err: any) {
    if (err?.name === 'TypeError') {
      console.error('[LOAD] Network/CORS error:', err);
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    console.error('[LOAD] failed:', err);
    throw err;
  }
};
