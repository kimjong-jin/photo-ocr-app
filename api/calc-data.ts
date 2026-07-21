import type { VercelRequest, VercelResponse } from '@vercel/node';

/** /api/calc-data — 계산기 calc_data 프록시 (Mac Studio :3333 /api/calc)
 *  GET  ?receiptNo=...   → 접수번호 저장 데이터(있으면 {data:{tabs,fields,...}})
 *  POST { receiptNo, userName, siteName, data, ttlDays } → 업서트(덮어쓰기)
 *
 *  parser 전송(P2/P5) 시 우리 분석값을 계산기 저장소에 자동 반영하는 용도.
 *  계산 로직은 안 태우고 데이터만 저장 — 판정은 계산기/verdict API 단일 출처.
 */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수 미설정' });

  const q = req.query.receiptNo ? `?receiptNo=${encodeURIComponent(String(req.query.receiptNo))}` : '';
  const path = req.method === 'GET' ? `/api/calc${q}` : '/api/calc';

  try {
    const upstream = await fetch(`${BASE}${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
