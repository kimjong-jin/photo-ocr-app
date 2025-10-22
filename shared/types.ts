// ❌ import 금지: StructuralChecklists를 여기서 가져오면 순환 발생
// import { MainStructuralItemKey, StructuralCheckSubItemData } from './StructuralChecklists';

// 여기에 타입을 직접 선언
export type MainStructuralItemKey = 'TN' | 'TP' | 'TOC' | 'PH' | 'TU' | 'Cl';

export type ChecklistStatus = '선택 안됨' | '적합' | '부적합';

export interface StructuralCheckSubItemData {
  status: ChecklistStatus;
  notes?: string;
  specialNotes?: string;
  confirmedAt?: string | null;
}

// ⬇️ 네가 가진 기존 타입들 계속 유지
import type { ImageInfo as BaseImageInfo } from '../components/ImageInput';
import type { RangeResults } from '../components/RangeDifferenceDisplay';

export interface JobPhoto extends BaseImageInfo {
  uid: string;
}

export interface ExtractedEntry {
  id: string;
  time: string;
  value: string;
  valueTP?: string;
  identifier?: string;
  identifierTP?: string;
  isRuleMatched?: boolean;
}

export interface ConcentrationBoundaries {
  overallMin: number;
  overallMax: number;
  span: number;
  boundary1: number;
  boundary2: number;
}

export interface PhotoLogJob {
  id: string;
  receiptNumber: string;
  siteLocation: string;
  selectedItem: string;
  photos: JobPhoto[];
  photoComments: Record<string, string>;
  processedOcrData: ExtractedEntry[] | null;
  rangeDifferenceResults: RangeResults | null;
  concentrationBoundaries: ConcentrationBoundaries | null;
  decimalPlaces: number;
  details: string;
  decimalPlacesCl?: number;
  ktlJsonPreview: string | null;
  draftJsonPreview: string | null;
  submissionStatus: 'idle' | 'sending' | 'success' | 'error';
  submissionMessage?: string;
  inspectionStartDate?: string;
  inspectionEndDate?: string;
}

export interface StructuralJob {
  id: string;
  receiptNumber: string;
  mainItemKey: MainStructuralItemKey;
  checklistData: Record<string, StructuralCheckSubItemData>;
  photos: JobPhoto[];
  photoComments: Record<string, string>;
  postInspectionDate: string;
  postInspectionDateConfirmedAt: string | null;
  submissionStatus: 'idle' | 'sending' | 'success' | 'error';
  submissionMessage?: string;
}
