// services/apiService.ts

export interface SavedValueEntry {
  val: string;
  time: string;
}

export interface SaveDataPayload {
  receipt_no: string;          // ⚠️ 서버 요구사항 확인 필요: receipt_no vs receiptNo
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

// ✅ 환경변수에서 모두 읽기 (하드코딩 제거)
const SAVE_TEMP_API_URL = import.meta.env.VITE_SAVE_TEMP_API_URL;
const LOAD_TEMP_API_URL = import.meta.env.VITE_LOAD_TEMP_API_URL;

/**
 * 임시 저장 API
 */
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error("저장 API URL이 설정되지 않았습니다. VITE_SAVE_TEMP_API_URL 환경변수를 확인해주세요.");
  }

  console.log("Firestore 임시 저장 API 호출, 페이로드:", payload);

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
  console.log("Firestore 임시 저장 성공:", responseData);

  return { message: responseData.message || "Firestore에 성공적으로 저장되었습니다." };
};

/**
 * 임시 불러오기 API
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    throw new Error("불러오기 API URL이 설정되지 않았습니다. VITE_LOAD_TEMP_API_URL 환경변수를 확인해주세요.");
  }

  console.log("Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:", receiptNumber);

  const url = new URL(LOAD_TEMP_API_URL);
  // ⚠️ 서버 스펙에 맞춰 receipt_no / receiptNo 확인
  url.searchParams.append("receipt_no", receiptNumber);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const notFoundError = new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`);

  if (!response.ok) {
    if (response.status === 404) throw notFoundError;
    let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData?.message) {
        if (errorData.message.toLowerCase().includes("not found")) throw notFoundError;
        errorMessage = errorData.message;
      }
    } catch (_) {}
    throw new Error(errorMessage);
  }

  const responseData = await response.json();
  console.log("Firestore 데이터 로딩 성공:", responseData);

  if (!responseData?.values || Object.keys(responseData.values).length === 0) {
    throw notFoundError;
  }

  return responseData as LoadedData;
};
