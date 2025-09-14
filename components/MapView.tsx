import React, { useEffect, useRef } from "react";

interface MapViewProps {
  latitude: number;
  longitude: number;
  onAddressSelect?: (address: string, lat: number, lng: number) => void;
}

const MapView: React.FC<MapViewProps> = ({ latitude, longitude, onAddressSelect }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

    const loadKakaoMap = () => {
      if (!window.kakao || !window.kakao.maps || !mapContainerRef.current) return;

      window.kakao.maps.load(() => {
        const map = new window.kakao.maps.Map(mapContainerRef.current, {
          center: new window.kakao.maps.LatLng(latitude, longitude),
          level: 3,
        });

        const marker = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(latitude, longitude),
          map,
        });

        const geocoder = new window.kakao.maps.services.Geocoder();

        // ✅ 지도 클릭 이벤트
        window.kakao.maps.event.addListener(map, "click", (mouseEvent: any) => {
          const latlng = mouseEvent.latLng;

          // 마커 이동
          marker.setPosition(latlng);

          // 좌표 → 주소 변환
          geocoder.coord2Address(latlng.getLng(), latlng.getLat(), (result: any, status: any) => {
            if (status === window.kakao.maps.services.Status.OK) {
              const address = result[0].road_address
                ? result[0].road_address.address_name
                : result[0].address.address_name;

              console.log("선택한 주소:", address);
              if (onAddressSelect) {
                onAddressSelect(address, latlng.getLat(), latlng.getLng());
              }
            }
          });
        });
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadKakaoMap();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
    script.onload = loadKakaoMap;
    document.head.appendChild(script);
  }, [latitude, longitude, onAddressSelect]);

  return <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />;
};

export default MapView;
