// /api/reverse-geocode.cjs  (CommonJS + Node.js 20 런타임 강제)
exports.config = { runtime: 'nodejs20.x' };

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { lat, lng, debug } = req.query || {};
    if (lat == null || lng == null) return res.status(400).json({ error: 'missing coords' });

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

    if (debug === '1') {
      return res.status(200).json({
        idSet: !!id,
        secretSet: !!secret,
        lat: latNum,
        lng: lngNum,
        runtime: process.version,
      });
    }
    if (!id || !secret) return res.status(500).json({ error: 'server key not configured' });

    const params = new URLSearchParams({
      coords: `${encodeURIComponent(lng)},${encodeURIComponent(lat)}`,
      output: 'json',
      orders: 'roadaddr', // 필요시 roadaddr,addr
      sourcecrs: 'epsg:4326',
    }).toString().replace('%2C', ',');

    const url = `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc?${params}`;

    // 타임아웃 5초
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);

    const r = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': id,
        'X-NCP-APIGW-API-KEY': secret,
      },
      signal: ac.signal,
    }).catch((e) => {
      if (e.name === 'AbortError') throw new Error('upstream timeout');
      throw e;
    });
    clearTimeout(t);

    const text = await r.text();
    try {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(r.status).json(JSON.parse(text));
    } catch {
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
};
