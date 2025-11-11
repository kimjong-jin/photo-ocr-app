// services/kakaoService.ts
// 드롭인 교체본: 429/새로고침/깜빡임/키 누락 안정화 포함

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

// =========================
// 공통 유틸/전역 상태
// =========================

const addressCache = new Map<string, { value: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 5; // 5분

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

// 디바운스 (드래그/타이핑 이벤트 완화)
export function debounce<T extends (...args: any[]) => any>(fn: T, wait = 250) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// 좌표 스냅 (노이즈 억제, 캐시 히트↑) — 1e-4 deg ≈ 10~15m
function snapCoord(v: number, step = 1e-4) {
  return Math.round(v / step) * step;
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

// =========================
// 네트워크 제어 (폭주/429 방지)
// =========================

// 전역 QPS 제한 (토큰 버킷) — 3 req/s
let tokens = 3;
const capacity = 3;
setInterval(() => {
  tokens = Math.min(capacity, tokens + 1);
}, 333);

async function rateLimit() {
  while (tokens <= 0) await sleep(50);
  tokens--;
}

// 429 쿨다운 (짧은 시간 일시 정지)
let coolUntil = 0;
async function maybeCooldown(status: number) {
  const now = Date.now();
  if (status === 429) coolUntil = now + 3000; // 3초
  if (now < coolUntil) throw Object.assign(new Error("쿼터 과부하(쿨다운 중)"), { code: 429 });
}

// 엔드포인트 단위 중복 요청 제어 + 재시도
const inflightControllers = new Map<string, AbortController>();
function getAbortKey(url: string, logicalKey?: string) {
  return logicalKey ?? url;
}

async function safeFetch(
  url: string,
  apiKey: string,
  attempt = 1,
  logicalKey?: string
): Promise<Response> {
  const canAbort = typeof AbortController !== "undefined";
  const abortKey = getAbortKey(url, logicalKey);

  if (canAbort) inflightControllers.get(abortKey)?.abort();
  const controller = canAbort ? new AbortController() : undefined;
  if (canAbort) inflightControllers.set(abortKey, controller!);

  try {
    await rateLimit();

    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: controller?.signal,
    });

    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const base = 400 * attempt;
      const jitter = Math.random() * 250;
      await sleep(base + jitter);
      return safeFetch(url, apiKey, attempt + 1, logicalKey);
    }
    return res;
  } catch (err: any) {
    if (canAbort && (err?.name === "AbortError" || err?.message?.includes("aborted"))) throw err;
    if (attempt < 3) {
      await sleep(300 * attempt);
      return safeFetch(url, apiKey, attempt + 1, logicalKey);
    }
    throw err;
  } finally {
    if (canAbort) inflightControllers.delete(abortKey);
  }
}

// =========================
// 외부 API 호출
// =========================

async function searchAddressByQuery(query: string, apiKey: string): Promise<string | null> {
  const cacheKey = `query:${query}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", query);

  try {
    const res = await safeFetch(url.toString(), apiKey, 1, "search:address");
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
  // ❗키 누락 시 앱 크래시 방지: 안전 반환
  if (!apiKey) {
    console.error("[Kakao] API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");
    return [];
  }

  const cacheKey = `kw:${keyword}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // noop
    }
  }

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", keyword);

  try {
    const res = await safeFetch(url.toString(), apiKey, 1, "search:keyword");
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
  // ❗키 누락 시 앱 크래시 방지: 안전 반환
  if (!apiKey) {
    console.error("[Kakao] API 키 없음 (VITE_KAKAO_REST_API_KEY 확인 필요)");
    return "주소를 찾을 수 없습니다.";
  }

  // 좌표 스냅
  const lat = snapCoord(latitude);
  const lng = snapCoord(longitude);

  const key = `${lat},${lng}`;
  const cached = getFromCache(key);
  if (cached) return cached;

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));

  const res = await safeFetch(url.toString(), apiKey, 1, "coord2address");
  await maybeCooldown(res.status);
  if (!res.ok) return "주소를 찾을 수 없습니다.";

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

  if (finalAddr && finalAddr !== "주소를 찾을 수 없습니다.") setToCache(key, finalAddr);
  return finalAddr;
}

// =========================
// 상태 반영 (최근 요청만 수용)
// =========================
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
    setCurrentGpsAddress(((prev: string) => (prev === addr ? prev : addr)) as any);
  } catch (err: any) {
    // 사용자가 이전 요청을 취소한 경우는 조용히 무시
    if (err?.name === "AbortError" || err?.message?.includes("aborted")) return;
    if (myReqId !== latestGpsReqId) return;
    console.warn("[fetchAddressFromCoords] 주소 변환 실패:", err);
    setCurrentGpsAddress("주소 변환 실패");
  }
}

// 드래그/이동 이벤트용 디바운스 버전
export const fetchAddressFromCoordsDebounced = debounce(fetchAddressFromCoords, 250);
