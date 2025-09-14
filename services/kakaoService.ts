export async function getKakaoAddress(latitude: number, longitude: number): Promise<string> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });

  const text = await res.text();
  console.log("[KAKAO] status:", res.status, "body:", text.slice(0, 200));

  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

  const data = JSON.parse(text);
  const doc = data?.documents?.[0];
  if (!doc) return "주소를 찾을 수 없습니다.";

  const roadAddr = doc.road_address?.address_name ?? "";
  const lotAddr = doc.address?.address_name ?? "";

  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? "");
  const region2 = addr?.region_2depth_name ?? "";
  const region3 = addr?.region_3depth_name ?? "";
  const lotNumber =
    addr?.main_address_no +
    (addr?.sub_address_no ? "-" + addr.sub_address_no : "");

  // 1️⃣ 도로명 주소 있으면 (앞의 축약형 제거 후 region1 붙이기)
  if (roadAddr) {
    const trimmedRoad = roadAddr.replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s*/, "");
    return `${region1} ${trimmedRoad}`.trim();
  }

  // 2️⃣ 도로명 없으면 지번 주소로 재검색
  if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      const trimmedRoad = searchedRoad.replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s*/, "");
      return `${region1} ${trimmedRoad}`.trim();
    }
    // 3️⃣ 실패 시 풀네임 조립
    return `${region1} ${region2} ${region3} ${lotNumber}`.trim();
  }

  return "주소를 찾을 수 없습니다.";
}
