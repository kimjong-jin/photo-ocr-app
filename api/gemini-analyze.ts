import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request): Promise<Response> {
  try {
    const { prompt, config } = await req.json();

    if (!prompt || !config) {
      return new Response(
        JSON.stringify({
          error: "Missing 'prompt' or 'config' in request body",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "Missing GEMINI_API_KEY in environment variables.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ Gemini 인스턴스 초기화
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config,
    });

    // ✅ 다양한 필드에서 결과 추출 (모델별 차이 대응)
    const resultText =
      (r as any).output_text ||
      (r as any).text ||
      (r as any).output?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!resultText.trim()) {
      console.warn("⚠️ Gemini returned an empty result");
      return new Response(
        JSON.stringify({
          error: "Empty response from Gemini model",
          raw: r,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ 안전한 JSON 파싱 (잘못된 형식 처리)
    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch (err) {
      console.error("❌ JSON parsing failed. Raw text:", resultText);
      return new Response(
        JSON.stringify({
          error: "Invalid JSON from Gemini model",
          raw: resultText,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[api/gemini-analyze] Fatal Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Unexpected server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// 실행 환경 점검 로그
console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
