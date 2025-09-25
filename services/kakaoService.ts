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
const addressCache = new Map<string, { value: string; timestamp: number }>();
let inflightController: AbortController | null = null;
const CACHE_TTL_MS = 1000 * 60 * 5; // 5분 TTL

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getFromCache(key: string): string | null {
  const cached = addressCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    addressCache.delete(key);
    return null;
  }
  return cached.value;
}

function setToCache(key: string, value: string) {
  addressCache.set(key, { value, timestamp: Date.now() });
}

async function safeFetch(url: string, apiKey: string, attempt = 1): Promise<Response> {
  if (inflightController) inflightController.abort();
  inflightController = new AbortController();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: inflightController.signal,
    });

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      console.warn(`[kakaoService] Retry due to status ${res.status} (attempt ${attempt})`);
      await sleep(500 * attempt);
      return safeFetch(url, apiKey, attempt + 1);
    }

    return res;
  } catch (error) {
    if (attempt < 3) {
      console.warn(`[kakaoService] Fetch error, retrying... (attempt ${attempt})`);
      await sleep(500 * attempt);
      return safeFetch(url, apiKey, attempt + 1);
    }
    throw error;
  }
}

function normalizeRegion(name: string): string {
  const base = name.replace(/시$/, "");
  return REGION_FULLNAME_MAP[base] || name;
}

function cleanAddress(address: string, region: string): string {
  const regionFullName = normalizeRegion(region);
  if (address.startsWith(regionFullName)) {
    const cleaned = address.slice(regionFullName.length).trim();
    return cleaned ? `${regionFullName} ${cleaned}` : regionFullName;
  }
  return address;
}

async function searchAddressByQuery(query: string, apiKey: string): Promise<string | null> {
  const cacheKey = `query:${query}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", query);

  try {
    const res = await safeFetch(url.toString(), apiKey);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.documents?.[0]?.road_address?.address_name || null;
    if (result) setToCache(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export async function searchAddressByKeyword(keyword: string): Promise<any[]> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", keyword);

  try {
    const res = await safeFetch(url.toString(), apiKey);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.documents || [];
  } catch {
    return [];
  }
}

export async function getKakaoAddress(latitude: number, longitude: number): Promise<string> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  const key = `${latitude},${longitude}`;
  const cached = getFromCache(key);
  if (cached) return cached;

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(longitude));
  url.searchParams.set("y", String(latitude));

  const res = await safeFetch(url.toString(), apiKey);
  if (!res.ok) return "서울특별시 중구 세종대로 110 서울시청";

  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) return "서울특별시 중구 세종대로 110 서울시청";

  const roadAddr = doc.road_address?.address_name ?? "";
  const lotAddr = doc.address?.address_name ?? "";
  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? "");
  const region2 = addr?.region_2depth_name ?? "";
  const region3 = addr?.region_3depth_name ?? "";
  const lotNumber = addr?.main_address_no + (addr?.sub_address_no ? "-" + addr.sub_address_no : "");

  let finalAddr = "주소를 찾을 수 없습니다.";
  if (roadAddr) {
    finalAddr = cleanAddress(roadAddr, region1) || `${region1} ${roadAddr}`;
  } else if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      finalAddr = cleanAddress(searchedRoad, region1) || `${region1} ${searchedRoad}`;
    } else {
      const keywordResults = await searchAddressByKeyword(lotAddr);
      const firstMatch = keywordResults?.[0]?.road_address_name ?? "";
      finalAddr = firstMatch
        ? cleanAddress(firstMatch, region1) || `${region1} ${firstMatch}`
        : `${region1} ${region2} ${region3} ${lotNumber}`.trim();
    }
  }

  setToCache(key, finalAddr);
  return finalAddr;
}

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
