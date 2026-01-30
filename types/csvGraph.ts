
// Interfaces for parsed data
export interface ChannelInfo {
  id: string;
  name: string;
  unit: string;
}

export interface DataPoint {
  timestamp: Date;         // 시각적 표시용 (보정된 시간)
  originalTime?: Date;    // 실제 측정 시간 (툴팁/데이터용)
  values: (number | null)[];
}

export interface ParsedCsvData {
  channels: ChannelInfo[];
  data: DataPoint[];
  fileName: string;
  measurementRange?: number;
}

// Interfaces for Range Analysis
export interface RangeSelection {
  start: { timestamp: Date; value: number } | null;
  end: { timestamp: Date; value: number } | null;
}

export interface AnalysisResult {
  id: string; // For React keys
  name?: string; // For auto-analysis results
  min: number;
  max: number;
  diff: number;
  startTime: Date;
  endTime: Date;
}

export interface ChannelAnalysisState {
  isAnalyzing: boolean;
  selection: RangeSelection;
  results: AnalysisResult[];
}

// AI Analysis interfaces
export interface AiAnalysisPoint {
    timestamp: string;
    value: number;
}
export interface AiPhase {
    name: string;
    startTime: string;
    endTime: string;
}
export interface AiAnalysisResult {
    phases?: AiPhase[];
    z1?: AiAnalysisPoint;
    z2?: AiAnalysisPoint;
    s1?: AiAnalysisPoint;
    s2?: AiAnalysisPoint;
    z3?: AiAnalysisPoint;
    z4?: AiAnalysisPoint;
    s3?: AiAnalysisPoint;
    s4?: AiAnalysisPoint;
    z5?: AiAnalysisPoint;
    s5?: AiAnalysisPoint;
    m1?: AiAnalysisPoint;
    m2?: AiAnalysisPoint; // For SS
    m3?: AiAnalysisPoint; // For SS
    현장1?: AiAnalysisPoint;
    현장2?: AiAnalysisPoint;
    responseTimeInSeconds?: number;
    responseStartPoint?: AiAnalysisPoint;
    responseEndPoint?: AiAnalysisPoint;
    responseError?: string;
    // For PH
    identifiedPatternNumber?: number;
    isReagent?: boolean;
    [key: string]: any; // For dynamic labels like (A)_4_1, S_1, etc.
}

export type SensorType = 'SS' | 'PH' | 'TU' | 'Cl' | 'DO';

export interface CsvGraphJob {
    id: string;
    receiptNumber: string;
    fileName: string | null;
    parsedData: ParsedCsvData | null; // This is not saved, it's transient
    channelAnalysis: Record<string, ChannelAnalysisState>;
    autoMinMaxResults: AnalysisResult[] | null; // For auto max/min analysis
    selectedChannelId: string | null;
    timeRangeInMs: 'all' | number;
    viewEndTimestamp: number | null;
    submissionStatus: 'idle' | 'sending' | 'success' | 'error';
    submissionMessage?: string;
    aiPhaseAnalysisResult?: AiPhase[] | null;
    isAiPhaseAnalyzing?: boolean;
    aiPhaseAnalysisError?: string | null;
    aiAnalysisResult?: AiAnalysisResult | null;
    isAiAnalyzing?: boolean;
    aiAnalysisError?: string | null;
    excludeResponseTime?: boolean;
    isRangeSelecting?: boolean;
    isMaxMinMode?: boolean; // Added to distinguish manual point placement from range selection
    rangeSelection?: {
        start: { timestamp: Date; value: number };
        end: { timestamp: Date; value: number };
    } | null;
    sensorType: SensorType;
}
