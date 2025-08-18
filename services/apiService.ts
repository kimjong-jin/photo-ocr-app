// services/apiService.ts

// ===== 타입 =====
export interface SavedValueEntry {
  val: string;
  time: string;
}

// DrinkingWaterPage.tsx의 데이터 구조를 기반으로 한 인터페이스
export interface SaveDataPayload {
  receipt_no: string;        // 서버 스펙: snake_case 유지
  site: string;
  item: string[];            // 서버가 배열 기대
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

// ===== 유틸 =====
function trim(str: string) {
  return (str ?? "").trim();
}
function hasDetailSegment(no: string) {
  return /-\d+$/.test(trim(no)); // 끝이 "-숫자"
}

// ===== 엔드포인트 (옛날 코드대로 하드코딩) =====
const SAVE_TEMP_API_URL = "https://api-2rhr2hjjjq-uc.a.run.app/save-temp";
const LOAD_TEMP_API_URL = "https://api-2rhr2hjjjq-uc.a.run.app/load-temp";

/**
 * 임시 저장 데이터를 Firestore API로 전송합니다.
 * @param payload 저장할 데이터
 * @returns API 응답 메시지
 */
export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  try {
    const receipt = trim(payload.receipt_no);
    if (!receipt) throw new Error("receipt_no 누락");
    if (!hasDetailSegment(receipt)) throw new Error(`세부번호가 포함된 접수번호가 필요합니다 (받은 값: "${receipt}")`);

    console.log("[SAVE] Firestore 임시 저장 API 호출:", SAVE_TEMP_API_URL, payload);

    const response = await fetch(SAVE_TEMP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // receipt_no 공백 정리 후 전송
      body: JSON.stringify({ ...payload, receipt_no: receipt }),
      // 캐시 관련 불필요하지만 혹시 모를 프록시 이슈 방지
      cache: "no-store",
      credentials: "omit",
    });

    if (!response.ok) {
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.message) errorMessage = errorData.message;
      } catch {}
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log("[SAVE] Firestore 임시 저장 성공:", responseData);

    return { message: responseData.message || "Firestore에 성공적으로 저장되었습니다." };
  } catch (error: any) {
    console.error("[SAVE] Firestore 임시 저장 실패:", error);
    throw new Error(error?.message || "Firestore에 임시 저장 중 알 수 없는 오류가 발생했습니다.");
  }
};

/**
 * Firestore API에서 임시 저장된 데이터를 불러옵니다.
 * @param receiptNumber 불러올 데이터의 접수번호 (예: "17-020915-01-10")
 * @returns 불러온 데이터
 */
export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  try {
    const receipt = trim(receiptNumber);
    if (!receipt) throw new Error("불러오기용 접수번호 누락");
    if (!hasDetailSegment(receipt)) throw new Error(`세부번호가 포함된 접수번호가 필요합니다 (받은 값: "${receipt}")`);

    console.log("[LOAD] Firestore 데이터 로딩 API 호출:", LOAD_TEMP_API_URL, receipt);

    // 1차: snake_case (서버 스펙대로)
    const url1 = new URL(LOAD_TEMP_API_URL);
    url1.searchParams.append("receipt_no", receipt);
    // 캐시 무효(엣지/중간 프록시 대비)
    url1.searchParams.append("_", Date.now().toString());

    let response = await fetch(url1.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      cache: "no-store",
      credentials: "omit",
    });

    // 2차: camelCase fallback (서버 구현 차이 대비)
    if (!response.ok) {
      console.warn("[LOAD] receipt_no 실패 → receiptNo로 재시도");
      const url2 = new URL(LOAD_TEMP_API_URL);
      url2.searchParams.append("receiptNo", receipt);
      url2.searchParams.append("_", Date.now().toString());

      response = await fetch(url2.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
        credentials: "omit",
      });
    }

    const notFoundError = new Error(`저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receipt}).`);

    if (!response.ok) {
      if (response.status === 404) throw notFoundError;
      let errorMessage = `API 오류: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.message) {
          if (errorData.message.toLowerCase().includes("not found")) throw notFoundError;
          errorMessage = errorData.message;
        }
      } catch {}
      throw new Error(errorMessage);
    }

    const responseData = await response.json();
    console.log("[LOAD] Firestore 데이터 로딩 성공:", responseData);

    if (!responseData || !responseData.values || Object.keys(responseData.values).length === 0) {
      throw notFoundError;
    }

    return responseData as LoadedData;
  } catch (error: any) {
    console.error("[LOAD] Firestore 임시 저장 데이터 로딩 실패:", error);
    throw new Error(error?.message || "임시 저장 데이터 로딩 중 알 수 없는 오류가 발생했습니다.");
  }
};
