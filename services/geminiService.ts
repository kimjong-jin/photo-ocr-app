import { GoogleGenAI, GenerateContentResponse, Part, GenerateContentParameters } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY; // ✅ Vite 기준 수정
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
