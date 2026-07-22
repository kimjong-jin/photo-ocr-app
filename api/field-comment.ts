import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/field-comment — 현장계수 수분석 메모(base 접수번호 단위) 프록시 (Mac Studio :3333)
 *  GET  ?receipt_no=...  → 메모 조회
 *  POST { receipt_no, comment, ... } → 저장(빈값이면 삭제)
 */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  const q = req.query.receipt_no ? `?receipt_no=${encodeURIComponent(String(req.query.receipt_no))}` : '';
  try {
    const upstream = await fetch(`${BASE}/api/field-comment${req.method === 'GET' ? q : ''}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {}),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: e?.message || 'field-comment proxy error' });
  }
}
