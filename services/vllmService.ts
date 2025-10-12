const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
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
    messages: messages,
    stream: false,
  };

  if (config?.json_mode) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(`${VLLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data: VllmChatCompletionResponse = await response.json();
  const content = data.choices[0]?.message?.content || "";

  // The model might return markdown ```json ... ```. Strip it.
  if (config?.json_mode) {
      // FIX: JSON 배열 형식([])도 처리하도록 정규식 수정
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})|(\[[\s\S]*\])/s);
      if (jsonMatch) {
          // 캡처 그룹 1(마크다운), 2(객체), 3(배열) 중 하나를 반환
          return jsonMatch[1] || jsonMatch[2] || jsonMatch[3];
      }
  }

  return content;
};
