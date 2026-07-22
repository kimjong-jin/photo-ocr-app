import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

/**
 * /api/ktl-base — 현재 KTL 릴레이 터널(https) base URL 조회.
 *
 * KTL이 브라우저(Origin) 업로드를 CORS/403으로 막음(2026-07-22~, 네이티브/exe만 허용 추정).
 * 대용량 파일은 Vercel serverless(4.5MB)로 못 보내므로, Mac Studio(:3333)의 무제한 relay를
 * cloudflared https 터널로 노출해 브라우저가 직접 업로드한다. 터널 URL은 재시작 시 바뀔 수 있어
 * :3333이 현재 값을 알려주고(프론트가 이 함수로 조회, 서버사이드 http). 실패 시 base:'' → 프론트는
 * /api/ktl-relay(Vercel, CORS 우회는 되나 4.5MB 한도) 폴백.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const r = await axios.get('http://59.20.58.2:3333/ktl-relay-base', { timeout: 8000 });
    return res.status(200).json({ base: (r.data && r.data.base) || '' });
  } catch {
    return res.status(200).json({ base: '' });
  }
}
