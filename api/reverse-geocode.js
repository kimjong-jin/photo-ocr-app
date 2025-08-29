// /api/reverse-geocode.js  (Vercel serverless)
export default async function handler(req, res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const { lat, lng } = req.query || {};
    if (!lat || !lng) return res.status(400).json({ error:'missing coords' });

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret) return res.status(500).json({ error:'server key not configured' });

    const url =
      'https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc'
      + `?coords=${encodeURIComponent(`${lng},${lat}`)}&output=json&orders=roadaddr&sourcecrs=epsg:4326`;

    const r = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
    });

    const text = await r.text();
    try { return res.status(r.status).json(JSON.parse(text)); }
    catch { return res.status(502).json({ error:'invalid upstream response', raw:text }); }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
