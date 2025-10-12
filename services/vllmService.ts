// vllmService.ts
const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY";
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ";

interface VllmChatCompletionResponse {
  choices: { message: { content: string | any[] } }[];
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

// ---- 공통 대기/재시도 ----
const TOTAL_TIMEOUT_MS = 900_000; // 15분 (진짜 오래 대기)
const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 2_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithLongWait(input: RequestInfo | URL, init?: RequestInit) {
  // AbortController로 끊지 않음. (프록시 read-timeout만 안 넘으면 계속 대기)
  return fetch(input, {
    ...init,
    mode: "cors",
    cache: "no-store",
    keepalive: true,
    credentials: "omit",
  });
}

function normalizeVllmContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    try {
      return content
        .map((p: any) => (typeof p === "string" ? p : (p?.type === "text" ? p.text ?? "" : "")))
        .join("");
    } catch { return ""; }
  }
  return "";
}

export const callVllmApi = async (
  messages: VllmMessage[],
  config?: { json_mode?: boolean }
): Promise<string> => {
  const startedAt = Date.now();

  const payload: VllmPayload = {
    model: MODEL,
    messages,
    stream: false,
  };
  if (config?.json_mode) payload.response_format = { type: "json_object" };

  let attempt = 0;
  let lastErr: any;

  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithLongWait(`${VLLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`vLLM ${res.status} ${res.statusText} - ${t}`);
      }

      const data: VllmChatCompletionResponse = await res.json();
      const raw = data.choices?.[0]?.message?.content;
      const content = normalizeVllmContent(raw) || "";

      if (config?.json_mode) {
        const m = content.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*\]|\{[\s\S]*\})/s);
        if (m) return m[1] || m[2];
      }
      return content;
    } catch (err: any) {
      lastErr = err;

      // 총 대기 시간 가드 (서버가 오래 걸리는 케이스 고려)
      if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
        break;
      }

      // 네트워크/일시적 오류만 재시도 (TypeError/Fetch failed/게이트웨이 등)
      const msg = String(err?.message || err);
      const retryable =
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("fetch") ||
        msg.includes("timeout") ||
        msg.includes("504") ||
        msg.includes("502") ||
        msg.includes("temporarily") ||
        msg.includes("ECONN") ||
        msg.includes("EAI_AGAIN");

      if (!retryable || attempt === MAX_RETRIES) break;

      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
      attempt++;
    }
  }

  throw new Error(lastErr?.message || "vLLM 호출 실패");
};
