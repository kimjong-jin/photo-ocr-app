const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY";
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ";

interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string | any[]; // 문자열/멀티모달 배열 모두 대비
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

/** 총 타임아웃 가드(기본 5분) */
type TimeoutOpts = { totalMs?: number };
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit & TimeoutOpts) {
  const totalMs = init?.totalMs ?? 300000; // 5분
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("total-timeout"), totalMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** (옵션) content가 배열로 올 때 텍스트만 안전 추출 */
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
  };

  if (config?.json_mode) {
    payload.response_format = { type: "json_object" };
  }

  // 🔒 타임아웃 가드 적용
  const response = await fetchWithTimeout(`${VLLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
    totalMs: 300000, // 필요 시 조정
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data: VllmChatCompletionResponse = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  const content = normalizeVllmContent(raw) || "";

  // JSON 모드일 때 ```json ... ``` 감싸기 제거
  if (config?.json_mode) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/s);
    if (jsonMatch) {
      return jsonMatch[1] || jsonMatch[2];
    }
  }

  return content;
};
