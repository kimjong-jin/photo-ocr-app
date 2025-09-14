export default async function handler(req, res) {
  try {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      res.status(400).json({ error: "latitude, longitude가 필요합니다." });
      return;
    }

    const apiKey = process.env.KAKAO_REST_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "API 키 없음" });
      return;
    }

    const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${longitude}&y=${latitude}`;
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });

    const raw = await response.text();
    res.status(response.status).send(raw);
  } catch (err) {
    res.status(500).json({ error: err.message || "unknown error" });
  }
}
