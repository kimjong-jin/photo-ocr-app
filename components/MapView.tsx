import React, { useEffect, useRef, useState, useCallback } from "react";
import { getKakaoAddress, searchAddressByKeyword } from "../services/kakaoService";

interface MapViewProps {
  latitude: number;
  longitude: number;
  onAddressSelect?: (address: string, lat: number, lng: number) => void;
}

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.978;

const MapView: React.FC<MapViewProps> = ({ latitude, longitude, onAddressSelect }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // ✅ map/marker는 ref로 유지 (재렌더/의존성 문제 줄임)
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const clickListenerRef = useRef<any>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [currentGpsAddress, setCurrentGpsAddress] = useState<string>("");

  // ✅ 최신 콜백 유지 (effect deps에서 빼도 최신 함수 호출)
  const onSelectRef = useRef<MapViewProps["onAddressSelect"]>(onAddressSelect);
  useEffect(() => {
    onSelectRef.current = onAddressSelect;
  }, [onAddressSelect]);

  // ✅ 연타/중복 호출 방지 (throttle + in-flight)
  const inFlightRef = useRef(false);
  const lastReqAtRef = useRef(0);

  const reverseGeocodeSafe = useCallback(async (lat: number, lng: number) => {
    const now = Date.now();
    if (inFlightRef.current) return;
    if (now - lastReqAtRef.current < 400) return; // 400ms 이하 연타 방지

    inFlightRef.current = true;
    lastReqAtRef.current = now;

    try {
      const address = await getKakaoAddress(lat, lng);
      setCurrentGpsAddress(address);
      onSelectRef.current?.(address, lat, lng);
    } catch (e) {
      console.error("주소 변환 실패:", e);
      setCurrentGpsAddress("주소 변환 실패");
      onSelectRef.current?.("주소 변환 실패", lat, lng);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // ✅ 지도 초기화는 1회만
  useEffect(() => {
    const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;

    const initMap = () => {
      if (!window.kakao || !window.kakao.maps || !mapContainerRef.current) return;

      window.kakao.maps.load(() => {
        // 이미 생성되어 있으면 재생성하지 않음
        if (mapRef.current && markerRef.current) return;

        const initLat = latitude || DEFAULT_LAT;
        const initLng = longitude || DEFAULT_LNG;

        const mapInstance = new window.kakao.maps.Map(mapContainerRef.current, {
          center: new window.kakao.maps.LatLng(initLat, initLng),
          level: 3,
        });

        const markerInstance = new window.kakao.maps.Marker({
          position: new window.kakao.maps.LatLng(initLat, initLng),
          map: mapInstance,
        });

        // ✅ 클릭 리스너 등록 (중복 등록 방지)
        clickListenerRef.current = window.kakao.maps.event.addListener(
          mapInstance,
          "click",
          async (mouseEvent: any) => {
            const latlng = mouseEvent.latLng;
            markerInstance.setPosition(latlng);
            await reverseGeocodeSafe(latlng.getLat(), latlng.getLng());
          }
        );

        mapRef.current = mapInstance;
        markerRef.current = markerInstance;
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

    // ✅ cleanup: 리스너 제거
    return () => {
      if (window.kakao?.maps?.event && clickListenerRef.current) {
        window.kakao.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
      // map/marker는 필요하면 여기서 null로 정리 가능
      // mapRef.current = null;
      // markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ✅ 1회만

  // ✅ 외부에서 latitude/longitude가 바뀌면 마커/센터만 갱신
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !window.kakao?.maps) return;

    const lat = latitude || DEFAULT_LAT;
    const lng = longitude || DEFAULT_LNG;
    const coords = new window.kakao.maps.LatLng(lat, lng);

    map.setCenter(coords);
    marker.setPosition(coords);
  }, [latitude, longitude]);

  // ✅ 검색 실행
  const handleSearch = async () => {
    const q = searchInput.trim();
    if (!q) return;

    const keywordResults = await searchAddressByKeyword(q);

    if (keywordResults.length === 1) {
      const r = keywordResults[0];
      moveToLocation(r.y, r.x, r.place_name);
    } else if (keywordResults.length > 1) {
      setSearchResults(keywordResults);
    } else {
      alert("주소/명칭을 찾을 수 없습니다.");
    }
  };

  // ✅ 결과 클릭 처리
  const handleSearchResultClick = async (place: any) => {
    const y = Number(place.y);
    const x = Number(place.x);

    // 지도 이동 먼저
    moveToLocation(y, x, place.place_name || place.address_name || "");

    // 상세 주소 확정(역지오코딩)
    await reverseGeocodeSafe(y, x);

    setSearchResults([]);
  };

  // ✅ 지도 이동
  const moveToLocation = (y: number, x: number, addr: string) => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !window.kakao?.maps) return;

    const coords = new window.kakao.maps.LatLng(Number(y), Number(x));
    map.setCenter(coords);
    marker.setPosition(coords);

    if (addr) {
      setCurrentGpsAddress(addr);
      onSelectRef.current?.(addr, Number(y), Number(x));
    }
    setSearchResults([]);
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mapContainerRef} style={{ width: "100%", height: "400px" }} />

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

      <div style={{ position: "absolute", top: "420px", left: "50%", transform: "translateX(-50%)" }}>
        <strong>현재 주소 (GPS):</strong>
        <div>{currentGpsAddress || "주소를 찾을 수 없습니다."}</div>
      </div>

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
              onClick={() => handleSearchResultClick(place)}
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
