// 카카오·네이버·구글 지도 "열기" 링크 생성 (교차검증용). 좌표 있으면 정확한 핀, 없으면 주소/이름 검색.
export interface MapLinkInput {
  address?: string;
  lat?: number;
  lng?: number;
  name?: string; // 현장명/장소명
}

export interface MapLinks {
  kakao: string;
  naver: string;
  google: string;
}

export function buildMapLinks({ address = '', lat, lng, name = '' }: MapLinkInput): MapLinks {
  const hasCoord = typeof lat === 'number' && typeof lng === 'number' && !!lat && !!lng;
  const query = (address || name || '').trim();
  const q = encodeURIComponent(query);
  const label = encodeURIComponent((name || address || '위치').trim());
  return {
    // 카카오: 좌표 있으면 라벨+좌표 핀, 없으면 검색
    kakao: hasCoord
      ? `https://map.kakao.com/link/map/${label},${lat},${lng}`
      : `https://map.kakao.com/link/search/${q}`,
    // 네이버: 주소/이름 검색 (웹→앱 자동 전환). 좌표 단독 URL이 불안정해 검색 기준.
    naver: `https://map.naver.com/p/search/${q}`,
    // 구글: 좌표 있으면 좌표, 없으면 검색
    google: hasCoord
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}
