import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/save-temp — Mac Studio 임시저장 프록시 (구 Firebase/Firestore 이사) */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  try {
    const upstream = await fetch(`${BASE}/api/save-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
