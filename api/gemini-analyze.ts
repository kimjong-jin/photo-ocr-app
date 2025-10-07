// src/api/gemini-analyze.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

// ✅ Edge 환경 아님! Node.js 환경에서 실행
export const config = {
  runtime: "nodejs", // Vercel은 자동으로 Serverless Function으로 처리
};

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Invalid prompt" }), { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY" }), { status: 500 });
    }

    // ✅ Gemini SDK 초기화
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // ✅ Gemini 호출
    const result = await model.generateContent([prompt]);
    const text = result.response?.text();

    if (!text) {
      return new Response(JSON.stringify({ error: "Empty Gemini response" }), { status: 500 });
    }

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
