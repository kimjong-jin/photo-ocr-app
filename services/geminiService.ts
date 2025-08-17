// services/geminiService.ts

import {
  GoogleGenAI,
  GenerateContentResponse,
  Part,
  GenerateContentParameters,
} from "@google/genai";

let aiClient: GoogleGenAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 함수 */
const getGenAIClient = (): GoogleGenAI => {
  // ✅ Vite 환경에서는 반드시 import.meta.env 사용
  const apiKey =
    import.meta.env.VITE_API_KEY?.trim() ??
    import.meta.env.VITE_GEMINI_API_KEY?.trim();

  if (!apiKey) {
    console.error("[geminiService] 🚨 API_KEY 환경변수 누락");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. .env 파일에 VITE_API_KEY=... 추가하세요."
    );
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
    console.info("[geminiService] GoogleGenAI 클라이언트 초기화 완료");
  }
  return aiClient;
};

const DEFAULT_TIMEOUT_MS = 20_000;    // 요청 타임아웃 (20초)
const MAX_RETRIES = 3;                // 최대 재시도 횟수
const INITIAL_DELAY_MS = 1_000;       // 백오프 시작 지연 (1초)

/** 지정된 시간(ms)만큼 대기 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 + 지수적 백오프 로직 공통화
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number,
  initialDelay: number,
  shouldRetry: (err: any) => boolean
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const retryable = shouldRetry(err);
      if (!retryable || attempt === retries) {
        // 재시도 불가능하거나 마지막 시도인 경우, 현재 오류를 다시 던집니다.
        break;
      }
      const waitTime = initialDelay * 2 ** attempt;
      console.warn(
        `[geminiService] ${attempt + 1}차 재시도 - ${waitTime}ms 후 다시 시도합니다`
      );
      await delay(waitTime);
    }
  }
  throw lastError;
}

/**
 * 이미지에서 텍스트를 추출
 * @param imageBase64 Base64 인코딩된 이미지 데이터
 * @param mimeType 이미지 MIME 타입 (e.g. "image/jpeg")
 * @param promptText 분석용 프롬프트
 * @param modelConfig Gemini 모델 구성 (optional)
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
  modelConfig: GenerateContentParameters["config"] = {}
): Promise<string> => {
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];
  const model = "gemini-2.5-flash"; // 모델 명시

  // 실제 API 호출 함수
  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      contents: [{ parts }], // contents 배열에 { parts } 객체로 전달
      config: modelConfig,
      // @ts-ignore: SDK 내부 axios 옵션 전달용 (가능하면 @ts-ignore 없이 타입 지원 개선 고려)
      axiosRequestConfig: { timeout: DEFAULT_TIMEOUT_MS },
    });
    return response.text(); // .text() 메서드 호출
  };

  // 500~599번대 서버 오류만 재시도 대상
  const isRetryableError = (error: any): boolean => {
    const status = error?.response?.status ?? undefined;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      error.message?.toLowerCase().includes("internal error encountered")
    );
  };

  try {
    const extractedText = await retryWithBackoff(
      callApi,
      MAX_RETRIES,
      INITIAL_DELAY_MS,
      isRetryableError
    );
    console.debug("[geminiService] 최종 추출 텍스트:", extractedText);
    return extractedText;
  } catch (error: any) {
    console.error("[geminiService] 모든 재시도 실패:", error.message);
    if (error.message.includes("API Key not valid")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인하세요."
      );
    }
    if (error.message.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(
      error.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다."
    );
  }
};
