import { ImageInfo as BaseImageInfo } from '../components/ImageInput';
import { RangeResults } from '../components/RangeDifferenceDisplay';

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
