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
      if (!window.kakao || !window.kakao.maps || !mapContainerRef.current) {
        console.error("Kakao Maps SDK가 준비되지 않았습니다.");
        return;
      }

      // ✅ 반드시 maps.load() 안에서 실행
      window.kakao.maps.load(() => {
        const map = new window.kakao.maps.Map(mapContainerRef.current, {
          center: new window.kakao.maps.LatLng(latitude, longitude),
          level: 3,
        });

        new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(latitude, longitude),
          map,
        });
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadKakaoMap();
      return;
    }

    // SDK 스크립트 동적 로드
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
    script.onload = loadKakaoMap;
    document.head.appendChild(script);
  }, [latitude, longitude]);

  return <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />;
};

export default MapView;
