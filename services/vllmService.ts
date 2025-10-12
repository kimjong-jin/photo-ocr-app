// ✅ vLLM 서버 정식 주소
const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY"; // vLLM 서버 기본값
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ"; // 모델 경로

// ✅ vLLM 응답 타입
interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

// ✅ 멀티모달 콘텐츠 정의
interface VllmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// ✅ 메시지 구조
export interface VllmMessage {
  role: "user" | "assistant" | "system";
  content: string | VllmContentPart[];
}

// ✅ 요청 Payload
interface VllmPayload {
  model: string;
  messages: VllmMessage[];
  stream: boolean;
  response_format?: { type: "json_object" };
}

/**
 * ✅ vLLM API 호출 함수
 * @param messages - 메시지 배열
 * @param config - JSON 응답 형식 여부
 */
export const callVllmApi = async (
  messages: VllmMessage[],
  config?: { json_mode?: boolean }
): Promise<string> => {
  const payload: VllmPayload = {
    model: MODEL,
    messages,
    stream: false,
  };

  if (config?.json_mode) {
    payload.response_format = { type: "json_object" };
  }

  try {
    console.log("[vllmService] Request →", `${VLLM_BASE_URL}/chat/completions`);
    console.log("[vllmService] Payload →", JSON.stringify(payload, null, 2));

    const response = await fetch(`${VLLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `vLLM API Error: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    const data: VllmChatCompletionResponse = await response.json();
    const content = data.choices[0]?.message?.content || "";

    console.log("[vllmService] Raw content →", content);

    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/s);

      const parsedContent = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : content;

      if (!parsedContent || parsedContent.trim() === "") {
        console.warn("[vllmService] ⚠️ 빈 응답 또는 유효하지 않은 JSON 문자열.");
      }

      return parsedContent;
    }

    return content;
  } catch (error: any) {
    console.error("[vllmService] vLLM call failed:", error.message);
    throw new Error(error.message || "vLLM API 통신 중 오류 발생");
  }
};
