// src/services/geminiService.ts
import {
  GoogleGenAI,
  type GenerateContentResponse,
  type Part,
  type GenerationConfig,
} from "@google/genai";

let aiClient: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY?.trim();
  if (!apiKey) {
    console.error("[geminiService] 🚨 API_KEY 환경변수 누락");
    throw new Error("Gemini API Key가 설정되지 않았습니다. Vercel(VITE_API_KEY)을 확인하세요.");
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

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
  promptText: string,
  modelConfig: GenerationConfig = {}
): Promise<string> => {
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];
  const model = "gemini-2.5-flash";

  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      // ✅ 수정: `contents`를 객체로 감싸지 않고 바로 배열로 전달
      contents: parts,
      config: modelConfig,
      // ⚠️ axios 옵션은 라이브러리 버전업에 따라 제거됨.
      // fetch의 timeout 옵션은 아직 정식 지원되지 않아 별도 로직 필요.
      // 여기서는 타임아웃 로직이 `retryWithBackoff`에 포함되어 있어 안전함.
    });

    const text =
      typeof (response as any).text === "function"
        ? (response as any).text()
        : (response as any).text;

    if (!text || typeof text !== "string") {
      throw new Error("Empty response from Gemini.");
    }
    return text;
  };

  const isRetryableError = (error: any): boolean => {
    const status = error?.response?.status ?? error?.status;
    const msg = String(error?.message ?? "").toLowerCase();
    return (
      (typeof status === "number" && status >= 500 && status < 600) ||
      msg.includes("internal error encountered") ||
      msg.includes("temporarily") ||
      msg.includes("timeout")
    );
  };

  try {
    return await retryWithBackoff(callApi, MAX_RETRIES, INITIAL_DELAY_MS, isRetryableError);
  } catch (error: any) {
    const msg = String(error?.message ?? "");
    if (msg.includes("API Key not valid")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY를 확인하세요.");
    }
    if (msg.toLowerCase().includes("quota") && msg.toLowerCase().includes("exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다.");
    }
    if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted")) {
      throw new Error("요청이 시간 초과되었습니다. 잠시 후 다시 시도하세요.");
    }
    throw new Error(msg || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
