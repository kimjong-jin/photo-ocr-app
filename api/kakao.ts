// api/kakao.ts

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  // ✅ 숨김 키 (Vercel Environment Variables)
  const KTL_KAKAO_API_KEY = process.env.KTL_KAKAO_API_KEY;

  // ✅ (선택) env로 빼두면 좋음. 없으면 기본값 사용
  const KTL_API_BASE_URL =
    process.env.KTL_API_BASE_URL || "https://mobile.ktl.re.kr/labview/api";
  const KTL_KAKAO_API_ENDPOINT =
    process.env.KTL_KAKAO_API_ENDPOINT || "/kakaotalkmsg";

  if (!KTL_KAKAO_API_KEY) {
    return res.status(500).json({ message: "KTL_KAKAO_API_KEY not configured" });
  }

  const { message, phoneNumbers, reservationTime } = (req.body || {}) as {
    message?: string;
    phoneNumbers?: string;
    reservationTime?: string;
  };

  if (!message || !phoneNumbers) {
    return res
      .status(400)
      .json({ message: "message and phoneNumbers are required" });
  }

  // KTL 서버가 요구하는 내부 포맷 유지
  const innerPayload = {
    APIKEY: KTL_KAKAO_API_KEY,
    MSG: message,
    PHONE: phoneNumbers,
    ...(reservationTime ? { RESERVETIME: reservationTime } : {}),
  };

  const payloadForJsonRequest = {
    LABVIEW_ITEM: JSON.stringify(innerPayload),
  };

  try {
    const upstream = await fetch(
      `${KTL_API_BASE_URL}${KTL_KAKAO_API_ENDPOINT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadForJsonRequest),
      }
    );

    const text = await upstream.text();

    // 응답이 JSON이 아닐 수도 있어서 안전 파싱
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ message: data?.message || "Upstream error", data });
    }

    return res.status(200).json({ message: data?.message || "OK", data });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Server error" });
  }
}
