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

// @ts-ignore - This is populated by the build tool (e.g., Vite)
const env = import.meta.env;

const SAVE_TEMP_API_URL = env?.VITE_SAVE_TEMP_API_URL;
const LOAD_TEMP_API_URL = env?.VITE_LOAD_TEMP_API_URL;

const checkApiUrls = () => {
    if (!env) {
        const errorMsg = "빌드 환경 오류: import.meta.env가 정의되지 않았습니다. Vite와 같은 빌드 도구로 앱이 빌드되었는지 확인하세요.";
        console.error(`[apiService] ${errorMsg}`);
        throw new Error(errorMsg);
    }
    if (!SAVE_TEMP_API_URL || !LOAD_TEMP_API_URL) {
        const missingVars = [];
        if (!SAVE_TEMP_API_URL) missingVars.push('VITE_SAVE_TEMP_API_URL');
        if (!LOAD_TEMP_API_URL) missingVars.push('VITE_LOAD_TEMP_API_URL');
        const errorMsg = `API URL 환경변수가 설정되지 않았습니다: ${missingVars.join(', ')}. 임시 저장/불러오기 기능이 작동하지 않습니다.`;
        console.error(`[apiService] ${errorMsg}`);
        throw new Error(errorMsg);
    }
};


/**
 * 임시 저장 데이터를 Firestore API로 전송합니다.
 * @param payload 저장할 데이터
 * @returns API 응답 메시지
 */
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  checkApiUrls();
  try {
    if (SAVE_TEMP_API_URL?.includes('/load-temp')) {
      const configError = new Error("환경 변수 설정 오류: VITE_SAVE_TEMP_API_URL에 불러오기 API 주소가 설정된 것 같습니다. 호스팅 환경의 변수 설정을 확인해주세요.");
      console.error("[apiService] " + configError.message);
      throw configError;
    }
    
    console.log("Firestore 임시 저장 API 호출, 페이로드:", payload);
    
    const response = await fetch(SAVE_TEMP_API_URL!, {
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
  checkApiUrls();
  try {
    if (LOAD_TEMP_API_URL?.includes('/save-temp')) {
      const configError = new Error("환경 변수 설정 오류: VITE_LOAD_TEMP_API_URL에 저장 API 주소가 설정된 것 같습니다. 호스팅 환경의 변수 설정을 확인해주세요.");
      console.error("[apiService] " + configError.message);
      throw configError;
    }
      
    console.log("Firestore 임시 저장 데이터 로딩 API 호출, 접수번호:", receiptNumber);

    const url = new URL(LOAD_TEMP_API_URL!);
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
