
import React from 'react';
import AnalysisPage from './components/analysis/AnalysisPage';
import type { PhotoLogJob } from './shared/types';

interface PhotoLogPageProps {
  userName: string;
  jobs: PhotoLogJob[];
  setJobs: React.Dispatch<React.SetStateAction<PhotoLogJob[]>>;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  onDeleteJob: (jobId: string) => void;
  siteName: string;
  siteLocation: string;
}

const PhotoLogPage: React.FC<PhotoLogPageProps> = (props) => {
  return (
    <AnalysisPage
      {...props}
      pageTitle="수질 분석 (P2)"
      pageType="PhotoLog"
      showRangeDifferenceDisplay={true}
      showAutoAssignIdentifiers={true}
    />
  );
};

export default PhotoLogPage;
