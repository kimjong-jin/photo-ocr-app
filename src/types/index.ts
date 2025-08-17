export type UserRole = 'user' | 'guest';

export interface User {
  name: string;
  role: UserRole;
  sessionId: string;
}

export interface FileWithContent {
  name: string;
  content: ArrayBuffer;
}

export interface InstitutionEntry {
  id: string;
  scheduledDateRange: string;
  inspectorName: string;
  phoneNumber: string;
  status: 'idle' | 'sending' | 'success' | 'error';
  responseMessage?: string;
}

export interface KtlWaterAnalysisPayload {
  LABVIEW_RECEIPTNO: string;
  LABVIEW_GUBN: string;
  LABVIEW_DESC: string;
  UPDATE_USER: string;
  LABVIEW_ITEM: string;
}