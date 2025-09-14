export default async function handler(req, res) {
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
    return res.status(response.status).send(text);
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
