export async function getKakaoAddress(latitude: number, longitude: number) {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });

  const text = await res.text();
  // 진단 로그 (필요 없으면 지워도 됨)
  console.log("[KAKAO] status:", res.status, "body:", text.slice(0, 200));

  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  const data = JSON.parse(text);

  const road = data?.documents?.[0]?.road_address?.address_name ?? "";
  const jibun = data?.documents?.[0]?.address?.address_name ?? "";

  if (road) {
    // 신주소 우선, 지번도 보조로 붙여 표시
    return jibun ? `${road} (${jibun})` : road;
  }
  if (jibun) return jibun;

  return "주소를 찾을 수 없습니다.";
}
