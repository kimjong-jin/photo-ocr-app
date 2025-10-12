import axios from "axios";

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

  try {
    const response = await axios.post<VllmChatCompletionResponse>(
        `${VLLM_BASE_URL}/chat/completions`,
        payload,
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            timeout: 300000, // 5분 타임아웃 설정
        }
    );

    const content = response.data.choices[0]?.message?.content || "";

    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})|(\[[\s\S]*\])/s);
      if (jsonMatch) {
          return jsonMatch[1] || jsonMatch[2] || jsonMatch[3];
      }
    }
    return content;

  } catch (error: any) {
    if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            throw new Error('vLLM API 요청 시간이 초과되었습니다. (5분)');
        }
        const errorText = error.response ? JSON.stringify(error.response.data) : error.message;
        throw new Error(`vLLM API Error: ${error.response?.status || ''} - ${errorText}`);
    }
    throw error;
  }
};
