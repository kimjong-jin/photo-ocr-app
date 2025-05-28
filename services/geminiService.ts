// Fix: Replaced deprecated GenerateContentRequest with GenerateContentParameters
// Fix: Ensured correct import for GoogleGenAI
import { GoogleGenAI, GenerateContentResponse, Part, GenerateContentParameters } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("[geminiService] VITE_API_KEY environment variable is not set.");
    throw new Error(
      "Gemini API Key is not configured. Please set the VITE_API_KEY environment variable."
    );
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
    
    const imagePart: Part = {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    };

    const textPart: Part = {
      text: promptText,
    };

    const model = 'gemini-2.5-flash-preview-04-17';
    console.log("[geminiService] Calling Gemini API with model:", model, "MIME Type:", mimeType, "Config:", modelConfig);

    const response: GenerateContentResponse = await client.models.generateContent({
      model,
      contents: { parts: [textPart, imagePart] },
      config: modelConfig,
    });

    const extractedText = response.text;
    console.log("[geminiService] Raw response text from API:\n---\n", extractedText, "\n---");
    return extractedText;

  } catch (error: any) {
    console.error("[geminiService] Error calling Gemini API:", error);

    if (error.message?.includes("API Key not valid")) {
      throw new Error("Invalid Gemini API Key. Please check your VITE_API_KEY environment variable.");
    }
    if (error.message?.includes("Quota exceeded")) {
      throw new Error("Gemini API quota exceeded. Please check your usage limits.");
    }

    let errorMessage = "An unknown error occurred while communicating with the Gemini API.";
    if (error.message) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && error.toString) {
      errorMessage = error.toString();
    }

    throw new Error(errorMessage);
  }
};
