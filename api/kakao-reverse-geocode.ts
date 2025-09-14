export async function getKakaoAddress(latitude: number, longitude: number) {
  try {
    if (!latitude || !longitude) {
      throw new Error("latitude, longitude가 필요합니다.");
    }

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

    // 카카오 응답 구조에서 주소 뽑기
    const address =
      data?.documents?.[0]?.road_address?.address_name ||
      data?.documents?.[0]?.address?.address_name;

    return address || "주소를 찾을 수 없습니다.";
  } catch (err: any) {
    console.error("getKakaoAddress error:", err);
    return `주소 탐색 중 오류 발생: ${err.message}`;
  }
}
