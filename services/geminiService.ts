// services/geminiService.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

let aiClient: GoogleGenerativeAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 함수 */
const getGenAIClient = (): GoogleGenerativeAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] 🚨 VITE_API_KEY 환경변수 미설정 또는 빈 값");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenerativeAI(apiKey);
    console.info("[geminiService] GoogleGenerativeAI 클라이언트 초기화 완료");
  }
  return aiClient;
};

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

/** 지정된 시간(ms)만큼 대기 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 재시도 + 지수적 백오프 로직 */
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
      if (!retryable || attempt === retries) break;
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
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> => {
  const client = getGenAIClient();
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });

  const callApi = async (): Promise<string> => {
    const result = await model.generateContent([
      { text: promptText },
      { inlineData: { mimeType, data: imageBase64 } },
    ]);
    return result.response.text();
  };

  const isRetryableError = (error: any): boolean => {
    const message = error?.message?.toLowerCase() ?? "";
    return (
      message.includes("internal error") ||
      message.includes("unavailable") ||
      message.includes("timeout")
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
    if (error.message.includes("api key not valid")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요."
      );
    }
    if (error.message.includes("quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(
      error.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다."
    );
  }
};
