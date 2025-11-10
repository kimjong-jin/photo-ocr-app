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
const inflightControllers = new Map<string, AbortController>(); // URL별 컨트롤러
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
  // 동일 URL만 중복 제어 (다른 URL 요청은 건드리지 않음 → 깜빡임 원인 차단)
  const prev = inflightControllers.get(url);
  if (prev) prev.abort();
  const controller = new AbortController();
  inflightControllers.set(url, controller);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: controller.signal,
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
  } finally {
    inflightControllers.delete(url);
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
    const result =
      data?.documents?.[0]?.road_address?.address_name ||
      data?.documents?.[0]?.address?.address_name ||
      null;
    if (result) setToCache(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export async function searchAddressByKeyword(keyword: string): Promise<any[]> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");

  // 🔒 키워드도 캐시 (입력 중 중복 호출 완화)
  const cacheKey = `kw:${keyword}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* noop */ }
  }

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", keyword);

  try {
    const res = await safeFetch(url.toString(), apiKey);
    if (!res.ok) return [];
    const data = await res.json();
    const docs = data?.documents || [];
    setToCache(cacheKey, JSON.stringify(docs));
    return docs;
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
  if (!res.ok) {
    // ❗ 실패값은 캐시하지 않음 (가짜 정상값으로 깜빡임 방지)
    return "주소를 찾을 수 없습니다.";
  }

  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) return "주소를 찾을 수 없습니다.";

  const roadAddr = doc.road_address?.address_name ?? "";
  const lotAddr = doc.address?.address_name ?? "";
  const addr = doc.address;
  const region1 = normalizeRegion(addr?.region_1depth_name ?? "");
  const region2 = addr?.region_2depth_name ?? "";
  const region3 = addr?.region_3depth_name ?? "";

  const mainNo = addr?.main_address_no ?? "";
  const subNo = addr?.sub_address_no ?? "";
  const lotNumber = mainNo ? (subNo ? `${mainNo}-${subNo}` : mainNo) : "";

  let finalAddr = "주소를 찾을 수 없습니다.";
  if (roadAddr) {
    finalAddr = cleanAddress(roadAddr, region1) || `${region1} ${roadAddr}`;
  } else if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) {
      finalAddr = cleanAddress(searchedRoad, region1) || `${region1} ${searchedRoad}`;
    } else {
      const keywordResults = await searchAddressByKeyword(lotAddr);
      const firstMatch =
        keywordResults?.[0]?.road_address_name || keywordResults?.[0]?.address_name || "";
      finalAddr = firstMatch
        ? cleanAddress(firstMatch, region1) || `${region1} ${firstMatch}`
        : `${region1} ${region2} ${region3}${lotNumber ? ` ${lotNumber}` : ""}`.trim();
    }
  }

  // ✅ 정상 주소만 캐시 (실패 문자열은 캐시하지 않음)
  if (finalAddr && finalAddr !== "주소를 찾을 수 없습니다.") {
    setToCache(key, finalAddr);
  }
  return finalAddr;
}

// 🔐 최근 요청만 상태 반영: 느린 이전 응답이 뒤늦게 도착해도 무시
let latestGpsReqId = 0;

export async function fetchAddressFromCoords(
  lat: number,
  lng: number,
  setCurrentGpsAddress: (addr: string) => void
) {
  const myReqId = ++latestGpsReqId;
  try {
    const addr = await getKakaoAddress(lat, lng);
    if (myReqId !== latestGpsReqId) return; // stale 응답 무시
    // 동일 문자열로 불필요한 리렌더 방지 (깜빡임 완화)
    setCurrentGpsAddress((prev => (prev === addr ? prev : addr)) as any);
  } catch (err) {
    console.error("[fetchAddressFromCoords] 변환 실패:", err);
    if (myReqId !== latestGpsReqId) return;
    setCurrentGpsAddress("주소 변환 실패");
  }
}
