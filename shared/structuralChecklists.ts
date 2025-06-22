
export type MainStructuralItemKey = 'TOC' | 'TN' | 'TP' | 'SS' | 'PH' | 'DO' | 'COD';

export const MAIN_STRUCTURAL_ITEMS: { key: MainStructuralItemKey; name: string }[] = [
  { key: 'TOC', name: 'TOC (총유기탄소)' },
  { key: 'TN', name: 'TN (총질소)' },
  { key: 'TP', name: 'TP (총인)' },
  { key: 'SS', name: 'SS (부유물질)' },
  { key: 'PH', name: 'pH (수소이온농도)' },
  { key: 'DO', name: 'DO (용존산소)' },
  { key: 'COD', name: 'COD (화학적산소요구량)' },
];

const baseChecklistItems = [
    "측정범위확인",
    "측정방법확인",
];

// Specific items per category
const tocSpecific = [
    "시료도입부확인",
    "무기 탄소제거부확인",
    "반응검출부확인",
    "운반기체공급부확인",
    "주입부확인",
    "산화반응부확인",
    "시료및증류수보급부확인",
    "시약저장부확인",
    "제어부확인",
    "운용프로그램확인",
];

const tnTpSpecificBase = [ // Renamed for clarity before mapping
    "계량부확인",
    "반응부확인",
    "검출부확인",
    "시약저장부 확인", // This will be mapped
    "제어부확인",
    "운용프로그램확인",
    "지시외부출력부확인",
];

const ssSpecific = [
    "시료도입부확인",
    "측정부확인",
    "검출부확인",
    "제어부확인",
    "운용프로그램확인",
    "지시외부출력부확인",
];

const phSpecific = [
    "센서부확인",
    "전극확인",
    "제어부확인",
    "운용프로그램확인",
    "지시외부출력부확인",
];

const doSpecific = [
    "센서부확인",
    "전극확인",
    "전극보호구확인",
    "변환기 확인",
    "세정장치 확인",
    "제어부확인",
    "운용프로그램확인",
    "지시외부출력부확인",
];

const codSpecificBase = [ // Renamed for clarity before mapping
    "시료 전처리부 확인",
    "시약 주입부 확인",
    "가열분해부 확인",
    "측정부/검출부 확인",
    "제어부 확인",
    "운용프로그램 확인", // This will be mapped
    "지시외부출력부 확인",
];

// "표시사항확인" comes first, then "정도검사 증명서"
const commonSuffixItems = ["표시사항확인", "정도검사 증명서"];

// Create mapped arrays once for clarity
const tnTpSpecificMapped = tnTpSpecificBase.map(item => item.replace("시약저장부 확인", "시약저장부확인"));
const codSpecificMapped = codSpecificBase.map(item => item.replace("운용프로그램 확인", "운용프로그램확인"));


export const CHECKLIST_DEFINITIONS: Record<MainStructuralItemKey, string[]> = {
  TOC: [...baseChecklistItems, ...tocSpecific, ...commonSuffixItems],
  TN: [...baseChecklistItems, ...tnTpSpecificMapped, ...commonSuffixItems],
  TP: [...baseChecklistItems, ...tnTpSpecificMapped, ...commonSuffixItems],
  SS: [...baseChecklistItems, ...ssSpecific, ...commonSuffixItems],
  PH: [...baseChecklistItems, ...phSpecific, ...commonSuffixItems],
  DO: [...baseChecklistItems, ...doSpecific, ...commonSuffixItems],
  COD: [...baseChecklistItems, ...codSpecificMapped, ...commonSuffixItems],
};


export const ANALYSIS_IMPOSSIBLE_OPTION = "판별 불가 (사진 정보 없음)";
export const OTHER_DIRECT_INPUT_OPTION = "기타 (직접입력)";


export const MEASUREMENT_METHOD_OPTIONS: Partial<Record<MainStructuralItemKey, string[]>> = {
  COD: ["100 ℃ 과망간산칼륨법 산성", "100 ℃ 과망간산칼륨법 알칼리성", OTHER_DIRECT_INPUT_OPTION],
  TOC: ["습식화학산화방식", "연소산화방식", OTHER_DIRECT_INPUT_OPTION],
  TN: ["자외선 흡수법", "카드뮴 환원법", OTHER_DIRECT_INPUT_OPTION],
  TP: ["흡수분광법", "이온전극법", OTHER_DIRECT_INPUT_OPTION],
  SS: ["광산란법", "중량검출법", OTHER_DIRECT_INPUT_OPTION],
  PH: ["유리전극법", "안티몬전극법", OTHER_DIRECT_INPUT_OPTION],
  DO: ["격막형 포라로그라프식", "격막형 갈바니 전지식", "광학식", OTHER_DIRECT_INPUT_OPTION],
};

export const MEASUREMENT_RANGE_OPTIONS: Partial<Record<MainStructuralItemKey, string[]>> = {
  TOC: ["0-10 mg/L", "0-50 mg/L", "0-200 mg/L", "0-225 mg/L", OTHER_DIRECT_INPUT_OPTION],
  TN: ["0-10 mg/L", "0-50 mg/L", "0-100 mg/L", OTHER_DIRECT_INPUT_OPTION],
  TP: ["0-1 mg/L", "0-5 mg/L", "0-20 mg/L", OTHER_DIRECT_INPUT_OPTION],
  SS: ["0-100 mg/L", "0-300 mg/L", "0-1000 mg/L", OTHER_DIRECT_INPUT_OPTION],
  PH: ["pH 0-14", OTHER_DIRECT_INPUT_OPTION],
  DO: ["0-20 mg/L", OTHER_DIRECT_INPUT_OPTION],
  COD: ["0-50 mg/L", "0-200 mg/L", "0-1000 mg/L", OTHER_DIRECT_INPUT_OPTION],
};

export const RECEIPT_NUMBER_OPTIONS: string[] = [
  "25-000000-01-1",
  "25-000000-01-2",
  "25-000000-01-3",
  "25-000000-01-4",
  "25-000000-01-5",
  "25-000000-01-6",
];

export type ChecklistStatus = '적합' | '부적합' | '선택 안됨';

// New type for "정도검사 증명서" status options
export type CertificatePresenceStatus = 'not_selected' | 'present' | 'initial_new' | 'reissued_lost';

// Data stored in notes for "정도검사 증명서"
export interface CertificateDetails {
  presence: CertificatePresenceStatus;
  productName?: string; // 품명 (기기명칭/모델명)
  manufacturer?: string; // 제작사
  serialNumber?: string; // 제작번호 (기기번호)
  typeApprovalNumber?: string; // 형식승인번호 (기존: number)
  // certificateNumber?: string; // 증명서 자체 번호 (예: 21-018279-02-77) - REMOVED
  inspectionDate?: string; // 검사일자 (YYYY-MM-DD format)
  validity?: string; // 유효기간
  previousReceiptNumber?: string; // 직전 접수번호
  specialNotes?: string; // 특이사항
}

// Data for each checklist item in a StructuralJob
export interface StructuralCheckSubItemData {
  status: ChecklistStatus;
  notes?: string; // For "정도검사 증명서", this is JSON. For "표시사항확인", this is JSON. For others, plain text.
  confirmedAt: string | null;
  specialNotes?: string; // Additional special notes, applicable for "표시사항확인" and "정도검사 증명서" (where it's part of CertificateDetails)
}