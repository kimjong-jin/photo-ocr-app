import React, { useEffect, useRef } from "react";

interface MapViewProps {
  latitude: number;
  longitude: number;
}

const MapView: React.FC<MapViewProps> = ({ latitude, longitude }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

    const loadKakaoMap = () => {
      if (!window.kakao || !mapContainerRef.current) return;

      const kakao = window.kakao;
      const map = new kakao.maps.Map(mapContainerRef.current, {
        center: new kakao.maps.LatLng(latitude, longitude),
        level: 3,
      });

      new kakao.maps.Marker({
        position: new kakao.maps.LatLng(latitude, longitude),
        map,
      });
    };

    // 이미 SDK가 로드된 경우
    if (window.kakao && window.kakao.maps) {
      loadKakaoMap();
      return;
    }

    // SDK 스크립트를 동적으로 로드
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(loadKakaoMap);
    };
    document.head.appendChild(script);
  }, [latitude, longitude]);

  return <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />;
};

export default MapView;
