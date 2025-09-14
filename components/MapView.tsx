import React, { useEffect, useRef, useState } from "react";

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

        const geocoder = new window.kakao.maps.services.Geocoder();

        // 지도 클릭 시 이벤트
        window.kakao.maps.event.addListener(mapInstance, "click", (mouseEvent: any) => {
          const latlng = mouseEvent.latLng;
          markerInstance.setPosition(latlng);

          geocoder.coord2Address(latlng.getLng(), latlng.getLat(), (result: any, status: any) => {
            if (status === window.kakao.maps.services.Status.OK) {
              const address = result[0].road_address
                ? result[0].road_address.address_name
                : result[0].address.address_name;
              if (onAddressSelect) onAddressSelect(address, latlng.getLat(), latlng.getLng());
            }
          });
        });

        setMap(mapInstance);
        setMarker(markerInstance);
      });
    };

    if (window.kakao && window.kakao.maps) {
      initMap();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
    script.onload = initMap;
    document.head.appendChild(script);
  }, [latitude, longitude, onAddressSelect]);

  // ✅ 주소 검색 기능
  const handleSearch = () => {
    if (!map || !marker || !searchInput.trim()) return;

    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(searchInput, (result: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const { x, y } = result[0];
        const coords = new window.kakao.maps.LatLng(y, x);

        map.setCenter(coords);
        marker.setPosition(coords);

        if (onAddressSelect) onAddressSelect(result[0].address.address_name, y, x);
      } else {
        alert("주소를 찾을 수 없습니다.");
      }
    });
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* ✅ 검색창 */}
      <div style={{ marginBottom: "8px", display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="주소 검색"
          className="p-2 border rounded w-full text-black"
        />
        <button onClick={handleSearch} className="px-4 py-2 bg-blue-500 text-white rounded">
          검색
        </button>
      </div>
      <div ref={mapContainerRef} style={{ width: "100%", height: "400px" }} />
    </div>
  );
};

export default MapView;
