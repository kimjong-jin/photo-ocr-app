// components/AddressForm.tsx
// 폼 새로고침(F5처럼 보임) 방지 + IME(한글) Enter 처리 + 서비스 연동 예시

import { useState } from "react";
import { fetchAddressFromCoordsDebounced } from "@/services/kakaoService";

export default function AddressForm() {
  const [manual, setManual] = useState<string>("");
  const [gpsAddr, setGpsAddr] = useState<string>("");

  // 예시: 지도 이동 시 좌표 업데이트 (실제 지도 이벤트에서 호출)
  const onMapMove = (lat: number, lng: number) => {
    fetchAddressFromCoordsDebounced(lat, lng, setGpsAddr);
  };

  return (
    <form
      onSubmit={(e) => e.preventDefault()} // ★ 새로고침(암묵적 submit) 방지
      className="flex flex-col gap-2"
    >
      <label className="text-sm font-medium">직접 입력</label>
      <input
        value={manual ?? ""} // ★ 제어/비제어 전환 방지
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          // 한글 IME 조합 중 Enter는 submit 금지
          // @ts-ignore
          if ((e as any).nativeEvent?.isComposing) return;
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder="예: 경상남도 창원시..."
        className="border rounded px-3 py-2"
      />

      <div className="text-xs text-gray-500">
        GPS 주소: {gpsAddr || "지도를 움직이면 주소가 표시됩니다"}
      </div>

      {/* 버튼은 명시적으로 button (submit 기본값 방지) */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setManual("경상남도")}
          className="px-3 py-2 border rounded"
        >
          경남 → 경상남도
        </button>
        <button
          type="button"
          onClick={() => onMapMove(35.227, 128.681)} // 예시: 창원시청 근처
          className="px-3 py-2 border rounded"
        >
          GPS 갱신
        </button>
      </div>
    </form>
  );
}
