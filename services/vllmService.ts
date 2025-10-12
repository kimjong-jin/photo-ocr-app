// vllmService.ts
const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY";
// ⚠️ 실제 서버의 '비전 지원' 모델로 맞춰라 (예: Qwen2-VL / LLaVA / InternVL 등)
const MODEL = "/root/.cache/huggingface/Qwen2-VL-7B-Instruct";

interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string | any[];
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

type TimeoutOpts = { totalMs?: number };
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & TimeoutOpts
) {
  const totalMs = init?.totalMs ?? 300000; // 5분
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("total-timeout"), totalMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

function hasImageInput(messages: VllmMessage[]) {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => (p as any)?.type === "image_url")
  );
}
function looksLikeTextOnlyModel(name: string) {
  const l = name.toLowerCase();
  // 간단한 휴리스틱(서버 모델명에 맞게 보정해도 됨)
  return !["-vl", "vision", "llava", "internvl", "phi-3-vision"].some((k) => l.includes(k));
}

export const callVllmApi = async (
  messages: VllmMessage[],
  config?: { json_mode?: boolean }
): Promise<string> => {
  // 이미지 들어왔는데 텍스트 전용 모델이면 즉시 에러
  if (hasImageInput(messages) && looksLikeTextOnlyModel(MODEL)) {
    throw new Error("vLLM 모델이 이미지 입력을 지원하지 않습니다. (비전 모델로 교체 필요)");
  }

  const payload: VllmPayload = {
    model: MODEL,
    messages,
    stream: false,
  };

  // ✅ JSON 강제 (OpenAI 호환 vLLM에서 지원하는 경우에 한해)
  if (config?.json_mode) {
    payload.response_format = { type: "json_object" };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${VLLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      totalMs: 300000,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("vLLM 요청 총 타임아웃(클라이언트에서 중단)");
    throw e;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data: VllmChatCompletionResponse = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  const content = normalizeVllmContent(raw) || "";

  // ✅ 모델이 마크다운/설명을 섞어도 JSON만 뽑아보기
  if (config?.json_mode) {
    // 우선 ```json ... ``` 블록
    let m = content.match(/```json\s*([\s\S]*?)\s*```/i);
    if (m?.[1]) return m[1].trim();

    // 그 다음 배열/객체 루트만 추출
    m = content.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (m?.[1]) return m[1].trim();
  }

  return content;
};
