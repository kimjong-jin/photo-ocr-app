// services/geminiService.ts

import { GoogleGenAI, GenerateContentResponse, Part, GenerateContentParameters } from "@google/genai";

/**
 * 환경변수 사용 안내 (Vite):
 * - Vercel/로컬 .env 모두 `VITE_` prefix 필요
 * - 우선순위: VITE_API_KEY → VITE_GEMINI_API_KEY
 */
const ENV_API_KEY =
  import.meta.env.VITE_API_KEY ??
  import.meta.env.VITE_GEMINI_API_KEY ??
  "";

// ---- Config ----
const DEFAULT_TIMEOUT_MS = 20_000; // 20s
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

let aiClient: GoogleGenAI | null = null;

/** Create singleton GoogleGenAI client */
const getGenAIClient = (): GoogleGenAI => {
  const apiKey = ENV_API_KEY.trim();
  if (!apiKey) {
    console.error("[geminiService] 🚨 Missing API key (VITE_API_KEY or VITE_GEMINI_API_KEY)");
    throw new Error(
      "Gemini API Key가 설정되지 않았습니다. 환경변수 VITE_API_KEY (또는 VITE_GEMINI_API_KEY)를 확인하세요."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
    console.info("[geminiService] GoogleGenAI client initialized");
  }
  return aiClient;
};

/** sleep */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** generic retry with exponential backoff */
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
      console.warn(`[geminiService] retry #${attempt + 1} – waiting ${waitTime}ms`);
      await delay(waitTime);
    }
  }
  throw lastError;
}

/**
 * Extract text from an image using Gemini
 * @param imageBase64 base64 image (no data: prefix)
 * @param mimeType e.g. "image/jpeg"
 * @param promptText instruction prompt
 * @param modelConfig optional model config
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
  const model = "gemini-2.5-flash";

  const callApi = async (): Promise<string> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response: GenerateContentResponse = await client.models.generateContent({
        model,
        contents: { parts },
        config: modelConfig,
        // signal used for timeout via AbortController
        // @ts-expect-error: pass-through to underlying fetch if supported
        signal: controller.signal,
      });

      // Some SDK versions expose .text as a function, others as a field
      const text = typeof (response as any).text === "function"
        ? (response as any).text()
        : (response as any).text;

      if (!text || typeof text !== "string") {
        throw new Error("Empty response from Gemini.");
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  };

  const isRetryableError = (error: any): boolean => {
    const status =
      error?.status ??
      error?.response?.status ??
      error?.cause?.status ??
      undefined;

    const msg = String(error?.message ?? "").toLowerCase();

    return (
      (typeof status === "number" && status >= 500 && status < 600) ||
      msg.includes("internal error encountered") ||
      msg.includes("temporarily") ||
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
    console.debug("[geminiService] extracted text:", extractedText);
    return extractedText;
  } catch (error: any) {
    const msg = String(error?.message ?? "");

    console.error("[geminiService] all retries failed:", msg);

    if (msg.includes("API Key not valid")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인하세요.");
    }
    if (msg.toLowerCase().includes("quota") && msg.toLowerCase().includes("exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("timeout")) {
      throw new Error("요청이 시간 초과되었습니다. 잠시 후 다시 시도하세요.");
    }

    throw new Error(msg || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
