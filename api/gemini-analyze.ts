import { GoogleGenAI } from "@google/genai";

// Node 런타임 고정
export const config = { runtime: "nodejs" };

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();

  try {
    // 안전 파싱
    const raw = await req.text();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body", raw }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt: string = body?.prompt;
    const userConfig: Record<string, any> = body?.config;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'prompt' (string)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!userConfig || typeof userConfig !== "object") {
      return new Response(JSON.stringify({ error: "Missing 'config' (object)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing GEMINI_API_KEY in environment" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // 15초 타임아웃
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let resultText = "";
    try {
      const r = await ai.models.generateContent(
        {
          model: "gemini-2.5-flash", // 정확도/속도 밸런스
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: userConfig,
        },
        { signal: controller.signal }
      );

      resultText =
        (r as any).output_text ||
        (r as any).text ||
        (r as any).output?.[0]?.content?.parts?.[0]?.text ||
        "";
    } finally {
      clearTimeout(timeout);
    }

    if (!resultText || !resultText.trim()) {
      return new Response(JSON.stringify({ error: "Empty response from Gemini" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 모델이 JSON 아닌 텍스트를 줄 수도 있으니 파싱 시도
    let parsed: any;
    try {
      parsed = JSON.parse(resultText);
    } catch (e) {
      // 파싱 실패시 원문 그대로 반환(클라에서 처리)
      return new Response(
        JSON.stringify({ error: "Invalid JSON from model", raw: resultText }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const t1 = Date.now();
    console.log(`✅ Gemini request completed in ${(t1 - t0) / 1000}s`);

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[api/gemini-analyze] Fatal Error:", err?.stack || err);
    const msg =
      err?.name === "AbortError"
        ? "Request timeout (15s)"
        : err?.message || "Unexpected server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
