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
      // AI 응답에 JSON 외 텍스트가 포함된 경우를 대비한 파싱 로직 강화
      const firstBracket = content.indexOf('[');
      const firstBrace = content.indexOf('{');

      let jsonStartIndex = -1;

      // '[' 또는 '{' 가 처음 나타나는 위치를 찾음
      if (firstBracket !== -1 && firstBrace !== -1) {
        jsonStartIndex = Math.min(firstBracket, firstBrace);
      } else if (firstBracket !== -1) {
        jsonStartIndex = firstBracket;
      } else {
        jsonStartIndex = firstBrace;
      }

      // JSON 시작 부분을 찾았다면, 그 부분부터 문자열을 잘라 반환
      if (jsonStartIndex !== -1) {
        return content.substring(jsonStartIndex);
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
