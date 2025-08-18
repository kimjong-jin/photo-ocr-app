// geminiService.ts

import type { AxiosError } from "axios";
import {
  GoogleGenerativeAI,
  type GenerateContentResponse,
  type Part,
  type GenerateContentParameters,
} from "@google/generative-ai";

let aiClient: GoogleGenerativeAI | null = null;

/** Gemini 클라이언트 싱글턴 생성 */
const getGenAIClient = (): GoogleGenerativeAI => {
  // ✅ Vite 환경변수는 반드시 VITE_ 접두사가 필요
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("[geminiService] 🚨 VITE_GEMINI_API_KEY 미설정 또는 빈 값");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. VITE_GEMINI_API_KEY 환경변수를 확인해주세요."
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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number,
  initialDelay: number,
  shouldRetry: (err: unknown) => boolean
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
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
 * 이미지에서 텍스트 추출 (멀티모달 프롬프트)
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
  modelConfig: GenerateContentParameters["generationConfig"] = {}
): Promise<string> => {
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];

  // 모델명은 프로젝트 정책에 맞게 조정 가능
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: modelConfig,
    });
    return response.response.text();
  };

  const isRetryableError = (error: unknown): boolean => {
    const e = error as AxiosError & { status?: number; message?: string };
    const status = e?.response?.status ?? e?.status;
    const msg = (e?.message || "").toLowerCase();

    return (
      (typeof status === "number" && status >= 500 && status < 600) ||
      msg.includes("internal error encountered") ||
      msg.includes("temporarily unavailable") ||
      msg.includes("deadline exceeded") ||
      msg.includes("timeout")
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

    const msg = String(error?.message || "").toLowerCase();

    if (msg.includes("api key not valid") || msg.includes("unauthorized")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_GEMINI_API_KEY 환경변수를 확인해주세요."
      );
    }
    if (msg.includes("quota") || msg.includes("rate limit")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error("Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
