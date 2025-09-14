// shared/constants.ts
export const TN_IDENTIFIERS = [
  "M1", "M2", "M3", "Z1", "Z2", "S1", "S2", "Z3", "Z4", "S3", "S4", 
  "Z5", "S5", "Z6", "S6", "Z7", "S7", "현장1", "현장2"
];

export const P2_SINGLE_ITEM_IDENTIFIERS = ["현장1", "현장2"];

export const TP_IDENTIFIERS = [
  "M1P", "M2P", "M3P", "Z1P", "Z2P", "S1P", "S2P", "Z3P", "Z4P", 
  "S3P", "S4P", "Z5P", "S5P", "Z6P", "S6P", "Z7P", "S7P", "현장1P", "현장2P"
];

export const IDENTIFIER_OPTIONS = Array.from(new Set([
  ...TN_IDENTIFIERS,
  ...TP_IDENTIFIERS
]));

// New structure for grouped analysis items
export interface AnalysisItemGroup {
  label: string;
  items: string[];
}

export const ANALYSIS_ITEM_GROUPS: AnalysisItemGroup[] = [
  {
    label: '수질',
    items: ["TOC", "TN", "TP", "COD", "TN/TP"],
  },
  {
    label: '현장 계수',
    items: ["TOC", "TN", "TP", "COD", "TN/TP"],
  },
  {
    label: '먹는물',
    items: ["TU", "Cl", "TU/CL"],
  },
];

// Centralized list of analysis items, derived from groups for consistency
export const ANALYSIS_ITEM_OPTIONS = ANALYSIS_ITEM_GROUPS.flatMap(group => group.items);

// Identifiers for the manual drinking water page
export const DRINKING_WATER_IDENTIFIERS = [
  "Z1", "Z2", "S1", "S2", "Z 2시간 시작 - 종료", "Z3", "Z4", "S3", "S4", 
  "드리프트 완료", "Z5", "S5", "반복성 완료", "M", "응답"
];

// ✅ 기존 코드 호환성을 위한 alias
export const P2_TN_IDENTIFIERS = TN_IDENTIFIERS;
export const P2_TP_IDENTIFIERS = TP_IDENTIFIERS;
