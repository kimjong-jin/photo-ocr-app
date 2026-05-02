// api/gemini-ocr.ts
// ✅ Vercel Serverless Function - Gemini API 키는 서버에서만 사용
// 클라이언트(브라우저)에는 키가 절대 노출되지 않습니다.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? '*';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ✅ API 키는 서버 환경변수에서만 읽음 (클라이언트에 노출 없음)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[gemini-ocr] GEMINI_API_KEY 환경변수 미설정');
    return res.status(500).json({ error: 'Server configuration error: API key missing.' });
  }

  try {
    const { imageBase64, mimeType, promptText, modelConfig } = req.body as {
      imageBase64: string;
      mimeType: string;
      promptText: string;
      modelConfig?: Record<string, unknown>;
    };

    if (!imageBase64 || !mimeType || !promptText) {
      return res.status(400).json({ error: 'imageBase64, mimeType, promptText are required.' });
    }

    // Gemini API 직접 호출 (서버 사이드)
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash-preview-04-17',
      contents: {
        parts: [
          { text: promptText },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
      config: modelConfig ?? {},
    });

    return res.status(200).json({ text: response.text });
  } catch (e: any) {
    console.error('[gemini-ocr] 오류:', e?.message);
    return res.status(500).json({ error: e?.message || 'Gemini API 호출 중 오류 발생' });
  }
}
