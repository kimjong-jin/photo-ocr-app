import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/load-temp — Mac Studio 임시불러오기 프록시 (구 Firebase/Firestore 이사) */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  const headers = { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' };
  try {
    let upstream: Response;
    if (req.method === 'POST') {
      upstream = await fetch(`${BASE}/api/load-temp`, { method: 'POST', headers, body: JSON.stringify(req.body) });
    } else {
      const q = new URLSearchParams(
        Object.entries(req.query as Record<string, string>).filter(([, v]) => v !== undefined) as [string, string][]
      ).toString();
      upstream = await fetch(`${BASE}/api/load-temp${q ? `?${q}` : ''}`, { method: 'GET', headers });
    }
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
