// services/apiService.ts

// ================== Types ==================
export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조를 기반으로 한 인터페이스
export interface SaveDataPayload {
  receipt_no: string; // 서버가 스네이크를 받는 경우 대비 유지
  site: string;
  item: string[];
  user_name: string;
  values: Record<string, Record<string, SavedValueEntry>>;
}

export interface LoadedData {
  receipt_no: string; // 응답이 receiptNo로 와도 아래에서 receipt_no로 보정
  site: string;
  item: string[];
  user_name: string;
  values: {
    TU?: Record<string, SavedValueEntry>;
    Cl?: Record<string, SavedValueEntry>;
    [key: string]: Record<string, SavedValueEntry> | undefined;
  };
}

// ================== Env ==================
const SAVE_TEMP_API_URL =
  import.meta.env.VITE_SAVE_TEMP_API_URL ??
  'https://api-2rhr2hjjjq-uc.a.run.app/save-temp'; // fallback

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  'https://api-2rhr2hjjjq-uc.a.run.app/load-temp'; // fallback

const API_KEY: string | undefined = import.meta.env.VITE_API_KEY;

// ================== Helpers ==================
// 공통 헤더 생성
function buildHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  headers['Accept'] = 'application/json';

  // API 키가 있으면 헤더에 첨부 (x-api-key로 사용)
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

// 접수번호 정규화(전각 대시/여러 dash → '-', 공백 제거)
function normalizeReceipt(raw: string) {
  return (raw ?? '')
    .replace(/[‐–—―ー－]/g, '-') // 다양한 대시를 일반 하이픈으로
    .replace(/\s+/g, '')
    .trim();
}

// 서버 응답을 LoadedData 형태로 보정
function ensureLoadedShape(data: any, fallbackReceipt: string): LoadedData {
  const rn = data?.receipt_no ?? data?.receiptNo ?? fallbackReceipt;
  return {
    receipt_no: rn,
    site: data?.site ?? '',
    item: Array.isArray(data?.item) ? data.item : [],
    user_name: data?.user_name ?? '',
    values: (data?.values && typeof data.values === 'object') ? data.values : {},
  };
}

// ================== APIs ==================

/**
 * 임시 저장 데이터를 Firestore API로 전송합니다.
 * - 서버 호환을 위해 body에 `receipt_no`와 `receiptNo`를 모두 포함합니다.
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error('VITE_SAVE_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  try {
    const normalizedReceipt = normalizeReceipt(payload.receipt_no);
    const body = {
      ...payload,
      receipt_no: normalizedReceipt,
      // 서버가 camelCase만 읽는 경우 대비
      receiptNo: normalizedReceipt,
    };

    const response = await fetch(SAVE_TEMP_API_URL, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) errorMessage = errorData.message;
      } catch {/* ignore parse error */}
      throw new Error(errorMessage);
    }

    const responseData = await response.json().catch(() => ({}));
    return { message: responseData.message || 'Firestore에 성공적으로 저장되었습니다.' };
  } catch (error: any) {
    throw new Error(error?.message || 'Firestore에 임시 저장 중 알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * Firestore API에서 임시 저장된 데이터를 불러옵니다.
 * - 우선 `?receiptNo=`로 조회 (카멜케이스)
 * - 404/“not found” 응답 시 `?receipt_no=`로 1회 재시도 (스네이크케이스)
 * - values가 비어 있어도 존재로 간주(화면에서 “값 없음” 안내)
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error('VITE_LOAD_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  const receipt = normalizeReceipt(receiptNumber);
  const headers = buildHeaders(false);

  // 1차: GET ?receiptNo=
  const u1 = new URL(LOAD_TEMP_API_URL);
  u1.searchParams.set('receiptNo', receipt);

  let res = await fetch(u1.toString(), { method: 'GET', headers });
  let text = await res.text().catch(() => '');

  // 404거나 “not found” 텍스트면 2차 시도(?receipt_no=)
  if (res.status === 404 || /not\s*found/i.test(text)) {
    const u2 = new URL(LOAD_TEMP_API_URL);
    u2.searchParams.set('receipt_no', receipt);
    res = await fetch(u2.toString(), { method: 'GET', headers });
    text = await res.text().catch(() => '');
  }

  if (!res.ok) {
    if (res.status === 404 || /not\s*found/i.test(text)) {
      throw new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`);
    }
    try {
      const err = JSON.parse(text);
      if (err?.message) throw new Error(err.message);
    } catch {/* ignore */}
    throw new Error(`API 오류: ${res.status} ${res.statusText}`);
  }

  // 정상 응답 파싱 + 보정
  const raw = text ? JSON.parse(text) : {};
  const data = ensureLoadedShape(raw, receipt);

  // ✅ values가 비어 있어도 존재로 간주
  if (!data.values) data.values = {};

  return data;
};
