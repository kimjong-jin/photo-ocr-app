import { AxiosError } from "axios";
import {
  GoogleGenerativeAI,
  GenerateContentRequest,
  Part,
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

const DEFAULT_TIMEOUT_MS = 20_000; // 요청 타임아웃 (20초)
const MAX_RETRIES = 3;             // 최대 재시도 횟수
const INITIAL_DELAY_MS = 1_000;    // 백오프 시작 지연 (1초)

/** 지정된 시간(ms)만큼 대기 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> => {
  const client = getGenAIClient();

  // 필요 시 모델명 교체 가능: "gemini-2.5-flash" / "gemini-1.5-pro"
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });

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

  // 실제 API 호출 함수
  const callApi = async (): Promise<string> => {
    const res = await withTimeout(model.generateContent(request), DEFAULT_TIMEOUT_MS);
    // SDK 버전에 따라 text 접근 방식이 다를 수 있음
    const text =
      (res as any)?.response?.text?.() ??
      (res as any)?.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ??
      (res as any).text ??
      "";
    return text;
  };

  // 500~599번대 서버 오류만 재시도 대상
  const isRetryableError = (error: any): boolean => {
    const status =
      (error as AxiosError)?.response?.status ??
      (error as any)?.status;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      String(error?.message || "").toLowerCase().includes("internal error encountered")
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
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요."
      );
    }
    if (error?.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    throw new Error(
      error?.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다."
    );
  }
};
