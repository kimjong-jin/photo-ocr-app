// /api/reverse-geocode.js  (Vercel serverless)
export default async function handler(req, res) {
  try {
    const { lat, lng } = req.query || {};
    if (!lat || !lng) return res.status(400).json({ error: 'missing coords' });

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret) {
      return res.status(500).json({
        error: 'server key not configured',
        hasId: !!id, hasSecret: !!secret, // 디버그용
      });
    }

    const url =
      `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc` +
      `?coords=${encodeURIComponent(`${lng},${lat}`)}` +
      `&output=json&orders=roadaddr&sourcecrs=epsg:4326`;

    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
    });

    const text = await r.text();

    // 디버그: Naver가 뭘 돌려주는지 그대로 반환
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return res.status(r.status).json({
      upstreamStatus: r.status,
      upstreamBody: json ?? text,
      // 참고 정보 (키는 절대 노출 안함)
      sent: { coords: `${lng},${lat}`, orders: 'roadaddr', sourcecrs: 'epsg:4326' },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
