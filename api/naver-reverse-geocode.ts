import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchNaverReverseGeocode } from "../services/naverService";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { latitude, longitude } = req.query;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Missing latitude or longitude" });
  }

  const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(500).json({ error: "Naver API credentials missing" });
  }

  try {
    const data = await fetchNaverReverseGeocode(
      latitude as string,
      longitude as string,
      NAVER_CLIENT_ID,
      NAVER_CLIENT_SECRET
    );

    if (data.status?.code === 0 && data.results?.length > 0) {
      const result = data.results[0];
      const region = result.region;
      const land = result.land;

      let address = "";
      if (result.name === "roadaddr") {
        address = [
          region.area1.name,
          region.area2.name,
          land.name,
          land.number1,
          land.addition0?.value,
        ]
          .filter(Boolean)
          .join(" ");
      } else {
        address = [
          region.area1.name,
          region.area2.name,
          region.area3.name,
          land.number1,
          land.addition0?.value,
        ]
          .filter(Boolean)
          .join(" ");
      }

      return res.status(200).json({ address });
    }

    return res
      .status(404)
      .json({ error: "주소를 찾을 수 없습니다.", details: data });
  } catch (err: any) {
    console.error("Naver API proxy error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
