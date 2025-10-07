import { GoogleGenAI } from "@google/genai";

export const config = {
  runtime: "nodejs",
  regions: ["icn1", "hkg1"], // ✅ 한국/홍콩 우선
  maxDuration: 30,
};

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();

  try {
    const bodyText = await req.text();
    const { prompt: encodedPrompt, config: userConfig } = JSON.parse(bodyText);

    if (!encodedPrompt || !userConfig) {
      return new Response(
        JSON.stringify({ error: "Missing 'prompt' or 'config' in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing GEMINI_API_KEY in environment" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = decodeURIComponent(escape(atob(encodedPrompt)));
    const ai = new GoogleGenAI({ apiKey });

    // ✅ Streaming 호출 (속도 개선)
    const stream = await ai.models.streamGenerateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: userConfig,
    });

    let resultText = "";
    for await (const chunk of stream.stream) {
      resultText += chunk.text();
    }

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
  } catch (err: any) {
    console.error("[api/gemini-analyze] Fatal Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unexpected server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
