// geminiService.ts

import {
  GoogleGenAI,
  GenerateContentResponse,
  Part,
  GenerateContentParameters
} from "@google/genai";

let ai: GoogleGenAI | null = null;

// ✅ Vite에서는 반드시 import.meta.env 사용
const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] VITE_API_KEY 환경 변수가 설정되지 않았습니다.");
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
  modelConfig?: GenerateContentParameters["config"]
): Promise<string> => {
  try {
    const client = getGenAIClient();

    const imagePart: Part = {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    };

    const textPart: Part = { text: promptText };

    const model = "gemini-2.5-flash-preview-04-17";
    console.log("[geminiService] Calling Gemini API with:", { model, mimeType, modelConfig });

    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      contents: { parts: [textPart, imagePart] },
      config: modelConfig,
    });

    // ✅ 가장 안전한 텍스트 추출 방식
    const extractedText =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "[응답에서 텍스트를 추출할 수 없습니다]";

    console.log("[geminiService] Extracted Text:\n", extractedText);
    return extractedText;

  } catch (error: any) {
    console.error("[geminiService] Error calling Gemini API:", error);

    if (error.message?.includes("API Key not valid")) {
      throw new Error("Invalid Gemini API Key. Please check your VITE_API_KEY environment variable.");
    }

    if (error.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API quota exceeded. Please check your usage limits.");
    }

    const errorMessage = error?.message || error?.toString() || "An unknown error occurred while communicating with the Gemini API.";
    throw new Error(errorMessage);
  }
};
