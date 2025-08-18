

// services/apiService.ts

export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조를 기반으로 한 인터페이스
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

const SAVE_TEMP_API_URL = (import.meta as any).env.VITE_SAVE_TEMP_API_URL;
// VITE_LOAD_TEMP_API_URL이 잘못 설정된 경우를 대비하여 VITE_SAVE_TEMP_API_URL에서 파생시킵니다.
// 이는 /save-temp 엔드포인트에 GET 요청을 보내 404 오류가 발생하는 것을 방지하기 위함입니다.
const LOAD_TEMP_API_URL = "https://api-2rhr2hjjjq-uc.a.run.app/load-temp";


/**
 * 임시 저장 데이터를 Firestore API로 전송합니다.
 * @param payload 저장할 데이터
 * @returns API 응답 메시지
 */
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  if (!SAVE_TEMP_API_URL) {
    throw new Error("저장 API URL이 설정되지 않았습니다. VITE_SAVE_TEMP_API_URL 환경변수를 확인해주세요.");
  }
  
  try {
    console.log("Firestore 임시 저장 API 호출, 페이로드:", payload);
    
    const response = await fetch(SAVE_TEMP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        // API에서 제공하는 구체적인 오류 메시지를 파싱합니다.
        const errorData = await response.json();
        if (errorData && errorData.message) {
          errorMessage = errorData.message;
        }
      } catch (e) {
        // 응답 본문 파싱에 실패하면 상태 텍스트를 사용합니다.
      }
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log("Firestore 임시 저장 성공:", responseData);
    
    return { message: responseData.message || "Firestore에 성공적으로 저장되었습니다." };

  } catch (error: any) {
    console.error("Firestore 임시 저장 API 호출 실패:", error);
    // UI에서 오류를 표시할 수 있도록 에러를 다시 던집니다.
    throw new Error(error.message || 'Firestore에 임시 저장 중 알 수 없는 오류가 발생했습니다.');
  }
};

/**
 * Firestore API에서 임시 저장된 데이터를 불러옵니다.
 * @param receiptNumber 불러올 데이터의 접수번호
 * @returns 불러온 데이터
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  if (!LOAD_TEMP_API_URL) {
    // 이 오류는 하드코딩된 URL이 제거되지 않는 한 발생하지 않아야 합니다.
    throw new Error("불러오기 API URL이 설정되지 않았습니다.");
  }
  
  try {
    console.log("Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:", receiptNumber);

    const url = new URL(LOAD_TEMP_API_URL);
    url.searchParams.append('receipt_no', receiptNumber);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    const notFoundError = new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`);

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      if (response.status === 404) {
          throw notFoundError;
      }
      try {
        const errorData = await response.json();
        if (errorData && errorData.message) {
           if (errorData.message.toLowerCase().includes('not found')) {
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
    
    if (!responseData || !responseData.values || Object.keys(responseData.values).length === 0) {
        throw notFoundError;
    }

    return responseData as LoadedData;

  } catch (error: any) {
    console.error("Firestore 임시 저장 데이터 로딩 API 호출 실패:", error);
    throw error; // UI 컴포넌트에서 잡을 수 있도록 에러를 다시 던집니다.
  }
};
