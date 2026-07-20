import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/kakao-relay — 내부망 수분석 HTML이 카톡을 이리로 쏜다(정상 HTTPS 443, KTL과 동일 방식).
 * 여기서 Mac Studio(:3333) 릴레이로 넘기면 → (1)수분석 결과 DB 저장 (2)KTL로 전달(폰 발송).
 * 내부망은 parser.work만 닿으면 됨(비표준 포트 :3333 직결 불필요).
 *
 * body = { LABVIEW_ITEM: JSON.stringify({APIKEY, MSG, PHONE}) }  (내부망이 KTL에 보내던 그 형식 그대로)
 */
const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 내부망 브라우저(임의 origin)에서 직접 호출 → CORS 전면 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });
  if (!BASE) return res.status(503).json({ message: 'PHOTO_STORAGE_URL 미설정' });

  try {
    const upstream = await fetch(`${BASE}/api/kakao-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ message: 'Mac Studio 릴레이 연결 실패: ' + e.message });
  }
}
