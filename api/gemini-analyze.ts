import { GoogleGenAI } from "@google/genai";
import LZString from "lz-string"; // ✅ prompt 압축 복호화용

// ✅ Node 런타임 고정 (Edge 환경에서 실행 시 오히려 느려짐)
export const config = { runtime: "nodejs" };

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now(); // 성능 측정용 타이머

  try {
    // ✅ 빠른 요청 파싱
    const bodyText = await req.text();
    const { prompt: encodedPrompt, config: userConfig } = JSON.parse(bodyText);

    if (!encodedPrompt || !userConfig) {
      return new Response(
        JSON.stringify({ error: "Missing 'prompt' or 'config' in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ API 키 확인
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("❌ Missing GEMINI_API_KEY in environment");
      return new Response(
        JSON.stringify({ error: "Missing GEMINI_API_KEY in environment variables." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ Prompt 복호화 (압축 해제)
    let prompt: string;
    try {
      prompt = LZString.decompressFromBase64(encodedPrompt) || "";
    } catch {
      console.error("❌ Failed to decompress prompt");
      return new Response(
        JSON.stringify({ error: "Invalid or corrupted compressed prompt" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!prompt.trim()) {
      return new Response(
        JSON.stringify({ error: "Empty or invalid prompt after decompression" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ Gemini 인스턴스 생성
    const ai = new GoogleGenAI({ apiKey });

    // ✅ 모델 호출 (시간 제한 래퍼)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15초 제한

    const r = await ai.models.generateContent(
      {
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: userConfig,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    // ✅ 다양한 포맷 대응
    const resultText =
      (r as any).output_text ||
      (r as any).text ||
      (r as any).output?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!resultText.trim()) {
      return new Response(
        JSON.stringify({ error: "Empty response from Gemini model", raw: r }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ 안전한 JSON 파싱
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

    const t1 = Date.now();
    console.log(`✅ Gemini request completed in ${(t1 - t0) / 1000}s`);

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

console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
