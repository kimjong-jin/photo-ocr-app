import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request): Promise<Response> {
  try {
    const { prompt, config } = await req.json();

    if (!prompt || !config) {
      return new Response(
        JSON.stringify({ error: "Missing 'prompt' or 'config' in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const r = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config,
    });

    const resultText = (r as any).output_text || (r as any).text || "";

    if (!resultText.trim()) {
      return new Response(
        JSON.stringify({ error: "Empty response from Gemini model" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch (e) {
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

