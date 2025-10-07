// ✅ Cloudflare Worker 프록시 주소
const VLLM_BASE_URL =
  import.meta.env.MODE === "production"
    ? "https://vllm-proxy.011cyon.workers.dev" // 프록시로 우회 (CORS 해결)
    : "/genai"; // 개발시 Vite proxy 사용

const API_KEY = "EMPTY";
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ";

interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

interface VllmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface VllmMessage {
  role: "user";
  content: string | VllmContentPart[];
}

interface VllmPayload {
  model: string;
  messages: VllmMessage[];
  stream: boolean;
  response_format?: { type: "json_object" };
}

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
        `vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data: VllmChatCompletionResponse = await response.json();
    const content = data.choices[0]?.message?.content || "";

    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/s);
      if (jsonMatch) return jsonMatch[1] || jsonMatch[2];
    }

    return content;
  } catch (error: any) {
    console.error("[vllmService] vLLM call failed:", error.message);
    throw new Error(error.message || "vLLM API 통신 중 오류 발생");
  }
};
