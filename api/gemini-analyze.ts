// src/api/gemini-analyze.ts
export const runtime = "edge"; // Edge에서도 안전하게 작동

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST")
      return new Response("Method Not Allowed", { status: 405 });

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string")
      return new Response(JSON.stringify({ error: "Invalid prompt" }), { status: 400 });

    // ✅ 로컬(Vite) + Vercel 환경 둘 다 대응
    const apiKey = process.env.GEMINI_API_KEY || import.meta?.env?.VITE_API_KEY;
    if (!apiKey)
      return new Response(JSON.stringify({ error: "Missing Gemini API Key" }), { status: 500 });

    // ✅ REST API 직접 호출 (SDK 제거)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini REST API Error:", data);
      throw new Error(data.error?.message || "Gemini REST API failed");
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text)
      return new Response(JSON.stringify({ error: "Empty Gemini response" }), { status: 500 });

    return new Response(JSON.stringify({ output: text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("❌ Gemini API Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Unknown server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
