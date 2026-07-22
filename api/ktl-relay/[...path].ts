import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios, { AxiosRequestConfig } from 'axios';

/**
 * /api/ktl-relay/* — KTL(mobile.ktl.re.kr) 서버 사이드 중계 (폴백용).
 *
 * KTL이 브라우저(Origin) 업로드를 CORS/403으로 막음(2026-07-22~). 브라우저는 Origin 헤더를 JS로 못 지움
 * → 서버 경유만 통과. 이 함수(서버→서버)는 Origin을 안 실어 보내 KTL 차단을 통과하고, 응답엔 CORS 허용
 * 헤더를 붙여 브라우저가 받게 한다.
 *
 * ⚠️ 메인 경로는 :3333 무제한 터널(api/ktl-base). 이 Vercel 함수는 터널 조회 실패 시 폴백(본문 ~4.5MB 한도).
 *    Claydox 전송 로직은 안 건드림 — 출구 URL만 이 프록시로.
 */
export const config = { api: { bodyParser: false } };

const KTL_BASE = 'https://mobile.ktl.re.kr/labview/api';

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', (req.headers.origin as string) || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 서브경로: req.url 우선(캐치올 query 미채움 대비), 폴백 query.path.
  let sub = '';
  const rawUrl = (req.url || '').split('?')[0];
  const m = rawUrl.match(/\/api\/ktl-relay\/(.+)$/);
  if (m) sub = m[1];
  if (!sub) {
    const parts = req.query.path;
    sub = Array.isArray(parts) ? parts.join('/') : String(parts || '');
  }
  sub = sub.replace(/^\/+/, '');
  if (!sub) return res.status(400).json({ error: 'KTL path required' });

  const method = (req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  try {
    const body = hasBody ? await readRawBody(req) : undefined;
    const cfg: AxiosRequestConfig = {
      method: method as any,
      url: `${KTL_BASE}/${sub}`,
      data: body,
      headers: {
        ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] as string } : {}),
        ...(req.headers['accept'] ? { Accept: req.headers['accept'] as string } : {}),
      },
      timeout: 300000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    };
    const ktlRes = await axios(cfg);
    res.status(ktlRes.status);
    const ct = ktlRes.headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct as string);
    return res.send(Buffer.from(ktlRes.data));
  } catch (err: any) {
    return res.status(err?.response?.status || 502).json({ error: err?.message || 'KTL relay error' });
  }
}
