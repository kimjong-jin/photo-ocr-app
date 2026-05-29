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
  // 현장 계수 별도 분석 (P2에서 추가 분석 시 사용)
  fieldCountPhotos?: JobPhoto[];
  fieldCountPhotoComments?: Record<string, string>;
  fieldCountData?: ExtractedEntry[] | null;
  fieldCountAnalyzedAt?: string; // 분석 시각
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

// ── 추가 사진자료 ─────────────────────────────────────────
export type ExtraPhotoType = '기록부' | '교정값' | '참고자료' | '기타';

/** 추가 사진자료 항목 (React state용)
 *  - file: 원본 File 객체 (단일 소스)
 *  - previewUrl: URL.createObjectURL(file) - 화면 표시 전용, 저장 안 함
 *  - base64는 state에 보관하지 않고 캐시 기록 / A4 생성 시점에만 일시 변환
 */
export interface ExtraPhotoItem {
  uid: string;
  receiptNumber: string;
  photoType: ExtraPhotoType;
  comment: string;
  file: File;
  previewUrl: string;
  order: number;
}
