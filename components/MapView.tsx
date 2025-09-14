import React, { useEffect, useRef } from "react";

interface MapViewProps {
  latitude: number;
  longitude: number;
}

const MapView: React.FC<MapViewProps> = ({ latitude, longitude }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

    const loadMap = () => {
      if (!window.kakao || !window.kakao.maps || !mapContainerRef.current) {
        console.error("Kakao Maps SDK가 아직 준비되지 않았습니다.");
        return;
      }

      const { kakao } = window;
      const map = new kakao.maps.Map(mapContainerRef.current, {
        center: new kakao.maps.LatLng(latitude, longitude),
        level: 3,
      });

      new kakao.maps.Marker({
        position: new kakao.maps.LatLng(latitude, longitude),
        map,
      });
    };

    // 이미 SDK 로드됨
    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(loadMap);
      return;
    }

    // SDK 동적 로드
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
    script.onload = () => {
      window.kakao.maps.load(loadMap);
    };
    document.head.appendChild(script);

    return () => {
      // cleanup 필요시
    };
  }, [latitude, longitude]);

  return <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />;
};

export default MapView;
