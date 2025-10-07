export interface ChannelInfo {
  id: string;
  name: string;
  unit: string;
}

export interface DataPoint {
  timestamp: Date;
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
    [key: string]: any; // For dynamic PH points like 7A, 4A
}

export type SensorType = '먹는물 (TU/Cl)' | '수질 (SS)' | '수질 (PH)';

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
    rangeSelection?: {
        start: { timestamp: Date; value: number };
        end: { timestamp: Date; value: number };
    } | null;
    sensorType: SensorType;
}
