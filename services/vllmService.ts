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
      // AI 응답에서 JSON 블록만 정확히 추출하는 정규식
      // 1. ```json ... ``` 블록, 2. {...} 객체, 3. [...] 배열 순서로 찾음
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})|(\[[\s\S]*\])/s);
      
      // 첫 번째로 매칭된 유효한 JSON 문자열을 반환
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[2] || jsonMatch[3] || '').trim() : '';

      if (jsonStr) {
        return jsonStr;
      }
      // json_mode인데도 유효한 JSON을 못 찾았다면 오류 발생
      throw new Error("vLLM 응답에서 유효한 JSON 블록을 찾지 못했습니다. 원본 응답: " + content);
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
