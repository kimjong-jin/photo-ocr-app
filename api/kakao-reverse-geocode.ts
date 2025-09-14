export default async function handler(req, res) {
  try {
    const { latitude, longitude } = req.query;
    const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "latitude, longitude가 필요합니다." });
    }
    if (!KAKAO_REST_API_KEY) {
      return res.status(500).json({ error: "KAKAO_REST_API_KEY가 설정되지 않았습니다." });
    }

    const apiUrl = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${longitude}&y=${latitude}`;

    const response = await fetch(apiUrl, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: "Kakao API error", data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
