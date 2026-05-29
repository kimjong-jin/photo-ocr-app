import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * /api/locations  — Mac Studio 위치 서버 프록시
 * GET    /api/locations?userName=김종진       → 목록 조회
 * POST   /api/locations                        → 저장 (body에 userName 포함)
 * DELETE /api/locations?id=xxx&userName=김종진 → 삭제
 */

const BASE = (process.env.PHOTO_STORAGE_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');

async function forward(req: VercelRequest, res: VercelResponse) {
  if (!BASE) {
    return res.status(503).json({ error: 'PHOTO_STORAGE_URL 환경변수가 설정되지 않았습니다.' });
  }

  // id가 있으면 DELETE용 path param으로 처리, 나머지 쿼리는 모두 전달
  const { id, ...restQuery } = req.query as Record<string, string>;

  let targetPath = '/api/locations';
  if (id) targetPath = `/api/locations/${encodeURIComponent(id)}`;

  // 나머지 쿼리 파라미터 (userName 등) 를 그대로 붙여서 전달
  const queryStr = new URLSearchParams(
    Object.entries(restQuery).filter(([, v]) => v !== undefined) as [string, string][]
  ).toString();
  const url = `${BASE}${targetPath}${queryStr ? `?${queryStr}` : ''}`;

  const options: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    options.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url, options);
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e: any) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  return forward(req, res);
}
