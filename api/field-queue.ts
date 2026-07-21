import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/field-queue — 현장계수 수분석 큐 프록시 (Mac Studio :3333 field_queue)
 *  GET  ?week=...            → 주간 목록
 *  POST                      → 현장값 저장/업서트
 *  POST ?op=lab              → 실험실값·판정 채움
 *  POST ?op=status           → 상태 변경(개별/일괄)
 *  DELETE                    → 삭제/정리
 */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  const op = String(req.query.op || '');
  const week = req.query.week ? `?week=${encodeURIComponent(String(req.query.week))}` : '';
  let path = '/api/field-queue';
  if (req.method === 'GET') path += week;
  else if (req.method === 'POST' && op === 'lab') path += '/lab';
  else if (req.method === 'POST' && op === 'std') path += '/std';
  else if (req.method === 'POST' && op === 'status') path += '/status';

  try {
    const upstream = await fetch(`${BASE}${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {}),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
