// services/apiService.ts

// ===== 타입 =====
export interface SavedValueEntry {
  val: string;
  time: string;
}

export interface SaveDataPayload {
  // 서버 스펙: snake_case 유지
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

// ===== 공통 유틸 =====
// 공통번호 + 세부번호를 결합 (예: "17-020915-01", "1" → "17-020915-01-1")
export function buildReceiptNo(base: string, detail: string) {
  const b = (base ?? "").trim();
  const d = (detail ?? "").trim();
  if (!b || !d) throw new Error("접수번호(공통)와 세부번호를 모두 입력하세요.");
  return `${b}-${d}`;
}

// 좌우 공백만 정리 (하이픈/문자 형식은 그대로 둠: Firestore에 저장된 포맷과 1:1 매칭)
function normalizeReceiptNo(raw: string) {
  return (raw ?? "").trim();
}

// 끝이 "-숫자" 형태인지 검사 → 세부번호가 붙었는지 강제
function hasDetailSegment(no: string) {
  return /-\d+$/.test(no.trim());
}

// ===== 엔드포인트 (env → 폴백) =====
const SAVE_TEMP_API_URL =
  import.meta.env.VITE_SAVE_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/save-temp";

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/load-temp";

// ===== 임시 저장 =====
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error("VITE_SAVE_TEMP_API_URL 환경변수가 없습니다.");
  }

  const receipt = normalizeReceiptNo(payload.receipt_no);
  if (!hasDetailSegment(receipt)) {
    throw new Error(`세부번호가 누락되었습니다: ${receipt}`);
  }

  const response = await fetch(SAVE_TEMP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, receipt_no: receipt }),
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
  return { message: json.message || "Firestore에 성공적으로 저장되었습니다." };
};

// ===== 임시 불러오기 =====
export const callLoadTempApi = async (
  receiptNumber: string
): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error("VITE_LOAD_TEMP_API_URL 환경변수가 없습니다.");
  }

  const receipt = normalizeReceiptNo(receiptNumber);
  if (!hasDetailSegment(receipt)) {
    throw new Error(`세부번호가 누락되었습니다: ${receipt}`);
  }

  // 1차: snake_case (receipt_no)
  let url = new URL(LOAD_TEMP_API_URL);
  url.searchParams.append("receipt_no", receipt);

  let res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  // 실패 시 2차: camelCase (receiptNo)로 재시도
  if (!res.ok) {
    const retryUrl = new URL(LOAD_TEMP_API_URL);
    retryUrl.searchParams.append("receiptNo", receipt);

    res = await fetch(retryUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  }

  const notFound = new Error(
    `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`
  );

  if (!res.ok) {
    if (res.status === 404) throw notFound;
    let msg = `API 오류: ${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      if (err?.message?.toLowerCase().includes("not found")) throw notFound;
      if (err?.message) msg = err.message;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data?.values || Object.keys(data.values).length === 0) {
    throw notFound;
  }

  return data as LoadedData;
};
