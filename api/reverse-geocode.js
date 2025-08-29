// api/reverse-geocode.js
export const config = { runtime: 'nodejs20.x' };

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { lat, lng, debug } = req.query || {};
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'missing coords' });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'coords must be numbers' });
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: 'coords out of range' });
    }

    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;

    // 디버그: 키 세팅/런타임 확인
    if (debug === '1') {
      return res.status(200).json({
        idSet: !!id,
        secretSet: !!secret,
        lat: latNum,
        lng: lngNum,
        runtime: process.version
      });
    }

    if (!id || !secret) {
      return res.status(500).json({ error: 'server key not configured' });
    }

    // 네이버 역지오코딩 요청
    const params = new URLSearchParams({
      coords: `${encodeURIComponent(String(lngNum))},${encodeURIComponent(String(latNum))}`,
      output: 'json',
      orders: 'roadaddr',          // 필요 시 'roadaddr,addr,admcode'
      sourcecrs: 'epsg:4326',
    }).toString().replace('%2C', ','); // 콤마 복원(선택)

    const url = `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc?${params}`;

    // 5초 타임아웃
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);

    const r = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
      signal: ac.signal,
    }).catch((e) => {
      if (e?.name === 'AbortError') throw new Error('upstream timeout');
      throw e;
    });

    clearTimeout(timer);

    const text = await r.text();

    // JSON이면 그대로 전달
    try {
      const json = JSON.parse(text);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(r.status).json(json);
    } catch {
      // JSON이 아니면 원문/헤더와 함께 에러 전달
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({
        error: 'invalid upstream response',
        status: r.status,
        contentType: r.headers.get('content-type') || null,
        raw: text?.slice(0, 2000) ?? null,
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
