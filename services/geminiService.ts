import axios, { AxiosError } from "axios";
import type {
  GenerateContentParameters,
} from "@google/genai";
import { callVllmApi } from "./vllmService";

// ✅ 보안 강화: API 키는 서버(Vercel Serverless)에서만 사용
// 클라이언트에서는 /api/gemini-ocr 라우트를 통해 간접 호출합니다.
const GEMINI_API_ROUTE = '/api/gemini-ocr';

const DEFAULT_TIMEOUT_MS = 60_000;    // 요청 타임아웃 (60초 - 고해상도 이미지 대응)
const MAX_RETRIES = 3;                // 최대 재시도 횟수
const INITIAL_DELAY_MS = 1_000;       // 백오프 시작 지연 (1초)

/** 지정된 시간(ms)만큼 대기 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 + 지수적 백오프 로직 공통화
 * @param fn 호출 함수
 * @param retries 최대 재시도 횟수
 * @param initialDelay 시작 지연(ms)
 * @param shouldRetry 재시도 여부 판별 함수
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
  const apiMode = localStorage.getItem('apiMode') || 'gemini';

  if (apiMode === 'vllm') {
    try {
      const dataUri = `data:${mimeType};base64,${imageBase64}`;
      const messages = [{
          role: 'user' as const,
          content: [
              { type: 'text' as const, text: promptText },
              { type: 'image_url' as const, image_url: { url: dataUri } }
          ]
      }];
      const json_mode = !!modelConfig.responseSchema;
      const result = await callVllmApi(messages, { json_mode });
      console.debug("[vllmService] 최종 추출 텍스트:", result);
      return result;
    } catch (error: any) {
        console.error("[vllmService] vLLM call failed:", error.message);
        throw new Error(error.message || "vLLM API 통신 중 알 수 없는 오류가 발생했습니다.");
    }
  }

  // ✅ 보안 강화: Gemini API 키는 서버(Vercel Serverless Function)에서만 처리
  // 브라우저에서 직접 Gemini SDK를 호출하지 않으므로 키가 노출되지 않습니다.
  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
    const msg = error.message?.toLowerCase() ?? '';
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      status === 429 ||                              // Google Rate Limit → 재시도
      msg.includes("internal error encountered") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("network error") ||
      msg.includes("rate limit") ||
      msg.includes("resource exhausted") ||
      error.code === 'ECONNABORTED'
    );
  };

  const callApi = async (): Promise<string> => {
    const response = await axios.post(
      GEMINI_API_ROUTE,
      { imageBase64, mimeType, promptText, modelConfig },
      { timeout: DEFAULT_TIMEOUT_MS }
    );
    if (!response.data?.text) {
      throw new Error('서버 응답에 텍스트가 없습니다.');
    }
    return response.data.text;
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
        "유효하지 않은 Gemini API Key입니다. Vercel 환경변수 GEMINI_API_KEY를 확인해주세요."
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
