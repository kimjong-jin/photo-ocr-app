import type { VercelRequest, VercelResponse } from '@vercel/node';
const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 실제 사용자의 IP와 User-Agent를 헤더로 전달
  const realIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket?.remoteAddress || '';
  const realUa = (req.headers['user-agent'] as string) || '';

  // POST → ping (heartbeat), DELETE → logout/kill
  let targetUrl = `${MAC}/api/sessions/ping`;
  let method = req.method!;

  if (req.method === 'DELETE') {
    const body = req.body || {};
    if (body.sessionId) {
      targetUrl = `${MAC}/api/sessions/${encodeURIComponent(body.sessionId)}`;
    } else {
      targetUrl = `${MAC}/api/sessions/logout`;
    }
  }

  try {
    const r = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-studio-secret': process.env.STUDIO_SECRET || '',  // :3333 requireProxyOrLocal 통과용
        'X-Real-IP': realIp,              // 실제 사용자 IP 전달
        'X-Real-UA': realUa,              // 실제 사용자 UA 전달
        'X-Forwarded-For': realIp,
      },
      body: method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    return res.status(r.status).json(d);
  } catch {
    return res.status(200).json({ ok: true, forceLogout: false });
  }
}
