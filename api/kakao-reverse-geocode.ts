export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const { latitude, longitude, debug } = req.query as {
      latitude?: string | number;
      longitude?: string | number;
      debug?: string;
    };

    if (!latitude || !longitude) {
      res.status(400).json({ error: 'latitude, longitude가 필요합니다.' });
      return;
    }

    const apiKey = process.env.KAKAO_REST_API_KEY as string | undefined;
    if (!apiKey) {
      res.status(500).json({ error: 'API 키 없음' });
      return;
    }

    const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2address.json');
    url.searchParams.set('x', String(longitude));
    url.searchParams.set('y', String(latitude));
    url.searchParams.set('input_coord', 'WGS84'); // 명시

    let kakaoRes: Response;
    try {
      kakaoRes = await fetch(url.toString(), {
        headers: {
          Authorization: `KakaoAK ${apiKey}`,
          Accept: 'application/json',
        },
      });
    } catch (e: any) {
      // 네트워크/SSL 등 호출 자체 실패
      res.status(502).json({
        error: 'fetch_failed',
        message: String(e?.message || e),
        region: process.env.VERCEL_REGION || null,
        requestUrl: url.toString(),
      });
      return;
    }

    const rawText = await kakaoRes.text();

    // 🔎 필요할 때만 디버그(원본/상태/리전/키존재여부) 리턴
    if (debug === '1') {
      res.status(kakaoRes.status).json({
        passthroughStatus: kakaoRes.status,
        region: process.env.VERCEL_REGION || null,
        hasKey: !!apiKey,
        requestUrl: url.toString(),
        raw: rawText.slice(0, 4000), // 과한 길이 방지
      });
      return;
    }

    // 일반 모드: 원문 그대로 전달
    res.status(kakaoRes.status).send(rawText);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'unknown error' });
  }
}
