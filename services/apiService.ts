// src/services/apiService.ts

// ================== Types ==================
export interface SavedValueEntry {
  val: string;
  time: string;
}

export interface SaveDataPayload {
  receipt_no: string; // 서버가 스네이크를 받을 수도 있어 유지
  site: string;
  item: string[];
  user_name: string;
  values: Record<string, Record<string, SavedValueEntry>>;
}

export interface LoadedData {
  receipt_no: string; // 응답이 receiptNo로 와도 아래에서 보정
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
  'https://api-2rhr2hjjjq-uc.a.run.app/save-temp'; // fallback (안전장치)

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  'https://api-2rhr2hjjjq-uc.a.run.app/load-temp'; // fallback (안전장치)

const API_KEY: string | undefined = import.meta.env.VITE_API_KEY;

// ================== Helpers ==================
function buildHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  headers['Accept'] = 'application/json';
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

// 접수번호 정규화(전각 대시/공백 등 정리)
function normalizeReceipt(raw: string) {
  return (raw ?? '')
    .replace(/[‐–—―ー－]/g, '-') // 다양한 대시 → 일반 하이픈
    .replace(/\s+/g, '')
    .trim();
}

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
 * 임시 저장: POST /save-temp
 * - 호환을 위해 body에 `receipt_no`와 `receiptNo`를 모두 포함(서버 스펙 불확실성 흡수)
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error('VITE_SAVE_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  const normalizedReceipt = normalizeReceipt(payload.receipt_no);
  const body = {
    ...payload,
    receipt_no: normalizedReceipt,
    receiptNo: normalizedReceipt, // camel도 함께 보내기
  };

  const res = await fetch(SAVE_TEMP_API_URL, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    try {
      const err = await res.json();
      throw new Error(err?.message || `API 오류: ${res.status} ${res.statusText}`);
    } catch {
      throw new Error(`API 오류: ${res.status} ${res.statusText}`);
    }
  }

  const data = await res.json().catch(() => ({}));
  return { message: data?.message || 'Firestore에 성공적으로 저장되었습니다.' };
};

/**
 * 임시 로드: GET /load-temp?receiptNo=...
 * - 404/“not found”면 ?receipt_no=로 1회 재시도
 * - values 비어 있어도 존재로 간주
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error('VITE_LOAD_TEMP_API_URL이(가) 설정되어 있지 않습니다.');
  }

  const receipt = normalizeReceipt(receiptNumber);
  const headers = buildHeaders(false);

  // 1차: ?receiptNo=
  const u1 = new URL(LOAD_TEMP_API_URL);
  u1.searchParams.set('receiptNo', receipt);

  let res = await fetch(u1.toString(), { method: 'GET', headers });
  let text = await res.text().catch(() => '');

  // 2차: ?receipt_no= (404 또는 "not found" 텍스트일 때만)
  if (res.status === 404 || /not\s*found/i.test(text)) {
    const u2 = new URL(LOAD_TEMP_API_URL);
    u2.searchParams.set('receipt_no', receipt);
    res = await fetch(u2.toString(), { method: 'GET', headers });
    text = await res.text().catch(() => '');
  }

  if (!res.ok) {
    // 404 또는 not found 메시지
    if (res.status === 404 || /not\s*found/i.test(text)) {
      throw new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`);
    }
    try {
      const err = JSON.parse(text);
      throw new Error(err?.message || `API 오류: ${res.status} ${res.statusText}`);
    } catch {
      throw new Error(`API 오류: ${res.status} ${res.statusText}`);
    }
  }

  const raw = text ? JSON.parse(text) : {};
  const data = ensureLoadedShape(raw, receipt);
  if (!data.values) data.values = {}; // ✅ 비어 있어도 OK(존재로 간주)
  return data;
};
