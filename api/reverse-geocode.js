// /api/reverse-geocode.js  (Vercel Serverless Function, CommonJS)
module.exports = async (req, res) => {
  try {
    const { lat, lng, debug } = req.query || {};
    if (!lat || !lng) return res.status(400).json({ error: 'missing coords' });

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;

    // 디버그: 환경변수 들어왔는지 즉시 확인
    if (debug === '1') {
      return res.status(200).json({ idSet: !!id, secretSet: !!secret, lat, lng });
    }
    if (!id || !secret) return res.status(500).json({ error: 'server key not configured' });

    const url =
      'https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc' +
      `?coords=${encodeURIComponent(`${lng},${lat}`)}` +
      `&output=json&orders=roadaddr&sourcecrs=epsg:4326`;

    const r = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
    });

    const text = await r.text();
    try {
      return res.status(r.status).json(JSON.parse(text));
    } catch {
      // 네이버에서 HTML/문자 오류가 올 때 원문 보여주기
      return res.status(502).json({ error: 'invalid upstream response', raw: text, status: r.status });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
};
