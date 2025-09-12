export default async function handler(req, res) {
  try {
    const { latitude, longitude } = req.query;
    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

    console.log("ENV ID:", NAVER_CLIENT_ID);
    console.log("ENV SECRET:", NAVER_CLIENT_SECRET ? "있음" : "없음");
    console.log("Query lat:", latitude, "lon:", longitude);

    const apiUrl = `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc?coords=${longitude},${latitude}&output=json&orders=roadaddr,addr`;

    const response = await fetch(apiUrl, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID!,
        "X-NCP-APIGW-API-KEY": NAVER_CLIENT_SECRET!,
      },
    });

    const raw = await response.text();
    console.log("Raw API response:", raw);

    if (!response.ok) {
      return res.status(response.status).json({ error: "Naver API error", raw });
    }

    return res.status(200).json(JSON.parse(raw));
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
