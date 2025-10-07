// api/gemini-analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini API 호출을 처리하는 서버리스 함수
 * 브라우저에서는 직접 Gemini SDK를 쓸 수 없으므로
 * 이 경로를 통해 서버(Vercel)에서 대신 호출한다.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    // ✅ 환경변수 확인 (.env.local 또는 Vercel 환경 변수 설정)
    const apiKey = process.env.VITE_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is missing. Set VITE_API_KEY in your environment.");
    }

    // ✅ Gemini 클라이언트 초기화
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // ✅ 프롬프트 수신
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' field in request body." });
    }

    // ✅ Gemini 모델 호출
    const result = await model.generateContent([{ text: prompt }]);
    const output = result.response.text();

    if (!output) {
      throw new Error("Empty response received from Gemini API.");
    }

    // ✅ 정상 응답 반환
    res.status(200).json({ output });
  } catch (err: any) {
    console.error("[Gemini API Error]", err);
    res.status(500).json({
      error: err.message || "Gemini API call failed due to an unknown error.",
    });
  }
}
