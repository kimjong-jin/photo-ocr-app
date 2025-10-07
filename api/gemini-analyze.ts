import { GoogleGenAI } from "@google/genai";

// ✅ Node 런타임 고정 (Edge 환경에서 실행 시 오히려 느려짐)
export const config = { runtime: "nodejs" };

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();

  try {
    const { prompt, config } = await req.json();

    // ✅ 1. 요청 유효성 검사
    if (!prompt || !config) {
      return new Response(
        JSON.stringify({ error: "Missing 'prompt' or 'config' in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ 2. API 키 검증
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("❌ Missing GEMINI_API_KEY in environment");
      return new Response(
        JSON.stringify({ error: "Missing GEMINI_API_KEY in environment variables." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ 3. Gemini 인스턴스 생성
    const ai = new GoogleGenAI({ apiKey });

    // ✅ 4. 모델 호출
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash", // 🧠 고정: 정확도 + 속도 밸런스 최적
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config,
    });

    // ✅ 5. 응답 텍스트 추출 (모델별 포맷 차이 대응)
    const resultText =
      (r as any).output_text ||
      (r as any).text ||
      (r as any).output?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!resultText.trim()) {
      console.warn("⚠️ Gemini returned an empty response");
      return new Response(
        JSON.stringify({ error: "Empty response from Gemini model" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ 6. 결과 JSON 파싱 (실패 시 원본 로그 반환)
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

    // ✅ 7. 처리 시간 로깅
    const t1 = Date.now();
    console.log(`✅ Gemini request completed in ${(t1 - t0) / 1000}s`);

    // ✅ 8. 정상 응답 반환
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

// ✅ 환경 변수 로그 (개발 중 유효성 확인용)
console.log("🔍 GEMINI_API_KEY exists?", !!process.env.GEMINI_API_KEY);
