export async function fetchNaverReverseGeocode(lat: string, lon: string, id: string, secret: string) {
  const NAVER_API_URL =
    'https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc';

  const url = `${NAVER_API_URL}?coords=${lon},${lat}&output=json&orders=roadaddr,addr`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': 4tugw3f09n,
      'X-NCP-APIGW-API-KEY': tDG67YOSbw7DWG5Avo9ROtYDnBH0xGcIR,
    },
  });

  if (!response.ok) {
    throw new Error(`Naver API error: ${response.status}`);
  }

  return response.json();
}
