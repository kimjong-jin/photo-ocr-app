import { GoogleGenAI } from "@google/genai";

export const config = { runtime: "nodejs" }; // ✅ Edge 환경에서 느림 방지

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  try {
    const { prompt, config } = await req.json();

    if (!prompt || !config) {
      return new Response(JSON.stringify({ error: "Missing 'prompt' or 'config'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // ⚡ 속도 최적화 모델로 교체해볼 수 있음
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config,
    });

    const resultText =
      (r as any).output_text ||
      (r as any).text ||
      (r as any).output?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!resultText.trim()) {
      return new Response(JSON.stringify({ error: "Empty response from Gemini" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON", raw: resultText }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const t1 = Date.now();
    console.log(`✅ Gemini request completed in ${(t1 - t0) / 1000}s`);

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[api/gemini-analyze] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
