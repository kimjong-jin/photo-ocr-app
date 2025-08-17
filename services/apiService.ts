// src/services/apiService.ts

// ================== 타입 정의 ==================
export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조 기반
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

// ================== API 호출 ==================

/**
 * 임시 저장 (Firestore API)
 */
export const callSaveTempApi = async (
  payload: SaveDataPayload
): Promise<{ message: string }> => {
  // 환경 변수에서 API URL을 가져오도록 수정
  const SAVE_TEMP_API_URL = import.meta.env.VITE_SAVE_TEMP_API_URL;
  if (!SAVE_TEMP_API_URL) {
    throw new Error('VITE_SAVE_TEMP_API_URL 환경 변수가 설정되지 않았습니다.');
  }

  try {
    console.log("Firestore 임시 저장 API 호출, 페이로드:", payload);

    const response = await fetch(SAVE_TEMP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // 응답 파싱 실패 시 상태 텍스트 사용
      }
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log("Firestore 임시 저장 성공:", responseData);

    return {
      message:
        responseData.message || "Firestore에 성공적으로 저장되었습니다.",
    };
  } catch (error: any) {
    console.error("Firestore 임시 저장 API 호출 실패:", error);
    throw new Error(
      error.message ||
        "Firestore에 임시 저장 중 알 수 없는 오류가 발생했습니다."
    );
  }
};

/**
 * 임시 로드 (Firestore API)
 */
export const callLoadTempApi = async (
  receiptNumber: string
): Promise<LoadedData> => {
  // 환경 변수에서 API URL을 가져오도록 수정
  const LOAD_TEMP_API_URL = import.meta.env.VITE_LOAD_TEMP_API_URL;
  if (!LOAD_TEMP_API_URL) {
    throw new Error('VITE_LOAD_TEMP_API_URL 환경 변수가 설정되지 않았습니다.');
  }

  try {
    console.log("Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:", receiptNumber);

    const url = new URL(LOAD_TEMP_API_URL);
    url.searchParams.append("receipt_no", receiptNumber);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const notFoundError = new Error(
      `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`
    );

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      if (response.status === 404) {
        throw notFoundError;
      }
      try {
        const errorData = await response.json();
        if (errorData?.message) {
          if (errorData.message.toLowerCase().includes("not found")) {
            throw notFoundError;
          }
          errorMessage = errorData.message;
        }
      } catch (e: any) {
        if (e === notFoundError) throw e;
      }
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log("Firestore 데이터 로딩 성공:", responseData);

    if (
      !responseData ||
      !responseData.values ||
      Object.keys(responseData.values).length === 0
    ) {
      throw notFoundError;
    }

    return responseData as LoadedData;
  } catch (error: any) {
    console.error("Firestore 임시 저장 데이터 로딩 API 호출 실패:", error);
    throw error;
  }
};
