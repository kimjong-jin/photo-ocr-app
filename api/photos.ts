// api/photos.ts
// Vercel → 맥스튜디오 사진 서버 프록시 (axios 방식)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import FormData from 'form-data';

const PHOTO_STORAGE_URL = process.env.PHOTO_STORAGE_URL || 'http://59.20.58.2:3333';

const ALLOWED_ORIGINS = [
  'https://parser.work',
  'https://www.parser.work',
  'http://localhost:5173',
];

export const config = {
  api: { bodyParser: false }, // raw body 접근을 위해 비활성화
};

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers['origin'] as string) ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

async function bufferBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const pathSegments = (req.query.path as string[] | string | undefined);
  const path = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments ?? '');
  let targetUrl = `${PHOTO_STORAGE_URL}/api/photos${path ? `/${path}` : ''}`;

  // path 외 추가 쿼리 파라미터 전달 (예: pageCode=P1)
  const extraParams = Object.entries(req.query)
    .filter(([key]) => key !== 'path')
    .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
    .join('&');
  if (extraParams) targetUrl += `?${extraParams}`;

  try {
    if (req.method === 'GET') {
      const response = await axios.get(targetUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'x-studio-secret': process.env.STUDIO_SECRET || '' },
      });
      const contentType = response.headers['content-type'] ?? 'application/json';
      res.setHeader('Content-Type', contentType);
      if (contentType.startsWith('image/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
      return res.status(response.status).send(Buffer.from(response.data));

    } else if (req.method === 'POST') {
      const rawBody = await bufferBody(req);
      const contentType = req.headers['content-type'] ?? '';

      const response = await axios.post(targetUrl, rawBody, {
        headers: {
          'content-type': contentType,
          'content-length': rawBody.length,
          'x-studio-secret': process.env.STUDIO_SECRET || '',
        },
        timeout: 30000,
        maxBodyLength: 50 * 1024 * 1024,
      });
      return res.status(response.status).json(response.data);

    } else if (req.method === 'DELETE') {
      const response = await axios.delete(targetUrl, { timeout: 10000, headers: { 'x-studio-secret': process.env.STUDIO_SECRET || '' } });
      return res.status(response.status).json(response.data);
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (e: any) {
    const status = e.response?.status ?? 500;
    const message = e.response?.data?.error ?? e.message ?? '알 수 없는 오류';
    if (e.code === 'ECONNREFUSED' || e.code === 'ECONNABORTED' || e.message?.includes('connect')) {
      return res.status(503).json({ error: '맥스튜디오 서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.' });
    }
    console.error('[photos proxy] 오류:', message);
    return res.status(status).json({ error: message });
  }
}
