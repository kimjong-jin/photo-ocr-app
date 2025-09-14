export default async function handler(req: any, res: any) {
  try {
    const { latitude, longitude } = req.query as {
      latitude?: string | number;
      longitude?: string | number;
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

    const kakaoRes = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });

    const bodyText = await kakaoRes.text();
    res.status(kakaoRes.status).send(bodyText);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'unknown error' });
  }
}
