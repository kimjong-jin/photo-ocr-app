
import { IDENTIFIER_OPTIONS } from '../shared/constants';

// --- Helper Functions ---
const mid = (str: string, start: number, length: number): string => {
  // Excel MID is 1-indexed, JS substring is 0-indexed
  return str.substring(start - 1, start - 1 + length);
};

const right = (str: string, length: number): string => {
  if (length <= 0) return "";
  if (length >= str.length) return str;
  return str.substring(str.length - length);
};

// --- X_MAPPING: Accessed via a memoized function ---
let X_MAPPING_CACHE: Record<string, string | undefined> | null = null;

const getXMapping = (): Record<string, string | undefined> => {
  if (X_MAPPING_CACHE === null) {
    X_MAPPING_CACHE = {
      "X40": IDENTIFIER_OPTIONS[0],  // M1
      "X41": IDENTIFIER_OPTIONS[1],  // M2
      "X42": IDENTIFIER_OPTIONS[2],  // M3
      "X43": IDENTIFIER_OPTIONS[3],  // Z5
      "X44": IDENTIFIER_OPTIONS[4],  // S5
      "X45": IDENTIFIER_OPTIONS[5],  // Z1
      "X46": IDENTIFIER_OPTIONS[6],  // Z2
      "X47": IDENTIFIER_OPTIONS[7],  // S1
      "X48": IDENTIFIER_OPTIONS[8],  // S2
      "X49": IDENTIFIER_OPTIONS[9],  // Z3
      "X50": IDENTIFIER_OPTIONS[10], // Z4
      "X51": IDENTIFIER_OPTIONS[11], // S3
      "X52": IDENTIFIER_OPTIONS[12], // S4
      "X53": IDENTIFIER_OPTIONS[13], // Z6
      "X54": IDENTIFIER_OPTIONS[14], // S6
      "X55": IDENTIFIER_OPTIONS[15], // Z7
      "X56": IDENTIFIER_OPTIONS[16], // S7
      "X57": IDENTIFIER_OPTIONS[17], // 현장1
      "X58": IDENTIFIER_OPTIONS[18], // 현장2
    };
  }
  return X_MAPPING_CACHE;
};

// --- Individual Formula Functions (f1 to f19) ---
// Each function corresponds to one of the 19 Excel formulas.
// W39 is equivalent to receiptNumber.

const f1 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,1,4)=="zszz") return X_MAPPING["X43"];
  if (mid(W39,1,4)=="szss") return X_MAPPING["X44"];
  if (mid(W39,1,4)=="zzss") return X_MAPPING["X45"];
  if (mid(W39,1,4)=="sszz") return X_MAPPING["X47"];
  if (mid(W39,1,4)=="MMMZ") return X_MAPPING["X40"];
  if (mid(W39,1,4)=="ZSMM") return X_MAPPING["X43"];
  if (mid(W39,1,4)=="SZMM") return X_MAPPING["X44"];
  return X_MAPPING["X40"];
};

const f2 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,1,4)=="zszz") return X_MAPPING["X44"];
  if (mid(W39,1,4)=="szss") return X_MAPPING["X43"];
  if (mid(W39,1,4)=="zzss") return X_MAPPING["X46"];
  if (mid(W39,1,4)=="sszz") return X_MAPPING["X48"];
  if (mid(W39,1,4)=="MMMZ") return X_MAPPING["X41"];
  if (mid(W39,1,4)=="ZSMM") return X_MAPPING["X44"];
  if (mid(W39,1,4)=="SZMM") return X_MAPPING["X43"];
  return X_MAPPING["X41"];
};

const f3 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,1,4)=="zszz") return X_MAPPING["X45"];
  if (mid(W39,1,4)=="szss") return X_MAPPING["X47"];
  if (mid(W39,1,4)=="zzss") return X_MAPPING["X47"];
  if (mid(W39,1,4)=="sszz") return X_MAPPING["X45"];
  if (mid(W39,1,4)=="MMMZ") return X_MAPPING["X42"];
  if (mid(W39,1,4)=="ZSMM") return X_MAPPING["X40"];
  if (mid(W39,1,4)=="SZMM") return X_MAPPING["X40"];
  return X_MAPPING["X42"];
};

const f4 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,1,4)=="zszz") return X_MAPPING["X46"];
  if (mid(W39,1,4)=="szss") return X_MAPPING["X48"];
  if (mid(W39,1,4)=="zzss") return X_MAPPING["X48"];
  if (mid(W39,1,4)=="sszz") return X_MAPPING["X46"];
  if (mid(W39,1,5)=="MMMZS") return X_MAPPING["X43"];
  if (mid(W39,1,5)=="MMMZZ") return X_MAPPING["X45"];
  if (mid(W39,1,4)=="ZSMM") return X_MAPPING["X41"];
  if (mid(W39,1,4)=="SZMM") return X_MAPPING["X41"];
  if (mid(W39,1,5)=="MMMSS") return X_MAPPING["X47"];
  return X_MAPPING["X43"];
};

const f5 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X45"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X45"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X48"];
  return X_MAPPING["X44"];
};

const f6 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X45"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X45"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X45"];
  return X_MAPPING["X45"];
};

const f7 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X46"];
  return X_MAPPING["X46"];
};

const f8 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X47"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X45"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X44"];
  return X_MAPPING["X47"];
};

const f9 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X48"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X46"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X43"];
  return X_MAPPING["X48"];
};

const f10 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X51"];
  return X_MAPPING["X49"];
};

const f11 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X40"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X52"];
  return X_MAPPING["X50"];
};

const f12 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X49"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X41"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X51"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X49"];
  return X_MAPPING["X51"];
};

const f13 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (mid(W39,5,9)=="sszzssmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="ssmmmzzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zzsszzmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zzmmmsszz") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zzsszsmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="mmmzzsszs") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="mmmzszzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="sszzszmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="mmmszsszz") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="mmmsszzsz") return X_MAPPING["X43"];
  if (mid(W39,5,9)=="szzsszzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="zsszzsszs") return X_MAPPING["X44"];
  if (mid(W39,5,9)=="mzzsszzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="msszzsszz") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zsmmmzzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="szmmmsszz") return X_MAPPING["X50"];
  if (mid(W39,5,9)=="zszzssmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="szsszzmmm") return X_MAPPING["X42"];
  if (mid(W39,5,9)=="zsszszzss") return X_MAPPING["X52"];
  if (mid(W39,5,9)=="szzszsszz") return X_MAPPING["X50"];
  return X_MAPPING["X52"];
};

const f14 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X53"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X53"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X54"];
    return undefined; // Should not be reached if logic is sound, but as a fallback
  }
  return undefined; // Corresponds to NA()
};

const f15 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X54"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X54"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X53"];
    return undefined;
  }
  return undefined;
};

const f16 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X55"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X55"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X56"];
    return undefined;
  }
  return undefined;
};

const f17 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X56"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X56"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X55"];
    return undefined;
  }
  return undefined;
};

const f18 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X57"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X57"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X58"];
    return undefined;
  }
  return undefined;
};

const f19 = (W39: string): string | undefined => {
  const X_MAPPING = getXMapping();
  if (!!X_MAPPING["X58"] && (right(W39,6)=="zszszs" || right(W39,6)=="szszsz")) {
    if (right(W39,6)=="zszszs") return X_MAPPING["X58"];
    if (right(W39,6)=="szszsz") return X_MAPPING["X57"];
    return undefined;
  }
  return undefined;
};


// Array of all formula functions in order
const formulaFunctions = [
  f1, f2, f3, f4, f5, f6, f7, f8, f9, f10,
  f11, f12, f13, f14, f15, f16, f17, f18, f19
];

/**
 * Main function to auto-assign identifiers based on receiptNumber.
 * @param receiptNumber The input string (equivalent to W39 in Excel).
 * @returns An array of 19 identifier strings or undefined, corresponding to the 19 formulas.
 */
export const autoAssignIdentifiersFromReceiptNumber = (receiptNumber: string): (string | undefined)[] => {
  if (!receiptNumber || typeof receiptNumber !== 'string') {
    // Return an array of undefineds if receiptNumber is invalid, maintaining the expected length
    return Array(19).fill(undefined);
  }
  return formulaFunctions.map(fn => fn(receiptNumber));
};
