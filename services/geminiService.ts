// services/geminiService.ts
import { AxiosError } from "axios";
import {
  GoogleGenerativeAI,
  GenerateContentResponse,
  Part,
  GenerateContentRequest,
} from "@google/generative-ai";

/**
 * Gemini SDK 클라이언트 (싱글턴)
 */
let aiClient: GoogleGenerativeAI | null = null;

/** Gemini 클라이언트 생성/반환 */
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

// 재시도/타임아웃 기본값
const DEFAULT_TIMEOUT_MS = 20_000; // 20초
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;

/** 지정된 시간(ms)만큼 대기 */
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

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
        `[geminiService] ${attempt + 1}차 재시도 - ${waitTime}ms 후 다시 시도합니다`
      );
      await delay(waitTime);
    }
  }
  throw lastError;
}

/**
 * (헬퍼) 요청에 타임아웃 감싸기
 * SDK가 fetch 옵션을 직접 받지 않으므로, 취소는 못 해도 결과 대기는 중단한다.
 */
async function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("요청 타임아웃")), ms)
    ),
  ]);
}

/**
 * 이미지에서 텍스트를 추출
 * @param imageBase64 Base64 인코딩된 이미지 데이터(헤더 없이 순수 base64)
 * @param mimeType 이미지 MIME 타입 (예: "image/jpeg")
 * @param promptText 분석용 프롬프트
 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string
): Promise<string> => {
  const client = getGenAIClient();

  // 권장 최신 모델
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

  // 실제 API 호출
  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await withTimeout(
      model.generateContent(request),
      DEFAULT_TIMEOUT_MS
    );

    // SDK 버전/응답 형태 호환 처리
    const text =
      (response as any)?.response?.candidates?.[0]?.content?.parts?.[0]?.text ??
      (response as any)?.text ??
      "";
    return typeof text === "string" ? text : "";
  };

  // 500~599 서버 오류만 재시도
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
    console.error("[geminiService] 모든 재시도 실패:", error?.message);
    if (error?.message?.includes?.("API Key not valid")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. VITE_API_KEY 환경변수를 확인해주세요."
      );
    }
    if (error?.message?.includes?.("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    if (error?.message === "요청 타임아웃") {
      throw new Error("Gemini API 응답이 지연됩니다. 잠시 후 다시 시도하세요.");
    }
    throw new Error(
      error?.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다."
    );
  }
};
