// services/geminiService.ts
import { AxiosError } from "axios";
import {
  GoogleGenerativeAI,
  GenerateContentResponse,
  Part,
  GenerateContentRequest,
} from "@google/generative-ai";

let aiClient: GoogleGenerativeAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 함수 */
const getGenAIClient = (): GoogleGenerativeAI => {
  const apiKey = import.meta.env.VITE_API_KEY?.trim();
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

const MAX_RETRIES = 3;          // 최대 재시도
const INITIAL_DELAY_MS = 1_000; // 1초

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      if (!shouldRetry(err) || attempt === retries) break;
      const wait = initialDelay * 2 ** attempt;
      console.warn(`[geminiService] ${attempt + 1}차 재시도 - ${wait}ms 대기`);
      await delay(wait);
    }
  }
  throw lastError;
}

/**
 * 이미지에서 텍스트 추출
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> => {
  const client = getGenAIClient();
  const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });

  const request: GenerateContentRequest = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: imageBase64 } } as Part,
        ],
      },
    ],
  };

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await model.generateContent(request);
    // SDK 버전에 따라 접근 방식이 다를 수 있음
    const text =
      response?.response?.candidates?.[0]?.content?.parts?.[0]?.text ??
      (response as any).text ??
      "";
    return text;
  };

  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      error.message?.toLowerCase?.().includes("internal error encountered")
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
    console.error("[geminiService] 모든 재시도 실패:", error?.message);
    if (error?.message?.includes("API Key not valid")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요.");
    }
    if (error?.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(error?.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
