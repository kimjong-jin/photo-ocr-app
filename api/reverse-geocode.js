// photo-ocr-app/api/reverse-geocode.js
export default async function handler(req, res) {
  try {
    const { lat, lng } = req.query || {};
    if (!lat || !lng) {
      res.status(400).json({ error: 'missing coords' });
      return;
    }

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret) {
      res.status(500).json({ error: 'server key not configured' });
      return;
    }

    const url =
      `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc` +
      `?coords=${encodeURIComponent(`${lng},${lat}`)}&output=json&orders=roadaddr`;

    const r = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
    });

    const text = await r.text();
    try {
      res.status(r.status).json(JSON.parse(text));
    } catch {
      res.status(502).json({ error: 'invalid upstream response', raw: text });
    }
  } catch (e) {
    res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
