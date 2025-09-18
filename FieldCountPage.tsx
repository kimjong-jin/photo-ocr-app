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
  // FIX: Add missing siteName and siteLocation props required by AnalysisPage
  siteName: string;
  siteLocation: string;
}

const FieldCountPage: React.FC<FieldCountPageProps> = (props) => {
  return (
    <AnalysisPage
      {...props}
      pageTitle="현장 계수 (P2)"
      pageType="FieldCount"
      showRangeDifferenceDisplay={true}
      showAutoAssignIdentifiers={false}
    />
  );
};

export default FieldCountPage;
