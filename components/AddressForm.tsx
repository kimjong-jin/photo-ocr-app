// components/AddressForm.tsx
// 폼 새로고침 방지 + IME(한글) Enter 처리 + 광역단위 축약형 자동 정규화 + 서비스 연동

import { useState } from "react";
import { fetchAddressFromCoordsDebounced } from "@/services/kakaoService";

// 입력 선두(광역 1뎁스) 축약형을 풀네임으로 변환
function normalizeLeadingRegion(input: string): string {
  if (!input) return "";
  const s = input.trim().replace(/\s+/g, " ");
  const [first, ...rest] = s.split(" ");
  if (!first) return s;

  // 접미 '시/도' 한 번 제거 후 매칭도 시도
  const candidates = [first, first.replace(/[시도]$/u, ""), first.replace(/[,\-_/]+$/g, "")];

  for (const c of candidates) {
    const full = REGION_ALIAS_TO_FULL[c];
    if (full) return [full, ...rest].join(" ");
  }
  return s;
}

// REGION_ALIAS_TO_FULL는 서비스와 동일 사전을 사용 (복사본)
const REGION_ALIAS_TO_FULL: Record<string, string> = {
  "서울": "서울특별시", "서울시": "서울특별시", "서울특별시": "서울특별시",
  "부산": "부산광역시", "부산시": "부산광역시", "부산광역시": "부산광역시",
  "대구": "대구광역시", "대구시": "대구광역시", "대구광역시": "대구광역시",
  "인천": "인천광역시", "인천시": "인천광역시", "인천광역시": "인천광역시",
  "광주": "광주광역시", "광주시": "광주광역시", "광주광역시": "광주광역시",
  "대전": "대전광역시", "대전시": "대전광역시", "대전광역시": "대전광역시",
  "울산": "울산광역시", "울산시": "울산광역시", "울산광역시": "울산광역시",
  "세종": "세종특별자치시", "세종시": "세종특별자치시", "세종특별자치시": "세종특별자치시",
  "경기": "경기도", "경기도": "경기도",
  "강원": "강원특별자치도", "강원도": "강원특별자치도", "강원특별자치도": "강원특별자치도",
  "충북": "충청북도", "충청북": "충청북도", "충청북도": "충청북도", "충북도": "충청북도",
  "충남": "충청남도", "충청남": "충청남도", "충청남도": "충청남도", "충남도": "충청남도",
  "전북": "전북특별자치도", "전라북": "전북특별자치도", "전북특별자치도": "전북특별자치도", "전북도": "전북특별자치도",
  "전남": "전라남도", "전라남": "전라남도", "전라남도": "전라남도", "전남도": "전라남도",
  "경북": "경상북도", "경상북": "경상북도", "경상북도": "경상북도", "경북도": "경상북도",
  "경남": "경상남도", "경상남": "경상남도", "경상남도": "경상남도", "경남도": "경상남도",
  "제주": "제주특별자치도", "제주도": "제주특별자치도", "제주특별자치도": "제주특별자치도",
};

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
          const normalized = normalizeLeadingRegion(e.target.value);
          setManual((prev) => (prev === normalized ? prev : normalized));
        }}
        onKeyDown={(e) => {
          // @ts-ignore — IME 조합 확정 Enter는 submit 금지
          if ((e as any).nativeEvent?.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            const normalized = normalizeLeadingRegion((e.target as HTMLInputElement).value);
            setManual((prev) => (prev === normalized ? prev : normalized));
          }
        }}
        placeholder="예: 경남 창원시 → 자동으로 '경상남도 창원시'로 정규화"
        className="border rounded px-3 py-2"
      />

      <div className="text-xs text-gray-500">
        GPS 주소: {gpsAddr || "지도를 움직이면 주소가 표시됩니다"}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setManual("경남 창원시")} className="px-3 py-2 border rounded">
          예시(경남)
        </button>
        <button type="button" onClick={() => setManual("전북 전주시")} className="px-3 py-2 border rounded">
          예시(전북)
        </button>
        <button type="button" onClick={() => onMapMove(35.227, 128.681)} className="px-3 py-2 border rounded">
          GPS 갱신
        </button>
      </div>
    </form>
  );
}
