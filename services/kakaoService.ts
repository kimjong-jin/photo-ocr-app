// services/kakaoService.ts

// 보조: 지번 주소로 재검색해서 도로명 주소를 찾는 함수
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

// 🔹 region_1depth_name 정규화 ("부산광역시" → "부산", "서울특별시" → "서울")
function normalizeRegion1(name: string): string {
  return name.replace(/(광역시|특별시|특별자치시|특별자치도)$/, "");
}

export async function getKakaoAddress(latitude: number, longitude: number): Promise<string> {
  const apiKey = import.meta.env.VITE_KAKAO_REST_API_KEY; // ✅ Vite 방식
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

  // 1️⃣ 도로명 주소 있으면 최우선 반환
  if (roadAddr) return lotAddr ? `${roadAddr} (${lotAddr})` : roadAddr;

  // 2️⃣ 도로명 없으면 지번 주소로 재검색
  if (lotAddr) {
    const searchedRoad = await searchAddressByQuery(lotAddr, apiKey);
    if (searchedRoad) return `${searchedRoad} (${lotAddr})`;

    // 3️⃣ 재검색 실패 → region_* 기반 풀 주소 조립
    const addr = doc.address;
    if (addr) {
      const region1 = normalizeRegion1(addr.region_1depth_name);
      const full = `${region1} ${addr.region_2depth_name} ${addr.region_3depth_name} ${addr.main_address_no}${
        addr.sub_address_no ? "-" + addr.sub_address_no : ""
      }`;
      return full.trim();
    }

    return lotAddr;
  }

  return "주소를 찾을 수 없습니다.";
}
