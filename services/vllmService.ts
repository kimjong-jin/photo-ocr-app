// ✅ vLLM 서버 정식 주소 (직접 호출)
const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";

const API_KEY = "EMPTY"; // vLLM 서버 기본값
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ"; // 모델 경로

// ✅ vLLM 응답 타입 정의
interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

// ✅ 멀티모달 콘텐츠 정의 (텍스트 + 이미지)
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

// ✅ 요청 Payload 정의
interface VllmPayload {
  model: string;
  messages: VllmMessage[];
  stream: boolean;
  response_format?: { type: "json_object" };
}

// ✅ base64 → Blob URL 변환 함수
const base64ToBlobUrl = (base64Data: string, mimeType: string): string => {
  const byteString = atob(base64Data.split(",")[1]);
  const byteArray = Uint8Array.from(byteString, (c) => c.charCodeAt(0));
  const blob = new Blob([byteArray], { type: mimeType });
  return URL.createObjectURL(blob);
};

// ✅ base64 이미지 메시지를 blob URL로 변환
const transformBase64Images = (messages: VllmMessage[]): VllmMessage[] => {
  return messages.map((msg) => {
    if (typeof msg.content === "string") return msg;

    const newContent = msg.content.map((part) => {
      if (part.type === "image_url" && part.image_url?.url.startsWith("data:image/")) {
        const mimeMatch = part.image_url.url.match(/^data:(.+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : "image/png";
        const blobUrl = base64ToBlobUrl(part.image_url.url, mime);
        return {
          ...part,
          image_url: { url: blobUrl },
        };
      }
      return part;
    });

    return { ...msg, content: newContent };
  });
};

/**
 * ✅ vLLM API 호출 함수
 * @param messages - 대화 메시지 배열
 * @param config - JSON 응답 모드 여부 설정
 */
export const callVllmApi = async (
  messages: VllmMessage[],
  config?: { json_mode?: boolean }
): Promise<string> => {
  const transformedMessages = transformBase64Images(messages);

  const payload: VllmPayload = {
    model: MODEL,
    messages: transformedMessages,
    stream: false,
  };

  if (config?.json_mode) {
    payload.response_format = { type: "json_object" };
  }

  try {
    console.log("[vllmService] Request →", `${VLLM_BASE_URL}/chat/completions`);
    console.log("[vllmService] Payload →", payload);

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

    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/s);
      if (jsonMatch) {
        return jsonMatch[1] || jsonMatch[2];
      }
    }

    return content;
  } catch (error: any) {
    console.error("[vllmService] vLLM call failed:", error.message);
    throw new Error(error.message || "vLLM API 통신 중 오류 발생");
  }
};
