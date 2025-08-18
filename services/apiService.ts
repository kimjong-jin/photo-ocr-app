// services/apiService.ts

export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조를 기반으로 한 인터페이스
export interface SaveDataPayload {
  receipt_no: string; // ⚠️ 서버 스펙: snake_case 유지
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

// ✅ 환경변수에서 읽고, 없으면 하드코딩된 URL 사용 (안전 폴백)
const SAVE_TEMP_API_URL =
  import.meta.env.VITE_SAVE_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/save-temp";

const LOAD_TEMP_API_URL =
  import.meta.env.VITE_LOAD_TEMP_API_URL ??
  "https://api-2rhr2hjjjq-uc.a.run.app/load-temp";

/**
 * 임시 저장 API
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error(
      "저장 API URL이 설정되지 않았습니다. VITE_SAVE_TEMP_API_URL 환경변수를 확인해주세요."
    );
  }

  console.log("[SAVE] Firestore 임시 저장 API 호출:", SAVE_TEMP_API_URL, payload);

  const response = await fetch(SAVE_TEMP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData?.message) errorMessage = errorData.message;
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const responseData = await response.json();
  console.log("[SAVE] Firestore 임시 저장 성공:", responseData);

  return {
    message: responseData.message || "Firestore에 성공적으로 저장되었습니다.",
  };
};

/**
 * 임시 불러오기 API
 */
export const callLoadTempApi = async (
  receiptNumber: string
): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error(
      "불러오기 API URL이 설정되지 않았습니다. VITE_LOAD_TEMP_API_URL 환경변수를 확인해주세요."
    );
  }

  console.log(
    "[LOAD] Firestore 데이터 로딩 API 호출:",
    LOAD_TEMP_API_URL,
    receiptNumber
  );

  // 1차 시도 (snake_case)
  let url = new URL(LOAD_TEMP_API_URL);
  url.searchParams.append("receipt_no", receiptNumber);

  let response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  // 404 또는 실패 시 camelCase로 재시도
  if (!response.ok) {
    console.warn("[LOAD] receipt_no 실패 → receiptNo로 재시도");

    const retryUrl = new URL(LOAD_TEMP_API_URL);
    retryUrl.searchParams.append("receiptNo", receiptNumber);

    response = await fetch(retryUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  }

  const notFoundError = new Error(
    `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`
  );

  if (!response.ok) {
    if (response.status === 404) throw notFoundError;
    let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData?.message) {
        if (errorData.message.toLowerCase().includes("not found"))
          throw notFoundError;
        errorMessage = errorData.message;
      }
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const responseData = await response.json();
  console.log("[LOAD] Firestore 데이터 로딩 성공:", responseData);

  if (!responseData?.values || Object.keys(responseData.values).length === 0) {
    throw notFoundError;
  }

  return responseData as LoadedData;
};
