// Fix: Replaced deprecated GenerateContentRequest with GenerateContentParameters
// Fix: Ensured correct import for GoogleGenAI
import { GoogleGenAI, GenerateContentResponse, Part, GenerateContentParameters } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getGenAIClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("API_KEY environment variable is not set.");
    throw new Error(
      "Gemini API Key is not configured. Please set the API_KEY environment variable."
    );
  }
  if (!ai) {
    // Fix: Use named apiKey parameter as per guidelines
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
};

export const extractTextFromImage = async (
  imageBase64: string,
  mimeType: string,
  promptText: string,
// Fix: Updated type hint to use GenerateContentParameters['config']
  modelConfig?: GenerateContentParameters['config'] 
): Promise<string> => {
  try {
    const client = getGenAIClient();
    
    const imagePart: Part = {
      inlineData: {
        mimeType: mimeType,
        data: imageBase64,
      },
    };

    const textPart: Part = {
      text: promptText,
    };

    // Fix: Use recommended model 'gemini-2.5-flash-preview-04-17'
    const model = 'gemini-2.5-flash-preview-04-17'; 

    // Fix: Use client.models.generateContent as per guidelines
    const response: GenerateContentResponse = await client.models.generateContent({
      model: model,
      contents: { parts: [textPart, imagePart] }, 
      config: modelConfig, // Pass modelConfig to the API call
    });
    
    // Fix: Use response.text to extract text as per guidelines
    const extractedText = response.text;
    return extractedText;

  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    if (error.message && error.message.includes("API Key not valid")) {
        throw new Error("Invalid Gemini API Key. Please check your API_KEY environment variable.");
    }
    if (error.message && error.message.includes("Quota exceeded")) {
        throw new Error("Gemini API quota exceeded. Please check your usage limits.");
    }
    throw new Error(error.message || "An unknown error occurred while communicating with the Gemini API.");
  }
};
