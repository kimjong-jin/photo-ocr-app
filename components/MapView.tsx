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
  const [currentGpsAddress, setCurrentGpsAddress] = useState<string>("");

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
            setCurrentGpsAddress(address); // GPS 주소 업데이트
            if (onAddressSelect) onAddressSelect(address, latlng.getLat(), latlng.getLng());
          } catch (e) {
            console.error("주소 변환 실패:", e);
            setCurrentGpsAddress("주소 변환 실패");
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
    if (!searchInput.trim()) return;

    // 명칭 검색 (검색어로 명칭을 입력)
    const keywordResults = await searchAddressByKeyword(searchInput);

    if (keywordResults.length === 1) {
      const result = keywordResults[0];
      moveToLocation(result.y, result.x, result.place_name);
    } else if (keywordResults.length > 1) {
      setSearchResults(keywordResults);
    } else {
      alert("주소/명칭을 찾을 수 없습니다.");
    }
  };

  // ✅ 클릭한 결과 처리
  const handleSearchResultClick = async (place: any) => {
    const address = await getKakaoAddress(place.y, place.x); // 클릭된 주소에 대한 상세 주소 가져오기
    setCurrentGpsAddress(address); // 현재 주소 업데이트
    if (onAddressSelect) onAddressSelect(address, place.y, place.x);
    setSearchResults([]); // 팝업 닫기
  };

  // ✅ 지도 이동
  const moveToLocation = (y: number, x: number, addr: string) => {
    const coords = new window.kakao.maps.LatLng(Number(y), Number(x));
    map.setCenter(coords);
    marker.setPosition(coords);
    setCurrentGpsAddress(addr); // 검색된 주소를 현재 주소로 설정
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

      {/* ✅ 현재 주소 */}
      <div style={{ position: "absolute", top: "420px", left: "50%", transform: "translateX(-50%)" }}>
        <strong>현재 주소 (GPS):</strong>
        <div>{currentGpsAddress || "주소를 찾을 수 없습니다."}</div>
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
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
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
              onClick={() => handleSearchResultClick(place)} // 클릭 시, 상세 주소 가져오기
            >
              <strong style={{ color: "#000" }}>
                {place.place_name || place.road_address?.address_name || place.address_name}
              </strong>
              <div style={{ fontSize: "12px", color: "#000" }}>
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
