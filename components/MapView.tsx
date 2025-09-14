import React, { useEffect, useRef, useState } from "react";
import { getKakaoAddress, searchAddressByKeyword } from "../services/kakaoService";

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
  const [searchResults, setSearchResults] = useState<any[]>([]);

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

        // ✅ 지도 클릭 이벤트
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

  // ✅ 마커 위치 갱신
  useEffect(() => {
    if (map && marker) {
      const coords = new window.kakao.maps.LatLng(latitude, longitude);
      map.setCenter(coords);
      marker.setPosition(coords);
    }
  }, [latitude, longitude, map, marker]);

  // ✅ 검색 실행
  const handleSearch = async () => {
    if (!map || !marker || !searchInput.trim()) return;

    const geocoder = new window.kakao.maps.services.Geocoder();

    geocoder.addressSearch(searchInput, async (result: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
        if (result.length === 1) {
          moveToLocation(result[0].y, result[0].x, result[0].address.address_name);
        } else {
          // 여러 결과면 목록 표시
          setSearchResults(result);
        }
      } else {
        // 명칭 검색
        const keywordResults = await searchAddressByKeyword(searchInput);
        if (keywordResults.length === 1) {
          moveToLocation(keywordResults[0].y, keywordResults[0].x, keywordResults[0].place_name);
        } else if (keywordResults.length > 1) {
          setSearchResults(keywordResults);
        } else {
          alert("주소/명칭을 찾을 수 없습니다.");
        }
      }
    });
  };

  // ✅ 특정 위치로 이동
  const moveToLocation = (y: number, x: number, addr: string) => {
    const coords = new window.kakao.maps.LatLng(Number(y), Number(x));
    map.setCenter(coords);
    marker.setPosition(coords);
    if (onAddressSelect) onAddressSelect(addr, Number(y), Number(x));
    setSearchResults([]); // 팝업 닫기
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* ✅ 지도 */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "400px" }} />

      {/* ✅ 검색창 */}
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
          placeholder="주소 또는 명칭 검색"
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

      {/* ✅ 검색 결과 팝업 */}
      {searchResults.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "60px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "white",
            border: "1px solid #ccc",
            borderRadius: "8px",
            padding: "8px",
            maxHeight: "200px",
            overflowY: "auto",
            width: "80%",
            maxWidth: "400px",
            zIndex: 20,
          }}
        >
          {searchResults.map((place, idx) => (
            <div
              key={idx}
              style={{
                padding: "6px 8px",
                cursor: "pointer",
                borderBottom: "1px solid #eee",
              }}
              onClick={() =>
                moveToLocation(place.y, place.x, place.place_name || place.address_name)
              }
            >
              <strong>{place.place_name || place.road_address?.address_name || place.address_name}</strong>
              <div style={{ fontSize: "12px", color: "#555" }}>
                {place.address_name || place.road_address?.address_name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MapView;
