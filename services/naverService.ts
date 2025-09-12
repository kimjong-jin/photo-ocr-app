export async function fetchNaverReverseGeocode(
  lat: string,
  lon: string,
  id: string,
  secret: string
) {
  const NAVER_API_URL =
    "https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc";

  const params = new URLSearchParams({
    coords: `${lon},${lat}`,          // x=경도(lon), y=위도(lat)
    output: "json",
    orders: "roadaddr,addr",
    sourcecrs: "epsg:4326",           // WGS84
  });

  const response = await fetch(`${NAVER_API_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-NCP-APIGW-API-KEY-ID": id,
      "X-NCP-APIGW-API-KEY": secret,
    },
  });

  const raw = await response.text();              // 항상 text로 먼저
  let data: any = null;
  try { data = JSON.parse(raw); } catch (_) {}

  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.errorMessage || raw || `HTTP ${response.status}`
    );
  }

  return data;
}
