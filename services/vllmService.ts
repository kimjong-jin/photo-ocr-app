import axios from "axios";

const VLLM_BASE_URL = "https://mobile.ktl.re.kr/genai/v1";
const API_KEY = "EMPTY";
const MODEL = "/root/.cache/huggingface/qwen3vl-30b";

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
      // First, try to find a markdown-style JSON block, which is often cleaner.
      const markdownMatch = content.match(/```json\n([\s\S]*?)\n```/s);
      if (markdownMatch && markdownMatch[1]) {
          try {
              JSON.parse(markdownMatch[1].trim());
              return markdownMatch[1].trim();
          } catch (e) {
              // Fall through if parsing the markdown block fails
              console.warn("vllmService: Markdown JSON block found but failed to parse, falling back to substring search.", e);
          }
      }

      // Fallback for raw JSON possibly surrounded by other text
      const firstBracket = content.indexOf('[');
      const firstBrace = content.indexOf('{');
      
      let startIndex = -1;
      
      if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          startIndex = firstBracket;
      } else if (firstBrace !== -1) {
          startIndex = firstBrace;
      }

      if (startIndex === -1) {
          throw new Error("vLLM 응답에서 JSON 시작(`[` 또는 `{`)을 찾지 못했습니다. 원본 응답: " + content);
      }
      
      const opener = content[startIndex];
      const closer = opener === '[' ? ']' : '}';
      let openCount = 0;
      let endIndex = -1;

      for (let i = startIndex; i < content.length; i++) {
        if (content[i] === opener) {
            openCount++;
        } else if (content[i] === closer) {
            openCount--;
        }
        
        if (openCount === 0) {
            endIndex = i;
            break;
        }
      }

      if (endIndex !== -1) {
          const jsonStr = content.substring(startIndex, endIndex + 1);
          try {
              JSON.parse(jsonStr); // Validate that it's actually parsable
              return jsonStr;
          } catch (e) {
              throw new Error(`vLLM 응답에서 추출된 문자열이 유효한 JSON이 아닙니다. 추출된 문자열: ${jsonStr}`);
          }
      }

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
