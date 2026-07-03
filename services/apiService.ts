// services/apiService.ts

// ===== 타입 =====
export interface SavedValueEntry {
  val: string;
  time: string;
}

export interface SaveDataPayload {
  receipt_no: string;        // 서버 스펙: snake_case 유지
  site: string;
  gps_address?: string;      // ✅ GPS 주소
  item: string[];            // 서버가 배열 기대
  user_name: string;
  values: Record<string, Record<string, SavedValueEntry>>;
}

export interface LoadedData {
  receipt_no: string;
  site: string;
  gps_address?: string;      // ✅ GPS 주소
  item: string[];
  user_name: string;
  values: {
    TU?: Record<string, SavedValueEntry>;
    Cl?: Record<string, SavedValueEntry>;
    [key: string]: Record<string, SavedValueEntry> | undefined;
  };
}

// ===== 유틸 =====
export function buildReceiptNo(base: string, detail: string) {
  const b = (base ?? "").trim();
  const d = (detail ?? "").trim();
  if (!b || !d) throw new Error("접수번호(공통)와 세부번호를 모두 입력하세요.");
  return `${b}-${d}`;
}
function trim(s: string) { return (s ?? "").trim(); }
function hasDetailSegment(no: string) { return /-\d+$/.test(trim(no)); } // 끝이 "-숫자"

// ===== 엔드포인트 (env → 폴백) =====
// 기본값을 Mac Studio 프록시(같은 도메인 상대경로 /api/save-temp,/api/load-temp)로 이전 — 구 Firebase/Firestore Cloud Run 폐기.
const RAW_SAVE_URL = process.env.SAVE_TEMP_API_URL ?? "/api/save-temp";
const RAW_LOAD_URL = process.env.LOAD_TEMP_API_URL ?? "/api/load-temp";

function isAbsolute(u: string) { return /^https?:\/\//i.test(u); }

// 경로 교정. 상대경로(Vercel 프록시)면 desiredPath 그대로 사용, 절대 URL이면 pathname 교정.
function ensurePath(urlStr: string, desiredPath: "/api/save-temp" | "/api/load-temp") {
  if (!isAbsolute(urlStr)) return desiredPath;
  const u = new URL(urlStr);
  if (u.pathname !== desiredPath) {
    console.warn(`[apiService] 경로 교정: ${u.pathname} → ${desiredPath}`);
    u.pathname = desiredPath;
  }
  return u.toString();
}

// 상대/절대 모두 안전하게 URL 객체 생성 (searchParams 조작용)
function toURL(urlStr: string) {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return isAbsolute(urlStr) ? new URL(urlStr) : new URL(urlStr, base);
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, {
    cache: "no-store",
    credentials: "omit",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

// ===== 임시 저장 =====
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  const receipt = trim(payload.receipt_no);
  if (!receipt) throw new Error("receipt_no 누락");
  if (!hasDetailSegment(receipt))
    throw new Error(`세부번호가 포함된 접수번호가 필요합니다 (받은 값: "${receipt}")`);

  const SAVE_TEMP_API_URL = ensurePath(RAW_SAVE_URL, "/api/save-temp");
  console.log("[SAVE] 호출:", SAVE_TEMP_API_URL, {
    ...payload,
    receipt_no: receipt,
  });

  const response = await fetchJson(SAVE_TEMP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      receipt_no: receipt,
      gps_address: payload.gps_address ?? null,
    }),
  });

  if (!response.ok) {
    let msg = `API 오류: ${response.status} ${response.statusText}`;
    try {
      const err = await response.json();
      if (err?.message) msg = err.message;
    } catch {}
    throw new Error(msg);
  }
  const json = await response.json();
  return {
    message: json.message || "Firestore에 성공적으로 저장되었습니다.",
  };
};

// ===== 임시 불러오기 =====
export const callLoadTempApi = async (
  receiptNumber: string,
  userName?: string
): Promise<LoadedData> => {
  const receipt = trim(receiptNumber);
  if (!receipt) throw new Error("불러오기용 접수번호 누락");
  if (!hasDetailSegment(receipt))
    throw new Error(`세부번호가 포함된 접수번호가 필요합니다 (받은 값: "${receipt}")`);

  const LOAD_TEMP_API_URL = ensurePath(RAW_LOAD_URL, "/api/load-temp");
  console.log("[LOAD] 호출:", LOAD_TEMP_API_URL, receipt);

  const notFoundError = new Error(
    `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`
  );

  // 1) GET + snake_case
  const url1 = toURL(LOAD_TEMP_API_URL);
  url1.searchParams.append("receipt_no", receipt);
  if (userName) url1.searchParams.append("user_name", userName);
  url1.searchParams.append("_", Date.now().toString()); // 캐시무효
  let res = await fetchJson(url1.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  // 2) 실패 시 GET + camelCase
  if (!res.ok) {
    console.warn("[LOAD] receipt_no 실패 → receiptNo로 재시도");
    const url2 = toURL(LOAD_TEMP_API_URL);
    url2.searchParams.append("receiptNo", receipt);
    if (userName) url2.searchParams.append("user_name", userName);
    url2.searchParams.append("_", Date.now().toString());
    res = await fetchJson(url2.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
  }

  // 3) 그래도 실패면 POST 바디로 조회
  if (!res.ok) {
    console.warn("[LOAD] GET 실패 → POST로 재시도");
    res = await fetchJson(LOAD_TEMP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ receipt_no: receipt, ...(userName ? { user_name: userName } : {}) }),
    });
  }

  if (!res.ok) {
    if (res.status === 404) throw notFoundError;
    let msg = `API 오류: ${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      if (err?.message?.toLowerCase?.().includes("not found"))
        throw notFoundError;
      if (err?.message) msg = err.message;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();

  // ✅ values가 없어도 gps_address만 있으면 데이터 있다고 판단
  if (!data) throw notFoundError;

  return data as LoadedData;
};
