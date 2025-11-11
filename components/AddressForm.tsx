// components/AddressForm.tsx
// 폼 새로고침 방지 + IME(한글) Enter 처리 + 서비스 연동 + 선행 정규화(옵션)

import { useState } from "react";
import { fetchAddressFromCoordsDebounced, enforceFullRegionPrefix } from "@/services/kakaoService";

export default function AddressForm() {
  const [manual, setManual] = useState<string>("");
  const [gpsAddr, setGpsAddr] = useState<string>("");

  const onMapMove = (lat: number, lng: number) => {
    fetchAddressFromCoordsDebounced(lat, lng, setGpsAddr);
  };

  return (
    <form
      onSubmit={(e) => e.preventDefault()} // 새로고침 방지
      className="flex flex-col gap-2"
    >
      <label className="text-sm font-medium">직접 입력</label>

      <input
        value={manual ?? ""} // 제어/비제어 전환 방지
        onChange={(e) => setManual(e.target.value)}
        onBlur={(e) => {
          // 포커스 아웃 시 선두 축약형을 풀네임으로 정규화(예: 부산 → 부산광역시)
          const normalized = enforceFullRegionPrefix(e.target.value);
          setManual((prev) => (prev === normalized ? prev : normalized));
        }}
        onKeyDown={(e) => {
          // 한글 IME 조합 Enter가 submit로 이어지지 않도록
          // @ts-ignore
          if ((e as any).nativeEvent?.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            const normalized = enforceFullRegionPrefix((e.target as HTMLInputElement).value);
            setManual((prev) => (prev === normalized ? prev : normalized));
          }
        }}
        placeholder="예: 부산 동구 수정동 647-8 → '부산광역시 동구 …'로 표준화"
        className="border rounded px-3 py-2"
      />

      <div className="text-xs text-gray-500">
        GPS 주소: {gpsAddr || "지도를 움직이면 주소가 표시됩니다"}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setManual("부산 동구 수정동 647-8")}
          className="px-3 py-2 border rounded"
        >
          예시(부산 축약형)
        </button>
        <button
          type="button"
          onClick={() => onMapMove(35.1295, 129.0457)} // 부산 동구 일대 예시 좌표
          className="px-3 py-2 border rounded"
        >
          GPS 갱신
        </button>
      </div>
    </form>
  );
}
