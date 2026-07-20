
import React from 'react';
import AnalysisPage from './components/analysis/AnalysisPage';
import type { PhotoLogJob } from './shared/types';

interface FieldCountPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  onDeleteJob: (jobId: string) => void;
  siteName: string;
  siteLocation: string;
  onSaveDraft?: (receipt?: string) => void;
  onLoadDraft?: (receipt?: string) => void;
  onSaveAllDrafts?: () => void;
  onLoadAllDrafts?: () => void;
  draftMessage?: { type: 'success' | 'error'; text: string } | null;
  applications?: import('./components/ApplicationOcrSection').Application[];
  /** 추가 사진자료 모달 오픈 (AnalysisPage로 pass-through) */
  onOpenExtraPhotoModal?: (receiptNumber: string, itemName: string) => void;
  /** base 접수번호 → TOC 배출기준 (현장계수 수분석 큐 seed용) */
  emissionStandards?: Record<string, string>;
}

const FieldCountPage: React.FC<FieldCountPageProps> = (props) => {
  return (
    <AnalysisPage
      {...props}
      pageTitle="현장 계수 (P3)"
      pageType="FieldCount"
      showRangeDifferenceDisplay={true}
      showAutoAssignIdentifiers={false}
    />
  );
};

export default FieldCountPage;
