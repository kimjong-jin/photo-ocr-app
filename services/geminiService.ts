// services/geminiService.ts
import { AxiosError } from "axios";
import {
  GoogleGenerativeAI,
  GenerateContentRequest,
  Part,
} from "@google/generative-ai";

let aiClient: GoogleGenerativeAI | null = null;

const GEMINI_MODEL = "gemini-2.5-pro"; // ← 요청하신 대로 고정
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

/** dataURL 이면 base64 본문만 추출 */
function toPureBase64(input: string): string {
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma === -1) throw new Error("잘못된 data URL 형식입니다.");
    return input.slice(comma + 1);
  }
  return input;
}

/** 지정된 시간(ms)만큼 대기 */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 프라미스 타임아웃 래퍼 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Request timed out after ${ms} ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
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
      if (!shouldRetry(err) || attempt === retries) break;
      const wait = initialDelay * 2 ** attempt;
      console.warn(`[geminiService] ${attempt + 1}차 재시도 - ${wait}ms 대기`);
      await delay(wait);
    }
  }
  throw lastError;
}

/** SDK 클라이언트 */
const getGenAIClient = (): GoogleGenerativeAI => {
  const apiKey = import.meta.env.VITE_API_KEY?.trim();
  if (!apiKey) {
    console.error("[geminiService] 🚨 VITE_API_KEY 미설정/빈 값");
    throw new Error("Gemini API Key가 설정되지 않았습니다. VITE_API_KEY 환경변수를 확인해주세요.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenerativeAI(apiKey);
    console.info("[geminiService] GoogleGenerativeAI 클라이언트 초기화");
  }
  return aiClient;
};

/**
 * 이미지에서 텍스트를 추출
 * @param imageBase64 base64(또는 dataURL)
 * @param mimeType 예: "image/jpeg"
 * @param promptText 프롬프트
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> => {
  const client = getGenAIClient();
  const model = client.getGenerativeModel({ model: GEMINI_MODEL });

  const pure = toPureBase64(imageBase64);

  const request: GenerateContentRequest = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: pure } } as Part,
        ],
      },
    ],
  };

  const callApi = async (): Promise<string> => {
    const res = await withTimeout(model.generateContent(request), DEFAULT_TIMEOUT_MS);
    if (res?.response?.text) return res.response.text();
    const fallback =
      (res as any)?.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ??
      (res as any)?.text ??
      "";
    return String(fallback);
  };

  const isRetryableError = (error: any): boolean => {
    const msg = String(error?.message || "").toLowerCase();
    const status =
      (error as AxiosError)?.response?.status ??
      (error as any)?.status ??
      (error as any)?.cause?.status;

    return (
      (typeof status === "number" && ((status >= 500 && status < 600) || status === 429)) ||
      msg.includes("internal error encountered") ||
      msg.includes("fetch failed") ||
      msg.includes("timeout") ||
      msg.includes("temporarily") ||
      msg.includes("ecconnreset")
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
    const msg = String(error?.message || "");
    if (msg.includes("API Key not valid")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요.");
    }
    if (msg.includes("Quota exceeded") || msg.toLowerCase().includes("rate")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(msg || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
