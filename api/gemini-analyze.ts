import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request): Promise<Response> {
  const { prompt, config } = await req.json();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const r = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: prompt }] }], config });
  return new Response(r.output_text, { headers: { "Content-Type": "application/json" } });
}
