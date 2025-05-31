import { GoogleGenAI, GenerateContentResponse, Part, GenerateContentParameters } from "@google/genai";
import { v4 as uuidv4 } from "uuid";

/** Singleton 형태로 클라이언트 생성 */
let ai: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] API 키가 설정되어 있지 않습니다.");
    throw new Error("Gemini API Key is not configured. Please set the VITE_API_KEY environment variable.");
  }

  if (!ai) {
    ai = new GoogleGenAI({ apiKey });
    console.log("[geminiService] GoogleGenAI client initialized.");
  }

  return ai;
};

/** 단일 이미지에서 텍스트 추출 */
export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
  modelConfig?: GenerateContentParameters['config']
): Promise<string> => {
  try {
    const client = getGenAIClient();

    const parts: Part[] = [
      { text: promptText },
      {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      },
    ];

    const response: GenerateContentResponse = await client.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: { parts },
      config: modelConfig,
    });

    const extractedText = response.text;
    console.log("[geminiService] 추출된 텍스트:\n", extractedText);
    return extractedText;

  } catch (error: any) {
    console.error("[geminiService] API 호출 중 오류 발생:", error);

    if (error.message?.includes("API Key not valid")) {
      throw new Error("❌ 잘못된 API 키입니다. 환경변수를 다시 확인하세요.");
    }
    if (error.message?.includes("Quota exceeded")) {
      throw new Error("🚫 Gemini API 사용량 초과입니다. 쿼터를 확인해주세요.");
    }

    throw new Error(error.message || "Gemini API 호출 중 알 수 없는 오류가 발생했습니다.");
  }
};

/** 복수 이미지에서 분석된 데이터를 파싱하여 JSON 배열로 추출 */
export const extractTextFromImagesWithGemini = async (
  images: { base64: string; mimeType: string }[],
  prompt: string,
  modelConfig?: GenerateContentParameters['config']
) => {
  const results = [];

  for (const [i, image] of images.entries()) {
    console.log(`📤 [${i + 1}/${images.length}] Gemini에 이미지 전송 중...`);
    const rawText = await extractTextFromImage(image.base64, image.mimeType, prompt, modelConfig);

    try {
      // 예상 포맷: ```json\n[ ... ]\n```
      const jsonTextMatch = rawText.match(/\[.*?\]/s);
      if (!jsonTextMatch) {
        throw new Error("JSON 포맷이 감지되지 않았습니다.");
      }

      const parsed = JSON.parse(jsonTextMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("JSON 결과가 배열 형태가 아닙니다.");
      }

      const entries = parsed.map((entry: any) => ({
        id: uuidv4(),
        ...entry,
      }));

      results.push(...entries);
    } catch (err) {
      console.error("[geminiService] Gemini 응답에서 JSON 파싱 실패:", err);
      throw new Error("Gemini 응답을 파싱할 수 없습니다. 응답 형식 또는 프롬프트를 확인하세요.");
    }
  }

  return results;
};
