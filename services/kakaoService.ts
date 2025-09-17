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

// ✅ 요청 캐시 & 중복 요청 제어
const addressCache = new Map<string, string>();
let inflightController: AbortController | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url: string, apiKey: string, attempt = 1): Promise<Response> {
  // 이전 요청 취소
  if (inflightController) inflightController.abort();
  inflightController = new AbortController();

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: inflightController.signal,
  });

  // ✅ Rate Limit 초과 시 지수 백오프 재시도
  if (res.status === 429 && attempt < 3) {
    console.warn(`[kakaoService] Rate limit hit, retrying... (attempt ${attempt})`);
    await sleep(500 * attempt);
    return safeFetch(url, apiKey, attempt + 1);
  }

  return res;
}

// ✅ 행정구역 보정 함수
function normalizeRegion(name: string): string {
  return REGION_FULLNAME_MAP[name] || name;
}

// ✅ 주소에서 지역명 중복 제거
function cleanAddress(address: string, region: string): string {
  const regionFullName = normalizeRegion(region);

  if (address.startsWith(regionFullName)) {
    let cleanedAddress = address.replace(regionFullName, "").trim();
    const regionPattern = new RegExp(`^${regionFullName}`);
    cleanedAddress = cleanedAddress.replace(regionPattern, "").trim();
    return cleanedAddress ? `${regionFullName} ${cleanedAddress}` : regionFullName;
  }
  return address;
}

// ✅ 지번 주소 기반으로 도로명 주소 재검색
async function searchAddressByQuery(query: string, apiKey: string): Promise<string | null> {
  const cacheKey = `query:${query}`;
  if (addressCache.has(cacheKey)) return addressCache.get(cacheKey)!;

  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", query);

  try {
    const res = await safeFetch(url.toString(), apiKey);
    if (!res.ok) {
      console.warn(`[kakaoService] Address search failed (${res.status}): ${query}`);
      return null;
    }
    const data = await res.json();
    const result = data?.documents?.[0]?.road_address?.address_name || null;
    if (result) addressCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[kakaoService] Query search error (${query}):`, err);
    return null;
  }
}

// ✅ 위도/경도 → 카카오 주소 변환
export async function getKakaoAddress(latitude: number, longitude: number): Promise<string> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const key = `${latitude},${longitude}`;
  if (addressCache.has(key)) return addressCache.get(key)!;

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await safeFetch(url.toString(), apiKey);
  if (!res.ok) {
    return "서울특별시 중구 세종대로 110 서울시청";
  }

  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) return "서울특별시 중구 세종대로 110 서울시청";

  const roadAddr = doc.road_address?.address_name ?? "";
  const lotAddr = doc.address?.address_name ?? "";
  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? "");
  const region2 = addr?.region_2depth_name ?? "";
  const region3 = addr?.region_3depth_name ?? "";
  const lotNumber =
    addr?.main_address_no +
    (addr?.sub_address_no ? "-" + addr.sub_address_no : "");

  let finalAddr = "주소를 찾을 수 없습니다.";
  if (roadAddr) {
    finalAddr = cleanAddress(roadAddr, region1) || `${region1} ${roadAddr}`;
  } else if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      finalAddr = cleanAddress(searchedRoad, region1) || `${region1} ${searchedRoad}`;
    } else {
      finalAddr = `${region1} ${region2} ${region3} ${lotNumber}`.trim();
    }
  }

  addressCache.set(key, finalAddr);
  return finalAddr;
}

// ✅ 명칭 검색 (여러 개 반환)
export async function searchAddressByKeyword(keyword: string): Promise<any[]> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", keyword);

  try {
    const res = await safeFetch(url.toString(), apiKey);
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
