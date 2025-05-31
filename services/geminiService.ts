import {
  GoogleGenAI,
  GenerateContentResponse,
  Part,
  GenerateContentParameters
} from "@google/genai";

// 내부 캐싱된 Gemini 클라이언트 인스턴스
let ai: GoogleGenAI | null = null;

/**
 * Gemini API 클라이언트를 초기화 및 반환
 */
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

/**
 * 단일 이미지에서 텍스트 추출
 */
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

/**
 * 여러 이미지에서 텍스트 일괄 추출 및 JSON 결과 반환
 */
export const extractTextFromImagesWithGemini = async (
  images: { base64: string; name: string; mimeType: string }[],
  selectedItem: string,
  receiptInfo: { receiptNumber: string; siteName: string; testItem: string },
  stampImageDataUrl: string | null,
  siteName: string
): Promise<
  {
    id: string;
    time: string;
    value?: string;
    valueTP?: string;
  }[]
> => {
  const prompt = `
아래 이미지는 ${receiptInfo.siteName}의 측정기 사진입니다.
${selectedItem} 항목이며, 이미지에서 시간과 ${selectedItem === 'TN/TP' ? 'TN 및 TP 값' : '값'}을 추출해주세요.
- 시간은 00:00 형식 문자열로 추출
- 값은 숫자로 추출
- 결과는 JSON 배열 형식으로 추출
예: [{"time": "10:00", "value": "12.3"}, {"time": "10:30", "value": "14.1"}]
`;

  const allResults = [];

  for (const image of images) {
    try {
      const text = await extractTextFromImage(image.base64, image.mimeType, prompt);

      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start !== -1 && end !== -1) {
        const jsonString = text.substring(start, end + 1);
        const parsed = JSON.parse(jsonString);
        const withId = parsed.map((e: any) => ({
          id: crypto.randomUUID(),
          ...e,
        }));
        allResults.push(...withId);
      } else {
        console.warn("Gemini 응답에서 JSON 파싱 실패:\n", text);
      }
    } catch (err) {
      console.error("이미지 분석 중 오류 발생:", err);
    }
  }

  return allResults;
};
