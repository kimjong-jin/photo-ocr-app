import React from 'react';
import AnalysisPage from './components/analysis/analysisPage';
import type { PhotoLogJob } from './shared/types';

interface PhotoLogPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  siteLocation: string;
  onDeleteJob: (jobId: string) => void;
}

const PhotoLogPage: React.FC<PhotoLogPageProps> = (props) => {
  return (
    <AnalysisPage
      {...props}
      pageTitle="수질 분석 (P1)"
      pageType="PhotoLog"
      showRangeDifferenceDisplay={true}
      showAutoAssignIdentifiers={true}
    />
  );
};

export default PhotoLogPage;
