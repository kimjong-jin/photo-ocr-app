import React, { useEffect, useRef, useState, useCallback } from "react";
import { getKakaoAddress, searchAddressByKeyword, enforceFullRegionPrefix } from "../services/kakaoService";

interface MapViewProps {
  latitude: number;
  longitude: number;
  onAddressSelect?: (address: string, lat: number, lng: number) => void;
  /** 이미 저장된 위치들 — 지도에 현장명 라벨로 표시(클릭 시 그 위치·주소 재사용) */
  savedLocations?: { id: string; lat: number; lng: number; siteName?: string; address?: string }[];
}

const DEFAULT_LAT = 37.5665;
const DEFAULT_LNG = 126.978;

const MapView: React.FC<MapViewProps> = ({ latitude, longitude, onAddressSelect, savedLocations }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // ✅ map/marker는 ref로 유지 (재렌더/의존성 문제 줄임)
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const clickListenerRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);

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
        setMapReady(true);
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

  // ✅ DB에 저장된 위치 전부를 현장명 라벨로 표시. 좌표 있으면 그대로, 좌표 없고 주소만 있으면 지오코딩.
  //    검색 무관(먹는물 배수지 등도 가능). 라벨 클릭 → 그 위치·주소 재사용(같은 현장 중복/주소 불일치 방지)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !window.kakao?.maps) return;
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];
    let cancelled = false;
    const geocoder = window.kakao.maps.services ? new window.kakao.maps.services.Geocoder() : null;

    const placeOverlay = (loc: any, lat: number, lng: number) => {
      if (cancelled || !lat || !lng) return;
      const pos = new window.kakao.maps.LatLng(lat, lng);
      const el = document.createElement("div");
      el.style.cssText =
        "background:#111827;color:#fff;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid #10b981;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;transform:translateY(-4px);";
      el.textContent = `📍 ${loc.siteName || loc.id}`;
      el.title = `${loc.id}\n${loc.address || ""}\n클릭 → 이 위치·주소 사용`;
      el.addEventListener("click", () => {
        const marker = markerRef.current;
        if (marker) marker.setPosition(pos);
        map.setCenter(pos);
        if (loc.address) {
          setCurrentGpsAddress(loc.address);
          onSelectRef.current?.(loc.address, lat, lng);
        }
      });
      const overlay = new window.kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1.4, zIndex: 5, clickable: true });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    };

    (savedLocations || []).forEach((loc) => {
      if (!loc) return;
      if (loc.lat && loc.lng) {
        placeOverlay(loc, loc.lat, loc.lng);
      } else if (loc.address && geocoder) {
        // 좌표 없는 DB 위치: 주소를 지오코딩해서 마커 표시
        geocoder.addressSearch(loc.address.trim(), (result: any[], status: any) => {
          if (cancelled) return;
          if (status === window.kakao.maps.services.Status.OK && result[0]) {
            placeOverlay(loc, parseFloat(result[0].y), parseFloat(result[0].x));
          }
        });
      }
    });

    return () => { cancelled = true; };
  }, [savedLocations, mapReady]);

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
      const normalizedAddr = enforceFullRegionPrefix(addr);
      setCurrentGpsAddress(normalizedAddr);
      onSelectRef.current?.(normalizedAddr, Number(y), Number(x));
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
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
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

      {/* 현재 주소 표시 - 지도 아래 일반 흐름으로 배치 */}
      <div style={{ padding: "8px 12px", background: "#f8f9fa", borderTop: "1px solid #e9ecef", fontSize: "13px", color: "#333" }}>
        <strong>현재 주소:</strong> {currentGpsAddress || "지도를 클릭하면 주소가 표시됩니다."}
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
