export async function fetchNaverReverseGeocode(
  lat: string,
  lon: string,
  id: string,
  secret: string
) {
  const NAVER_API_URL =
    "https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc";

  const url = `${NAVER_API_URL}?coords=${lon},${lat}&output=json&orders=roadaddr,addr`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-NCP-APIGW-API-KEY-ID": id,
      "X-NCP-APIGW-API-KEY": secret,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Naver API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}
