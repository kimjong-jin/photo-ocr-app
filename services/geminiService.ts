// geminiService.ts
// ✅ SDK 혼선 없이 동작하는 REST 버전 (패키지와 무관하게 동작)
// ✅ Vite 환경 변수: VITE_API_KEY, VITE_SAVE_TEMP_API_URL, VITE_LOAD_TEMP_API_URL

import axios, { AxiosError } from "axios";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_ID = "gemini-2.5-flash"; // 필요시 다른 모델명으로 교체 가능

let _apiKey: string | null = null;

/** Vite 환경변수에서 API 키 로드 */
function getApiKey(): string {
  if (_apiKey) return _apiKey;
  const key = import.meta.env.VITE_API_KEY?.trim();
  if (!key) {
    console.error("[geminiService] 🚨 VITE_API_KEY 미설정 또는 빈 값");
    throw new Error("Gemini API Key가 설정되지 않았습니다. VITE_API_KEY를 확인해주세요.");
  }
  _apiKey = key;
  return key;
}

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;

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
      const wait = initialDelay * 2 ** attempt;
      console.warn(`[geminiService] ${attempt + 1}차 재시도 - ${wait}ms 후 재시도`);
      await delay(wait);
    }
  }
  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  const e = error as AxiosError & { status?: number; message?: string };
  const status = e?.response?.status ?? e?.status;
  const msg = (e?.message || "").toLowerCase();
  return (
    (typeof status === "number" && status >= 500 && status < 600) ||
    status === 408 ||
    msg.includes("internal error") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("deadline exceeded") ||
    msg.includes("timeout")
  );
}

/** v1beta 응답에서 텍스트를 꺼내기 */
function extractTextFromCandidates(resp: any): string {
  const parts = resp?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => p?.text).filter(Boolean).join("\n").trim();
  if (text) return text;

  const reason =
    resp?.promptFeedback?.blockReason ||
    resp?.candidates?.[0]?.finishReason ||
    resp?.candidates?.[0]?.safetyRatings;
  if (reason) throw new Error("출력이 정책에 의해 차단되었습니다. 프롬프트를 조정해주세요.");

  throw new Error("응답에서 텍스트를 추출하지 못했습니다.");
}

/**
 * 이미지에서 텍스트 추출 (멀티모달, REST)
 * @param imageBase64  data URL 접두사 제거된 순수 base64 문자열 권장
 * @param mimeType     예: 'image/jpeg' | 'image/png'
 * @param promptText   OCR 지시문
 * @param generationConfig  예: { temperature: 0 }
 */
export async function extractTextFromImage(
  imageBase64: string,
  mimeType: string,
  promptText: string,
  generationConfig: Record<string, unknown> = {}
): Promise<string> {
  const apiKey = getApiKey();
  const url = `${API_BASE}/models/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
      },
    ],
    generationConfig,
  };

  const callApi = async (): Promise<string> => {
    const { data } = await axios.post(url, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
    });
    return extractTextFromCandidates(data);
  };

  try {
    return await retryWithBackoff(callApi, MAX_RETRIES, INITIAL_DELAY_MS, isRetryableError);
  } catch (error: any) {
    console.error("[geminiService] 실패:", error?.message || error);
    const status = error?.response?.status;
    const msg = String(error?.message || "").toLowerCase();

    if (status === 401 || msg.includes("api key") || msg.includes("unauthorized")) {
      throw new Error("유효하지 않은 Gemini API Key입니다. VITE_API_KEY 값을 확인하세요.");
    }
    if (status === 429 || msg.includes("quota") || msg.includes("rate limit")) {
      throw new Error("Gemini API 할당량을 초과했거나 일시 제한되었습니다. 사용량을 확인하세요.");
    }
    throw new Error("Gemini API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
}
