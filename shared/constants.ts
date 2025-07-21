// shared/constants.ts
export const TN_IDENTIFIERS = [
  "M1", "M2", "M3", "Z1", "Z2", "S1", "S2", "Z3", "Z4", "S3", "S4", 
  "Z5", "S5", "Z6", "S6", "Z7", "S7", "현장1", "현장2"
];

export const TP_IDENTIFIERS = [
  "M1P", "M2P", "M3P", "Z1P", "Z2P", "S1P", "S2P", "Z3P", "Z4P", 
  "S3",  // Shared with TN list as per user's TP list
  "S4P", 
  "Z5",  // Shared with TN list
  "S5",  // Shared with TN list
  "Z6P", 
  "S6",  // Shared with TN list
  "Z7P", "S7P", "현장1P", "현장2P"
];

export const IDENTIFIER_OPTIONS = Array.from(new Set([
  ...TN_IDENTIFIERS,
  ...TP_IDENTIFIERS
]));

// Centralized list of analysis items for consistency
export const ANALYSIS_ITEM_OPTIONS = ["TOC", "TN", "TP", "COD", "TN/TP"];
