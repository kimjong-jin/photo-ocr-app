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
  "강원": "강원특별자치도",   // 카카오에서 '강원'으로만 올 수 있음
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

// ✅ 추가: StructuralCheckPage에서 직접 쓸 수 있는 헬퍼
export async function fetchAddressFromCoords(lat: number, lng: number, setCurrentGpsAddress: (addr: string) => void) {
  try {
    const addr = await getKakaoAddress(lat, lng);
    setCurrentGpsAddress(addr);
  } catch (err) {
    console.error("[fetchAddressFromCoords] 변환 실패:", err);
    setCurrentGpsAddress("주소 변환 실패");
  }
}
