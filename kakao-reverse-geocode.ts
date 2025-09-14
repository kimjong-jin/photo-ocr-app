export default async function handler(req, res) {
  try {
    const { latitude, longitude } = req.query;
    const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

    console.log("ENV KAKAO KEY:", KAKAO_REST_API_KEY ? "있음" : "없음");
    console.log("Query lat:", latitude, "lon:", longitude);

    const apiUrl = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${longitude}&y=${latitude}`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
      },
    });

    const raw = await response.text();
    console.log("Raw API response:", raw);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Kakao API error", raw });
    }

    return res.status(200).json(JSON.parse(raw));
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
