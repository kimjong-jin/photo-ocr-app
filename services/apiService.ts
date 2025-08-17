// src/services/apiService.ts

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

const SAVE_TEMP_API_URL =
  import.meta.env.VITE_SAVE_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/save-temp";

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/load-temp";

const API_KEY: string | undefined = import.meta.env.VITE_API_KEY;

function buildHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (isJson) headers["Content-Type"] = "application/json";
  headers["Accept"] = "application/json";
  if (API_KEY) headers["x-api-key"] = API_KEY;
  return headers;
}

function normalizeReceipt(raw: string) {
  return (raw ?? "")
    .replace(/[‐–—―ー－]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function ensureLoadedShape(data: any, fallbackReceipt: string): LoadedData {
  const rn = data?.receipt_no ?? data?.receiptNo ?? fallbackReceipt;
  return {
    receipt_no: rn,
    site: data?.site ?? "",
    item: Array.isArray(data?.item) ? data.item : [],
    user_name: data?.user_name ?? "",
    values: (data?.values && typeof data.values === "object") ? data.values : {},
  };
}

export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) throw new Error("VITE_SAVE_TEMP_API_URL 미설정");

  const normalizedReceipt = normalizeReceipt(payload.receipt_no);
  const body = { ...payload, receipt_no: normalizedReceipt, receiptNo: normalizedReceipt };

  const res = await fetch(SAVE_TEMP_API_URL, {
    method: "POST",
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
  return { message: data?.message || "Firestore에 성공적으로 저장되었습니다." };
};

export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) throw new Error("VITE_LOAD_TEMP_API_URL 미설정");

  const receipt = normalizeReceipt(receiptNumber);
  const headersGet = buildHeaders(false);
  const headersPost = buildHeaders(true);

  type AttemptResult = { ok: boolean; status: number; text: string };

  const attempts: Array<() => Promise<AttemptResult>> = [
    async () => {
      const u = new URL(LOAD_TEMP_API_URL);
      u.searchParams.set("receiptNo", receipt);
      const r = await fetch(u.toString(), { method: "GET", headers: headersGet });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    async () => {
      const u = new URL(LOAD_TEMP_API_URL);
      u.searchParams.set("receipt_no", receipt);
      const r = await fetch(u.toString(), { method: "GET", headers: headersGet });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    async () => {
      const r = await fetch(LOAD_TEMP_API_URL, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ receiptNo: receipt }),
      });
      const t = await r.text().catch(() => "");
      return { ok: r.ok, status: r.status, text: t };
    },
    async () => {
      const r = await fetch(LOAD_TEMP_API_URL, {
        method: "POST",
        headers: headersPost,
        body: JSON.stringify({ receipt_no: receipt }),
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
    if (status === 404 || /not\s*found/i.test(text)) continue;
    try {
      const err = JSON.parse(text);
      throw new Error(err?.message || `API 오류: ${status}`);
    } catch {
      throw new Error(`API 오류: ${status}`);
    }
  }

  throw new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`);
};
