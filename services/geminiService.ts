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
  const apiKey = import.meta.env.VITE_API_KEY?.trim();
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

const DEFAULT_TIMEOUT_MS = 20_000; // 요청 타임아웃 (20초)
const MAX_RETRIES = 3; // 최대 재시도 횟수
const INITIAL_DELAY_MS = 1_000; // 백오프 시작 지연 (1초)

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
  const client = getGenAIClient();

  const parts: Part[] = [
    { text: promptText },
    { inlineData: { mimeType, data: imageBase64 } },
  ];
  // 🚨 변경된 부분: 현재 시점(2025년 7월 16일)에 이미지와 텍스트 입력을 모두 처리하는 가장 일반적인 모델인
  // 'gemini-1.5-flash' 또는 'gemini-1.5-pro'를 사용하도록 변경합니다.
  // 실제 사용 전에 Google AI Gemini 모델 문서를 확인하여 최신 모델 이름을 적용하세요.
  const model = "gemini-1.5-flash"; // 또는 "gemini-1.5-pro" (더 높은 성능, 더 높은 비용)

  // 실제 API 호출 함수
  const callApi = async (): Promise<string> => {
    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      contents: { parts },
      config: modelConfig,
      // @ts-ignore: SDK 내부 axios 옵션 전달용
      axiosRequestConfig: { timeout: DEFAULT_TIMEOUT_MS },
    });
    return response.text;
  };

  // 500~599번대 서버 오류만 재시도 대상
  const isRetryableError = (error: any): boolean => {
    const status = (error as AxiosError).response?.status;
    return (
      (status !== undefined && status >= 500 && status < 600) ||
      error.message?.toLowerCase().includes("internal error encountered")
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
    console.error("[geminiService] 모든 재시도 실패:", error.message);
    const axiosError = error as AxiosError;

    if (axiosError.response?.status === 404 && axiosError.message.includes("models/")) {
      throw new Error(
        `지정된 Gemini AI 모델 '${model}'을(를) 찾을 수 없거나 더 이상 지원하지 않습니다. Google Gemini API 문서를 확인하여 유효한 모델 이름을 사용해주세요.`
      );
    }
    if (axiosError.message?.includes("API Key not valid")) {
      throw new Error(
        "유효하지 않은 Gemini API Key입니다. API_KEY 환경변수를 확인해주세요."
      );
    }
    if (axiosError.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API 할당량을 초과했습니다. 사용량을 확인해주세요.");
    }
    // 기타 Axois 오류 처리 (네트워크 오류, 타임아웃 등)
    if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
            throw new Error(`Gemini API 요청 시간 초과 (Timeout: ${DEFAULT_TIMEOUT_MS / 1000}초). 네트워크 상태를 확인하거나 타임아웃 설정을 늘려주세요.`);
        }
        if (error.response) {
            // 서버 응답이 있는 오류 (예: 400 Bad Request, 401 Unauthorized 등)
            throw new Error(`Gemini API 오류: ${error.response.status} - ${error.response.statusText || '알 수 없는 오류'}. ${error.response.data?.error?.message || ''}`);
        }
        if (error.request) {
            // 요청은 전송되었으나 응답을 받지 못한 오류 (네트워크 문제 등)
            throw new Error("Gemini API 요청 실패: 서버로부터 응답을 받지 못했습니다. 네트워크 연결을 확인해주세요.");
        }
    }
    throw new Error(
      error.message || "Gemini API 통신 중 알 수 없는 오류가 발생했습니다."
    );
  }
};
