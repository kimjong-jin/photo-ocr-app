import axios, { AxiosError } from "axios";
import {
  GoogleGenAI,
  GenerateContentResponse,
  Part,
  GenerateContentParameters,
} from "@google/genai";

let aiClient: GoogleGenAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 함수 */
const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] 🚨 VITE_API_KEY 환경변수 미설정 또는 빈 값");
    throw new Error("Gemini API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
    console.info("[geminiService] GoogleGenAI 클라이언트 초기화 완료");
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
      console.warn(`[geminiService] ${attempt + 1}차 재시도 - ${waitTime}ms 후 다시 시도`);
      await delay(waitTime);
    }
  }
  throw lastError;
}

/** 이미지에서 텍스트를 추출 */
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

  const model = "gemini-2.5-pro"; // 구버전 모델

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      contents: { parts },
      config: modelConfig,
      // @ts-ignore
      axiosRequestConfig: { timeout: DEFAULT_TIMEOUT_MS },
    });
    return response.text;
  };

  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      error.message?.toLowerCase().includes("internal error")
    );
  };

  try {
    return await retryWithBackoff(callApi, MAX_RETRIES, INITIAL_DELAY_MS, isRetryableError);
  } catch (error: any) {
    if (error.message.includes("API Key not valid")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요.");
    }
    if (error.message.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다.");
    }
    throw new Error(error.message || "Gemini API 통신 중 알 수 없는 오류 발생");
  }
};
