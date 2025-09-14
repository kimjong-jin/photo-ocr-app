// services/kakaoService.ts

// ✅ 축약형 → 풀네임 매핑
const REGION_FULLNAME_MAP: Record<string, string> = {
  "서울": "서울특별시",
  "부산": "부산광역시",
  "대구": "대구광역시",
  "인천": "인천광역시",
  "광주": "광주광역시",
  "대전": "대전광역시",
  "울산": "울산광역시",
  "세종": "세종특별자치시",
  "경기": "경기도",
  "강원": "강원특별자치도",
  "충북": "충청북도",
  "충남": "충청남도",
  "전북": "전북특별자치도",
  "전남": "전라남도",
  "경북": "경상북도",
  "경남": "경상남도",
  "제주": "제주특별자치도",
};

// ✅ 행정구역 보정 함수
function normalizeRegion(name: string): string {
  return REGION_FULLNAME_MAP[name] || name;
}

// ✅ 지번 주소 기반으로 도로명 주소 재검색
async function searchAddressByQuery(query: string, apiKey: string): Promise<string | null> {
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", query);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });

    if (!res.ok) {
      console.warn(`[kakaoService] Address search failed (${res.status}): ${query}`);
      return null;
    }

    const data = await res.json();
    return data?.documents?.[0]?.road_address?.address_name || null;
  } catch (err) {
    console.error(`[kakaoService] Query search error (${query}):`, err);
    return null;
  }
}

// ✅ 위도/경도 → 카카오 주소 변환
export async function getKakaoAddress(latitude: number, longitude: number): Promise<string> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });

  if (!res.ok) {
    // 실패 시 서울시청으로 이동
    return "서울특별시 중구 세종대로 110 서울시청"; // 서울시청 위치 주소 반환
  }

  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) {
    return "서울특별시 중구 세종대로 110 서울시청"; // 주소를 못 찾으면 서울시청
  }

  const roadAddr = doc.road_address?.address_name ?? "";
  const lotAddr = doc.address?.address_name ?? "";

  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? ""); // 첫 번째 행정구역 (부산광역시 등)
  const region2 = addr?.region_2depth_name ?? ""; // 두 번째 행정구역
  const region3 = addr?.region_3depth_name ?? ""; // 세 번째 행정구역
  const lotNumber =
    addr?.main_address_no +
    (addr?.sub_address_no ? "-" + addr.sub_address_no : "");

  // 1️⃣ 도로명 주소가 있으면
  if (roadAddr) {
    // 중복된 행정구역 이름을 제거하고, `region1`(광역시 등)만 남깁니다.
    let cleanedAddress = roadAddr;

    // 전체 지역명을 제거
    Object.keys(REGION_FULLNAME_MAP).forEach((key) => {
      const regionName = REGION_FULLNAME_MAP[key];
      if (cleanedAddress.includes(regionName)) {
        cleanedAddress = cleanedAddress.replace(regionName, "").trim();
      }
    });

    // 중복된 지역을 제거하고, 지역이 남지 않으면 `region1`(광역시)만 추가
    if (!cleanedAddress) cleanedAddress = `${region1} ${roadAddr}`;
    return cleanedAddress;
  }

  // 2️⃣ 도로명 주소가 없으면 지번 주소로 재검색
  if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      // 지번 주소에서 지역명을 제거
      let cleanedAddress = searchedRoad;

      // 전체 지역명을 제거
      Object.keys(REGION_FULLNAME_MAP).forEach((key) => {
        const regionName = REGION_FULLNAME_MAP[key];
        if (cleanedAddress.includes(regionName)) {
          cleanedAddress = cleanedAddress.replace(regionName, "").trim();
        }
      });

      // 중복된 지역을 제거하고, 지역이 남지 않으면 `region1`(광역시)만 추가
      if (!cleanedAddress) cleanedAddress = `${region1} ${searchedRoad}`;
      return cleanedAddress;
    }
    // 3️⃣ 실패 시 풀네임 조합
    return `${region1} ${region2} ${region3} ${lotNumber}`.trim();
  }

  return "주소를 찾을 수 없습니다."; // 주소를 찾을 수 없으면 기본 반환 값
}

// ✅ 명칭 검색 (여러 개 반환)
export async function searchAddressByKeyword(keyword: string): Promise<any[]> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", keyword);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });

    if (!res.ok) {
      console.warn(`[kakaoService] Keyword search failed (${res.status}): ${keyword}`);
      return [];
    }

    const data = await res.json();
    return data?.documents || [];
  } catch (err) {
    console.error(`[kakaoService] Keyword search error (${keyword}):`, err);
    return [];
  }
}

// ✅ 추가: StructuralCheckPage 등에서 사용
export async function fetchAddressFromCoords(
  lat: number,
  lng: number,
  setCurrentGpsAddress: (addr: string) => void
) {
  try {
    const addr = await getKakaoAddress(lat, lng);
    setCurrentGpsAddress(addr);
  } catch (err) {
    console.error("[fetchAddressFromCoords] 변환 실패:", err);
    setCurrentGpsAddress("주소 변환 실패");
  }
}
