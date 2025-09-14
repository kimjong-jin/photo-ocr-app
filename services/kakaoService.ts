export async function getKakaoAddress(latitude: number, longitude: number) {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) {
    throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");
  }

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text);

  const data = JSON.parse(text);

  return (
    data?.documents?.[0]?.road_address?.address_name ||
    data?.documents?.[0]?.address?.address_name ||
    "주소를 찾을 수 없습니다."
  );
}
