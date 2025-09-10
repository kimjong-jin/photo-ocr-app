export type MainStructuralItemKey =
  | 'TOC'
  | 'TN'
  | 'TP'
  | 'SS'
  | 'PH'
  | 'DO'
  | 'COD'
  | 'TU'
  | 'Cl';

export interface StructuralItemGroup {
  label: string;
  items: { key: MainStructuralItemKey; name: string }[];
}

export const STRUCTURAL_ITEM_GROUPS: StructuralItemGroup[] = [
  {
    label: '수질',
    items: [
      { key: 'TOC', name: 'TOC (총유기탄소)' },
      { key: 'TN', name: 'TN (총질소)' },
      { key: 'TP', name: 'TP (총인)' },
      { key: 'SS', name: 'SS (부유물질)' },
      { key: 'PH', name: 'pH (수소이온농도)' },
      { key: 'DO', name: 'DO (용존산소)' },
      { key: 'COD', name: 'COD (화학적산소요구량)' },
    ],
  },
  {
    label: '먹는물',
    items: [
      { key: 'TU', name: 'TU (탁도)' },
      { key: 'Cl', name: 'Cl (잔류염소)' },
    ],
  },
];

export const MAIN_STRUCTURAL_ITEMS: { key: MainStructuralItemKey; name: string }[] =
  STRUCTURAL_ITEM_GROUPS.flatMap((group) => group.items);

export const EMISSION_STANDARD_ITEM_NAME = '배출기준';
export const RESPONSE_TIME_ITEM_NAME = '응답시간';

const baseChecklistItems = ['측정범위확인', '측정방법확인'];

// ------------------- Specific Items -------------------
const tocSpecific = [
  '시료도입부확인',
  '무기 탄소제거부확인',
  '반응검출부확인',
  '운반기체공급부확인',
  '주입부확인',
  '산화반응부확인',
  '시료및증류수보급부확인',
  '시약저장부확인',
  '제어부확인',
  '운용프로그램확인',
  '지시외부출력부확인',
];

const tnTpSpecificBase = [
  '계량부확인',
  '반응부확인',
  '검출부확인',
  '시약저장부 확인',
  '제어부확인',
  '운용프로그램확인',
  '지시외부출력부확인',
];

const ssSpecific = [
  '시료도입부확인',
  '측정부확인',
  '검출부확인',
  '제어부확인',
  '운용프로그램확인',
  '지시외부출력부확인',
];

const phSpecific = [
  '센서부확인',
  '전극확인',
  '제어부확인',
  '운용프로그램확인',
  '지시외부출력부확인',
];

const doSpecific = [
  '센서부확인',
  '전극확인',
  '전극보호구확인',
  '변환기 확인',
  '세정장치 확인',
  '제어부확인',
  '운용프로그램확인',
  '지시외부출력부확인',
];

const codSpecificBase = [
  '시료 전처리부 확인',
  '시약 주입부 확인',
  '가열분해부 확인',
  '측정부/검출부 확인',
  '제어부 확인',
  '운용프로그램 확인',
  '지시외부출력부 확인',
];

const tuSpecific = [
  '이물질 방지',
  '텅스텐(400 ~ 600 nm), LED(830 ~ 890 nm), 레이져(660 ± 5 nm)',
  '세척 기능',
  '지시출력장치확인',
];

const clSpecific = ['이물질 방지', '세척 기능', '지시출력장치확인'];

const commonSuffixItems = ['표시사항확인', '정도검사 증명서'];

// Fix naming differences
const tnTpSpecificMapped = tnTpSpecificBase.map((item) =>
  item.replace('시약저장부 확인', '시약저장부확인')
);
const codSpecificMapped = codSpecificBase.map((item) =>
  item.replace('운용프로그램 확인', '운용프로그램확인')
);

// ------------------- Checklist Definitions -------------------
export const CHECKLIST_DEFINITIONS: Record<MainStructuralItemKey, string[]> = {
  TOC: [
    EMISSION_STANDARD_ITEM_NAME,
    RESPONSE_TIME_ITEM_NAME,
    ...baseChecklistItems,
    ...tocSpecific,
    ...commonSuffixItems,
  ],
  TN: [...baseChecklistItems, ...tnTpSpecificMapped, ...commonSuffixItems],
  TP: [...baseChecklistItems, ...tnTpSpecificMapped, ...commonSuffixItems],
  SS: [...baseChecklistItems, ...ssSpecific, ...commonSuffixItems],
  PH: [...baseChecklistItems, ...phSpecific, ...commonSuffixItems],
  DO: [...baseChecklistItems, ...doSpecific, ...commonSuffixItems],
  COD: [...baseChecklistItems, ...codSpecificMapped, ...commonSuffixItems],
  TU: [...baseChecklistItems, ...tuSpecific, ...commonSuffixItems, '기기번호 확인'],
  Cl: [...baseChecklistItems, ...clSpecific, ...commonSuffixItems, '기기번호 확인'],
};

// ------------------- Options -------------------
export const ANALYSIS_IMPOSSIBLE_OPTION = '판별 불가 (사진 정보 없음)';
export const OTHER_DIRECT_INPUT_OPTION = '기타 (직접입력)';

export const MEASUREMENT_METHOD_OPTIONS: Partial<Record<MainStructuralItemKey, string[]>> = {
  COD: ['100 ℃ 과망간산칼륨법 산성', '100 ℃ 과망간산칼륨법 알칼리성', OTHER_DIRECT_INPUT_OPTION],
  TOC: ['습식화학산화방식', '연소산화방식', OTHER_DIRECT_INPUT_OPTION],
  TN: ['자외선 흡수법', '카드뮴 환원법', OTHER_DIRECT_INPUT_OPTION],
  TP: ['흡수분광법', '이온전극법', OTHER_DIRECT_INPUT_OPTION],
  SS: ['광산란법', '중량검출법', OTHER_DIRECT_INPUT_OPTION],
  PH: ['유리전극법', '안티몬전극법', OTHER_DIRECT_INPUT_OPTION],
  DO: ['격막형 포라로그라프식', '격막형 갈바니 전지식', '광학식', OTHER_DIRECT_INPUT_OPTION],
  TU: ['산란된 빛 검출', OTHER_DIRECT_INPUT_OPTION],
  Cl: ['폴라로그래프전극법', '갈바닉전극법', 'DPD-비색방식', '전류방식', OTHER_DIRECT_INPUT_OPTION],
};

export const PREFERRED_MEASUREMENT_METHODS: Partial<Record<MainStructuralItemKey, string>> = {
  TN: '자외선 흡수법',
  TP: '흡수분광법',
  SS: '광산란법',
  PH: '유리전극법',
  TU: '산란된 빛 검출',
};

// ------------------- Range Options -------------------
const sortRanges = (ranges: string[]): string[] => {
  const otherIndex = ranges.indexOf(OTHER_DIRECT_INPUT_OPTION);
  let otherOption: string | null = null;
  if (otherIndex !== -1) {
    otherOption = ranges.splice(otherIndex, 1)[0];
  }

  ranges.sort((a, b) => {
    const aMatch = a.match(/^0-?(\d+)/);
    const bMatch = b.match(/^0-?(\d+)/);
    if (aMatch && bMatch) {
      return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
    }
    if (aMatch) return -1;
    if (bMatch) return 1;
    return a.localeCompare(b);
  });

  if (otherOption) ranges.push(otherOption);
  return ranges;
};

export const MEASUREMENT_RANGE_OPTIONS: Partial<Record<MainStructuralItemKey, string[]>> = {
  TOC: sortRanges(['0-10 mg/L', '0-25 mg/L', '0-40 mg/L', '0-50 mg/L', '0-100 mg/L', '0-150 mg/L', '0-200 mg/L', '0-225 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  TN: sortRanges(['0-40 mg/L', '0-50 mg/L', '0-60 mg/L', '0-100 mg/L', '0-200 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  TP: sortRanges(['0-1 mg/L', '0-1.5 mg/L', '0-2 mg/L', '0-5 mg/L', '0-10 mg/L', '0-20 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  SS: sortRanges(['0-100 mg/L', '0-200 mg/L', '0-300 mg/L', '0-500 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  PH: sortRanges(['pH 0-14', OTHER_DIRECT_INPUT_OPTION]),
  DO: sortRanges(['0-20 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  COD: sortRanges(['0-100 mg/L', '0-120 mg/L', '0-200 mg/L', OTHER_DIRECT_INPUT_OPTION]),
  TU: sortRanges(['0-4 NTU', '0-5 NTU', '0-10 NTU', '0-20 NTU', OTHER_DIRECT_INPUT_OPTION]),
  Cl: sortRanges(['0-2 mg/L', '0-5 mg/L', OTHER_DIRECT_INPUT_OPTION]),
};

export const POST_INSPECTION_DATE_OPTIONS: string[] = ['선택 안됨', '1년 후', '2년 후'];

export const RECEIPT_NUMBER_OPTIONS: string[] = [
  '25-000000-01-1',
  '25-000000-01-2',
  '25-000000-01-3',
  '25-000000-01-4',
  '25-000000-01-5',
  '25-000000-01-6',
];

// ------------------- Types -------------------
export type ChecklistStatus = '적합' | '부적합' | '선택 안됨';

export type CertificatePresenceStatus = 'not_selected' | 'present' | 'initial_new' | 'reissued_lost';

export interface CertificateDetails {
  presence: CertificatePresenceStatus;
  productName?: string;
  manufacturer?: string;
  serialNumber?: string;
  typeApprovalNumber?: string;
  inspectionDate?: string;
  validity?: string;
  previousReceiptNumber?: string;
  specialNotes?: string;
}

export interface StructuralCheckSubItemData {
  status: ChecklistStatus;
  notes?: string;
  confirmedAt: string | null;
  specialNotes?: string;
}
