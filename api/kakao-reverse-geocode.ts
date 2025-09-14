export default async function handler(req: any, res: any) {
  try {
    const { latitude, longitude } = req.query;
    const apiKey = process.env.KAKAO_REST_API_KEY;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "latitude, longitude가 필요합니다." });
    }
    if (!apiKey) {
      return res.status(500).json({ error: "API 키 없음" });
    }

    const apiUrl = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${longitude}&y=${latitude}`;

    const response = await fetch(apiUrl, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });

    const text = await response.text();

    // 👉 일단 가공하지 말고 raw 반환 (문제 추적)
    return res.status(response.status).send(text);
  } catch (err: any) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
