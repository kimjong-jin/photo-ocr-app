import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id required' });
  }
  try {
    const response = await axios.get(
      `https://mobile.ktl.re.kr/labview/api/limsclient/${encodeURIComponent(id)}`,
      { timeout: 10000, headers: { 'Accept': 'application/json' } }
    );
    return res.status(200).json(response.data);
  } catch (err: any) {
    const status = err?.response?.status || 502;
    return res.status(status).json({ error: err.message });
  }
}
