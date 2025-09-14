import React, { useEffect, useRef, useState } from "react";
import { getKakaoAddress } from "../services/kakaoService"; // ✅ REST API 기반 주소 변환 사용

interface MapViewProps {
  latitude: number;
  longitude: number;
  onAddressSelect?: (address: string, lat: number, lng: number) => void;
}

const MapView: React.FC<MapViewProps> = ({ latitude, longitude, onAddressSelect }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<any>(null);
  const [marker, setMarker] = useState<any>(null);
  const [searchInput, setSearchInput] = useState("");

  // ✅ 지도 초기화
  useEffect(() => {
    const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

    const initMap = () => {
      if (!window.kakao || !window.kakao.maps || !mapContainerRef.current) return;

      window.kakao.maps.load(() => {
        const mapInstance = new window.kakao.maps.Map(mapContainerRef.current, {
          center: new window.kakao.maps.LatLng(latitude, longitude),
          level: 3,
        });

        const markerInstance = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(latitude, longitude),
          map: mapInstance,
        });

        // ✅ 지도 클릭 이벤트 (REST API 사용 → 풀네임 주소 보장)
        window.kakao.maps.event.addListener(mapInstance, "click", async (mouseEvent: any) => {
          const latlng = mouseEvent.latLng;
          markerInstance.setPosition(latlng);

          try {
            const address = await getKakaoAddress(latlng.getLat(), latlng.getLng());
            if (onAddressSelect) onAddressSelect(address, latlng.getLat(), latlng.getLng());
          } catch (e) {
            console.error("주소 변환 실패:", e);
            if (onAddressSelect) onAddressSelect("주소 변환 실패", latlng.getLat(), latlng.getLng());
          }
        });

        setMap(mapInstance);
        setMarker(markerInstance);
      });
    };

    // ✅ Kakao Map 스크립트 중복 로드 방지
    if (window.kakao && window.kakao.maps) {
      initMap();
    } else {
      if (!document.getElementById("kakao-map-script")) {
        const script = document.createElement("script");
        script.id = "kakao-map-script";
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
        script.onload = initMap;
        document.head.appendChild(script);
      } else {
        initMap();
      }
    }
  }, [latitude, longitude, onAddressSelect]);

  // ✅ latitude/longitude 변경 시 마커 위치 갱신
  useEffect(() => {
    if (map && marker) {
      const coords = new window.kakao.maps.LatLng(latitude, longitude);
      map.setCenter(coords);
      marker.setPosition(coords);
    }
  }, [latitude, longitude, map, marker]);

  // ✅ 주소 검색 기능 (SDK + REST 정규화)
  const handleSearch = () => {
    if (!map || !marker || !searchInput.trim()) return;

    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(searchInput, async (result: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const { x, y } = result[0];
        const coords = new window.kakao.maps.LatLng(y, x);

        map.setCenter(coords);
        marker.setPosition(coords);

        try {
          // ✅ 검색 결과도 REST API로 풀네임 보정
          const address = await getKakaoAddress(Number(y), Number(x));
          if (onAddressSelect) onAddressSelect(address, Number(y), Number(x));
        } catch {
          if (onAddressSelect) onAddressSelect(result[0].address.address_name, Number(y), Number(x));
        }
      } else {
        alert("주소를 찾을 수 없습니다.");
      }
    });
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* ✅ 지도 */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "400px" }} />

      {/* ✅ 검색창 (지도 위 오버레이) */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(255, 255, 255, 0.9)",
          borderRadius: "8px",
          padding: "4px 8px",
          display: "flex",
          gap: "6px",
          width: "80%",
          maxWidth: "400px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          zIndex: 10,
        }}
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="주소 검색"
          style={{
            flex: 1,
            padding: "6px 8px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontSize: "14px",
            color: "black",
            backgroundColor: "white",
          }}
        />
        <button
          onClick={handleSearch}
          style={{
            padding: "6px 12px",
            backgroundColor: "#3B82F6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          검색
        </button>
      </div>
    </div>
  );
};

export default MapView;
