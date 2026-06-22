import type { VercelRequest, VercelResponse } from '@vercel/node';
const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';
const CALC_KEY = process.env.CALC_ADMIN_KEY || process.env.ADMIN_PASSWORD || '';

// 관리자용: 서버 세션 목록 조회 / 사용자 강제 로그아웃
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 관리자 재인증: x-admin-pass 가 관리자 키와 일치해야만 진행 (세션목록 공개 노출 방지)
  const pass = req.headers['x-admin-pass'];
  if (!CALC_KEY || pass !== CALC_KEY) {
    return res.status(401).json({ error: '관리자 인증 필요' });
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${MAC}/api/sessions`, {
        headers: { 'X-Calc-Key': CALC_KEY },
      });
      const d = await r.json().catch(() => []);
      return res.status(r.status).json(d);
    }

    if (req.method === 'DELETE') {
      const { userName } = req.body || {};
      if (!userName) return res.status(400).json({ error: 'userName 필수' });
      const r = await fetch(`${MAC}/api/sessions/user/${encodeURIComponent(userName)}`, {
        method: 'DELETE',
        headers: { 'X-Calc-Key': CALC_KEY },
      });
      const d = await r.json().catch(() => ({}));
      return res.status(r.status).json(d);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(502).json({ error: 'Mac Studio 서버 연결 실패' });
  }
}
