// src/services/apiService.ts

// ================== 타입 ==================
export interface SavedValueEntry {
  val: string;
  time: string;
}

export interface SaveDataPayload {
  receipt_no: string; // 서버 호환(스네이크)
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

// ================== ENV ==================
const SAVE_TEMP_API_URL = import.meta.env.VITE_SAVE_TEMP_API_URL;
const LOAD_TEMP_API_URL = import.meta.env.VITE_LOAD_TEMP_API_URL;
const API_KEY = import.meta.env.VITE_API_KEY;

if (!SAVE_TEMP_API_URL) throw new Error("VITE_SAVE_TEMP_API_URL 환경 변수가 설정되지 않았습니다.");
if (!LOAD_TEMP_API_URL) throw new Error("VITE_LOAD_TEMP_API_URL 환경 변수가 설정되지 않았습니다.");

// ================== 유틸 ==================
function buildHeaders(isJson = true): HeadersInit {
  const h: Record<string, string> = {};
  if (isJson) h["Content-Type"] = "application/json";
  h["Accept"] = "application/json";
  if (API_KEY) h["x-api-key"] = API_KEY; // 서버에서 사용 시
  return h;
}

// 전각 하이픈/공백 정리
function normalizeReceipt(raw: string) {
  return (raw ?? "")
    .replace(/[‐–—―ー－]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

// 응답 보정
function ensureLoadedShape(data: any, fallbackReceipt: string): LoadedData {
  const rn = data?.receipt_no ?? data?.receiptNo ?? fallbackReceipt;
  return {
    receipt_no: rn,
    site: data?.site ?? "",
    item: Array.isArray(data?.item) ? data.item : [],
    user_name: data?.user_name ?? "",
    values: data?.values && typeof data.values === "object" ? data.values : {},
  };
}

// ================== API ==================

/** 임시 저장 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  const receipt = normalizeReceipt(payload.receipt_no);

  const res = await fetch(SAVE_TEMP_API_URL!, {
    method: "POST",
    headers: buildHeaders(true),
    // 서버 키 명 불확실성 대비(둘 다 전송)
    body: JSON.stringify({ ...payload, receipt_no: receipt, receiptNo: receipt }),
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
  return { message: data?.message || "Firestore에 성공적으로 저장되었습니다." };
};

/** 임시 로드 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  const receipt = normalizeReceipt(receiptNumber);
  const headersGet = buildHeaders(false);
  const headersPost = buildHeaders(true);

  type Attempt = () => Promise<{ ok: boolean; status: number; text: string }>;
  const attempts: Attempt[] = [
    // GET ?receipt_no=
    async () => {
      const u = new URL(LOAD_TEMP_API_URL!);
      u.searchParams.set("receipt_no", receipt);
      const r = await fetch(u.toString(), { method: "GET", headers: headersGet });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    // GET ?receiptNo=
    async () => {
      const u = new URL(LOAD_TEMP_API_URL!);
      u.searchParams.set("receiptNo", receipt);
      const r = await fetch(u.toString(), { method: "GET", headers: headersGet });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    // POST {receipt_no}
    async () => {
      const r = await fetch(LOAD_TEMP_API_URL!, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ receipt_no: receipt }),
      });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    // POST {receiptNo}
    async () => {
      const r = await fetch(LOAD_TEMP_API_URL!, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ receiptNo: receipt }),
      });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
  ];

  for (const run of attempts) {
    const { ok, status, text } = await run();

    if (ok) {
      const raw = text ? JSON.parse(text) : {};
      const data = ensureLoadedShape(raw, receipt);
      if (!data.values) data.values = {};
      return data;
    }

    // 404 또는 not found면 다음 시도
    if (status === 404 || /not\s*found/i.test(text)) continue;

    // 그 외 에러는 즉시 종료
    try {
      const err = JSON.parse(text);
      throw new Error(err?.message || `API 오류: ${status}`);
    } catch {
      throw new Error(`API 오류: ${status}`);
    }
  }

  throw new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`);
};

