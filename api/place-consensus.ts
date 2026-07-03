import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/place-consensus — Mac Studio 지도 3소스(카카오+구글) 합의 역검색 프록시 */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  const query = String((req.query.query || req.query.q || '') as string);
  if (!query.trim()) return res.status(400).json({ error: 'query 필수' });
  try {
    const upstream = await fetch(`${BASE}/api/place-consensus?query=${encodeURIComponent(query)}`, {
      headers: { 'x-studio-secret': process.env.STUDIO_SECRET || '' },
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
