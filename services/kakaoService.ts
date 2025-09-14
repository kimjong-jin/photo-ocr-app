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

// ✅ 좌표 → 주소 변환
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

  // ✅ region_* 조립 시 풀네임 보정
  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? "");
  const region2 = addr?.region_2depth_name ?? "";
  const region3 = addr?.region_3depth_name ?? "";
  const lotNumber =
    addr?.main_address_no +
    (addr?.sub_address_no ? "-" + addr.sub_address_no : "");

  // 1️⃣ 도로명 주소 있으면 그대로 사용 (풀네임으로 region1 보정)
  if (roadAddr) {
    return `${region1} ${roadAddr.replace(region1, "").trim()}`;
  }

  // 2️⃣ 도로명 없으면 지번 주소로 재검색
  if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      return `${region1} ${searchedRoad.replace(region1, "").trim()}`;
    }

    // 3️⃣ 재검색 실패 → 풀네임 기준 수동 조립
    return `${region1} ${region2} ${region3} ${lotNumber}`.trim();
  }

  return "주소를 찾을 수 없습니다.";
}
