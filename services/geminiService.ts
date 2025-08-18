import axios, { AxiosError } from "axios";
import {
  GoogleGenerativeAI,   // ✅ 올바른 클래스명
  GenerateContentResponse,
  Part,
  GenerateContentParameters,
} from "@google/generative-ai";  // ✅ 올바른 패키지명

let aiClient: GoogleGenerativeAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 함수 */
const getGenAIClient = (): GoogleGenerativeAI => {
  const apiKey = import.meta.env.GEMINI_API_KEY?.trim();  // ✅ 환경변수명 수정
  if (!apiKey) {
    console.error("[geminiService] 🚨 GEMINI_API_KEY 환경변수 미설정 또는 빈 값");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. GEMINI_API_KEY 환경변수를 확인해주세요."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenerativeAI({ apiKey });
    console.info("[geminiService] GoogleGenerativeAI 클라이언트 초기화 완료");
  }
  return aiClient;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
  modelConfig: GenerateContentParameters["generationConfig"] = {} // ✅ 타입 키 수정
): Promise<string> => {
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];
  const model = "gemini-2.5-flash";

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await client.generativeModel(model).generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: modelConfig,
    });
    return response.response.text();
  };

  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
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
        "유효하지 않은 Gemini API Key입니다. GEMINI_API_KEY 환경변수를 확인해주세요."
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
