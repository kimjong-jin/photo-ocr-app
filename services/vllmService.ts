// ✅ Colab + ngrok 프록시 주소 (vLLM 서버 내부망 우회)
const VLLM_BASE_URL = "https://8dd5bd58cb0c.ngrok-free.app/proxy/vllm";

const API_KEY = "EMPTY"; // vLLM 기본 설정
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ"; // vLLM 서버 모델 경로

// ✅ 응답 타입 정의
interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

// ✅ 멀티모달 콘텐츠 타입 (텍스트 + 이미지)
interface VllmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// ✅ 메시지 구조 정의
export interface VllmMessage {
  role: "user" | "assistant" | "system";
  content: string | VllmContentPart[];
}

// ✅ 요청 Payload 구조
interface VllmPayload {
  model: string;
  messages: VllmMessage[];
  stream: boolean;
  response_format?: { type: "json_object" };
}

/**
 * ✅ vLLM API 호출 함수
 * @param messages - 대화 메시지 배열
 * @param config - JSON 응답 모드 여부 설정
 * @returns 모델 응답 텍스트
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
    console.log("[vllmService] Sending request to:", `${VLLM_BASE_URL}/chat/completions`);
    console.log("[vllmService] Payload:", payload);

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

    // ✅ JSON 모드일 때 ```json ...``` 감싸진 부분 정제
    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/s);
      if (jsonMatch) return jsonMatch[1] || jsonMatch[2];
    }

    return content;
  } catch (error: any) {
    console.error("[vllmService] vLLM call failed:", error);
    throw new Error(error.message || "vLLM API 통신 중 오류 발생");
  }
};
