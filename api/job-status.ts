import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/job-status  — Mac Studio 작업 상태 서버 프록시
 *
 * 환경변수: LOCATION_SERVER_URL=https://xxxx.trycloudflare.com
 *
 * GET    /api/job-status?user_name=xxx     → 전체 조회
 * POST   /api/job-status                   → 저장/수정
 * DELETE /api/job-status?receiptNo=xxx     → 삭제
 */

const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!BASE) {
    return res.status(503).json({ error: 'LOCATION_SERVER_URL 환경변수가 설정되지 않았습니다.' });
  }

  try {
    let url: string;
    const options: RequestInit = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (req.method === 'DELETE') {
      const { receiptNo } = req.query;
      if (!receiptNo) return res.status(400).json({ error: 'receiptNo 필수' });
      url = `${BASE}/api/job-status/${encodeURIComponent(receiptNo as string)}`;
    } else if (req.method === 'GET') {
      const { user_name } = req.query;
      url = user_name
        ? `${BASE}/api/job-status?user_name=${encodeURIComponent(user_name as string)}`
        : `${BASE}/api/job-status`;
    } else {
      url = `${BASE}/api/job-status`;
      options.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, options);
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
