// ✅ 환경에 따라 자동 전환되는 vLLM API 베이스 URL
// - 개발(localhost): Vite proxy 경유 (/genai → https://mobile.ktl.re.kr/genai/v1)
// - 운영(www.parser.work): vLLM 서버 직접 호출
const VLLM_BASE_URL =
  import.meta.env.MODE === "production"
    ? "https://mobile.ktl.re.kr/genai/v1" // 운영용 직접 경로
    : "/genai"; // 개발용 Vite proxy 경로

const API_KEY = "EMPTY"; // vLLM 서버 기본 설정
const MODEL = "/root/.cache/huggingface/Qwen72B-AWQ"; // 모델 경로

// ✅ vLLM 응답 타입 정의
interface VllmChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

// ✅ 멀티모달 콘텐츠 정의 (텍스트 + 이미지)
interface VllmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

// ✅ 메시지 구조 정의
export interface VllmMessage {
  role: "user";
  content: string | VllmContentPart[];
}

// ✅ 요청 Payload 정의
interface VllmPayload {
  model: string;
  messages: VllmMessage[];
  stream: boolean;
  response_format?: { type: "json_object" };
}

/**
 * ✅ vLLM API 호출 함수
 * @param messages - AI 입력 메시지
 * @param config - JSON 모드 등 추가 설정
 */
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

    // 응답 코드 확인
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `vLLM API Error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // ✅ JSON 파싱
    const data: VllmChatCompletionResponse = await response.json();
    const content = data.choices[0]?.message?.content || "";

    // ✅ 모델이 ```json ... ``` 형태로 응답할 때 정제
    if (config?.json_mode) {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/s);
      if (jsonMatch) {
        return jsonMatch[1] || jsonMatch[2];
      }
    }

    return content;
  } catch (error: any) {
    console.error("[vllmService] vLLM call failed:", error.message);
    throw new Error(error.message || "vLLM API 통신 중 알 수 없는 오류가 발생했습니다.");
  }
};
