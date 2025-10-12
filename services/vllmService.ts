const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY";
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ";

interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string | any[]; // 문자열/멀티모달 배열 대비
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

/** 멀티모달 배열일 경우 텍스트만 추출(방어적) */
function normalizeVllmContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    try {
      return content
        .map((p: any) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string") return p.text;
          return "";
        })
        .join("");
    } catch {
      return "";
    }
  }
  return "";
}

export const callVllmApi = async (
  messages: VllmMessage[],
  config?: { json_mode?: boolean }
): Promise<string> => {
  const payload: VllmPayload = {
    model: MODEL,
    messages,
    stream: false,
    ...(config?.json_mode ? { response_format: { type: "json_object" } } : {}),
  };

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
    throw new Error(`vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data: VllmChatCompletionResponse = await response.json();
  const raw = data.choices?.[0]?.message?.content;

  // 멀티모달 배열이 오면 텍스트만 모아봄
  const content = normalizeVllmContent(raw);

  if (!content || !content.trim()) {
    throw new Error("vLLM 응답이 비어 있습니다.");
  }

  if (config?.json_mode) {
    // ```json 블록 또는 순수 JSON 둘 다 허용
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|(^\s*[\[{][\s\S]*$)/m);
    if (jsonMatch) {
      return (jsonMatch[1] || jsonMatch[2] || content).trim();
    }
  }

  return content.trim();
};
