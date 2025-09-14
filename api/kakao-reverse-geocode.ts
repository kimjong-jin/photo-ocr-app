const Be = async (Fe: GeolocationPosition) => {
  const { latitude: Pe, longitude: pe } = Fe.coords;
  try {
    const be = await fetch(`/api/kakao-reverse-geocode?latitude=${Pe}&longitude=${pe}`);
    const Ue = await be.text();
    let _e: any = null;
    try {
      _e = JSON.parse(Ue);
    } catch {}

    if (!be.ok) {
      throw new Error((_e?.error) || Ue || `HTTP ${be.status}`);
    }

    // 카카오 응답 구조에 맞게 수정
    const address =
      _e?.documents?.[0]?.road_address?.address_name ||
      _e?.documents?.[0]?.address?.address_name;

    if (address) {
      le(address);
    } else {
      le("주소를 찾을 수 없습니다.");
    }
  } catch (be) {
    console.error("Fetch error:", be);
    le("주소 탐색 중 오류가 발생했습니다.");
  } finally {
    Z(false); // 로딩 해제
  }
};
