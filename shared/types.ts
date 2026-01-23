import { ImageInfo as BaseImageInfo } from '../components/ImageInput';
import { RangeResults } from '../components/RangeDifferenceDisplay';
import { MainStructuralItemKey, StructuralCheckSubItemData } from './StructuralChecklists';

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
  // 추가된 필드들 (일괄 전송 시 데이터 주입용)
  representative_name?: string;
  applicant_name?: string;
  applicant_phone?: string;
  maintenance_company?: string;
}
