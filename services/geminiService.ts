import axios, { AxiosError } from "axios";
import {
  GoogleGenAI,
  GenerateContentResponse,
  Part,
  GenerateContentParameters,
} from "@google/genai";
import { callVllmApi } from "./vllmService";

let aiClient: GoogleGenAI | null = null;

/** Gemini 클라이언트 싱글턴 */
const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] 🚨 VITE_API_KEY 환경변수 미설정 또는 빈 값");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
    console.info("[geminiService] GoogleGenAI 클라이언트 초기화 완료");
  }
  return aiClient;
};

const DEFAULT_TIMEOUT_MS = 300_000; // 5분
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 재시도 + 지수 백오프 */
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
        `[geminiService] ${attempt + 1}차 재시도 - ${waitTime}ms 후 다시 시도`
      );
      await delay(waitTime);
    }
  }
  throw lastError;
}

/**
 * 이미지에서 텍스트 추출 (Gemini / vLLM 선택)
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
  modelConfig: GenerateContentParameters["config"] = {}
): Promise<string> => {
  const apiMode = localStorage.getItem("apiMode") || "gemini";

  /** vLLM 모드 */
  if (apiMode === "vllm") {
    const dataUri = `data:${mimeType};base64,${imageBase64}`;
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: promptText },
          { type: "image_url" as const, image_url: { url: dataUri } },
        ],
      },
    ];

    const json_mode = !!modelConfig?.responseSchema;
    const result = await callVllmApi(messages, { json_mode });

    // 안전 가드: 빈 응답/비JSON 방지
    if (!result || !result.trim()) {
      throw new Error("vLLM이 빈 응답을 반환했습니다.");
    }
    if (json_mode && !/^\s*[\[\{]/.test(result)) {
      throw new Error("vLLM이 JSON이 아닌 응답을 반환했습니다.");
    }
    return result;
  }

  /** Gemini 모드 */
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];

  const model = "gemini-2.5-flash";

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse =
      await client.models.generateContent({
        model,
        contents: { parts },
        config: modelConfig,
        // @ts-ignore SDK 내부 axios 옵션 전달
        axiosRequestConfig: { timeout: DEFAULT_TIMEOUT_MS },
      });
    // SDK 버전에 따라 .text 또는 .text()가 다를 수 있음
    // 사용자 코드가 .text를 사용하고 있으므로 그대로 유지
    return (response as any).text;
  };

  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      error?.message?.toLowerCase?.().includes("internal error encountered")
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
    console.error("[geminiService] 모든 재시도 실패:", error?.message || error);
    if (error?.message?.includes("API Key not valid")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요."
      );
    }
    if (error?.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(error?.message || "Gemini API 통신 중 알 수 없는 오류");
  }
};
