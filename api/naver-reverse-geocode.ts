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
    return res.status(200).json(data);
  } catch (err: any) {
    console.error("Naver API proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
