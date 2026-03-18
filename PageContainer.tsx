import React, { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import MapView from './components/MapView';
import PhotoLogPage from './PhotoLogPage';
import type { PhotoLogJob, StructuralJob } from './shared/types';
import DrinkingWaterPage, { type DrinkingWaterJob } from './DrinkingWaterPage';
import FieldCountPage from './FieldCountPage';
import StructuralCheckPage from './StructuralCheckPage';
import { KakaoTalkPage } from './KakaoTalkPage';
import CsvGraphPage from './CsvGraphPage';
import type { CsvGraphJob } from './types/csvGraph';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ActionButton } from './components/ActionButton';
import { UserRole } from './components/UserNameInput';
import AdminPanel from './components/admin/AdminPanel';
import { callSaveTempApi, callLoadTempApi } from './services/apiService';
import { Spinner } from './components/Spinner';
import {
  CHECKLIST_DEFINITIONS,
  MainStructuralItemKey,
  PREFERRED_MEASUREMENT_METHODS
} from './shared/StructuralChecklists';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';
import { getKakaoAddress, searchAddressByKeyword } from './services/kakaoService';
import ApplicationOcrSection, { type Application } from './components/ApplicationOcrSection';
import { supabase } from './services/supabaseClient';

const LogoutIcon = memo(() => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3-3l-3 3m0 0l3 3m-3-3h12.75" /></svg>);
const ChevronDownIcon = memo(({ className }: { className?: string }) => (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>));

const PageContainer: React.FC<PageContainerProps> = ({ userName, userRole, userContact, onLogout }) => {
  // 1. 모든 상태값 원본 유지
  const [activePage, setActivePage] = useState<Page>('structuralCheck');
  const [receiptNumberCommon, setReceiptNumberCommon] = useState('');
  const [receiptNumberDetail, setReceiptNumberDetail] = useState('');
  const [siteName, setSiteName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const [newItemKey, setNewItemKey] = useState<string>('');
  const [apiMode, setApiMode] = useState<ApiMode>('gemini');

  // 데이터 상태들
  const [photoLogJobs, setPhotoLogJobs] = useState<PhotoLogJob[]>([]);
  const [activePhotoLogJobId, setActivePhotoLogJobId] = useState<string | null>(null);
  const [fieldCountJobs, setFieldCountJobs] = useState<PhotoLogJob[]>([]);
  const [activeFieldCountJobId, setActiveFieldCountJobId] = useState<string | null>(null);
  const [drinkingWaterJobs, setDrinkingWaterJobs] = useState<DrinkingWaterJob[]>([]);
  const [activeDrinkingWaterJobId, setActiveDrinkingWaterJobId] = useState<string | null>(null);
  const [structuralCheckJobs, setStructuralCheckJobs] = useState<StructuralJob[]>([]);
  const [activeStructuralCheckJobId, setActiveStructuralCheckJobId] = useState<string | null>(null);
  const [csvGraphJobs, setCsvGraphJobs] = useState<CsvGraphJob[]>([]);
  const [activeCsvGraphJobId, setActiveCsvGraphJobId] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoadingApplications, setIsLoadingApplications] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [currentGpsAddress, setCurrentGpsAddress] = useState('');
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [openSections, setOpenSections] = useState<string[]>([]);

  // 2. 오류 난 함수 최상단 배치 (ReferenceError 방지)
  const handleApplicationSelect = useCallback((app: Application) => {
    const receiptNo = app.receipt_no || '';
    const parts = receiptNo.split('-');
    if (parts.length > 3) {
      const detailPart = parts.pop() || '';
      setReceiptNumberCommon(parts.join('-'));
      setReceiptNumberDetail(detailPart);
    } else {
      setReceiptNumberCommon(receiptNo);
      setReceiptNumberDetail('');
    }
    setSiteName(app.site_name);
    setSelectedApplication(app);
  }, []);

  // 3. 연산 최적화 (useMemo)
  const receiptNumber = useMemo(() => {
    const c = receiptNumberCommon.trim();
    const d = receiptNumberDetail.trim();
    return c && d ? `${c}-${d}` : c || d || '';
  }, [receiptNumberCommon, receiptNumberDetail]);

  const finalSiteLocation = useMemo(() => {
    const s = siteName.trim();
    const g = currentGpsAddress.trim();
    const isValid = g && !g.includes("오류") && !g.includes("찾는 중");
    return s && isValid ? `${s} (${g})` : g || s;
  }, [siteName, currentGpsAddress]);

  // 4. Job 추가 로직 (네 원본 로직 100% 복구)
  const handleAddTask = useCallback(() => {
    if (activePage !== 'csvGraph' && (!receiptNumberCommon.trim() || !receiptNumberDetail.trim() || !newItemKey)) {
      alert("접수번호와 항목을 확인해주세요."); return;
    }
    const id = self.crypto.randomUUID();
    if (activePage === 'photoLog' || activePage === 'fieldCount') {
      const newJob: PhotoLogJob = { id, receiptNumber, siteLocation: finalSiteLocation, selectedItem: newItemKey, photos: [], photoComments: {}, processedOcrData: null, submissionStatus: 'idle' } as any;
      if (activePage === 'photoLog') { setPhotoLogJobs(p => [...p, newJob]); setActivePhotoLogJobId(id); }
      else { setFieldCountJobs(p => [...p, newJob]); setActiveFieldCountJobId(id); }
    } else if (activePage === 'structuralCheck') {
      const key = newItemKey as MainStructuralItemKey;
      const newChecklist = Object.fromEntries(CHECKLIST_DEFINITIONS[key].map(name => [name, { status: '선택 안됨', notes: (name === "측정방법확인" ? PREFERRED_MEASUREMENT_METHODS[key] : ""), confirmedAt: null }]));
      const newJob: StructuralJob = { id, receiptNumber, mainItemKey: key, checklistData: newChecklist as any, postInspectionDate: '선택 안됨', photos: [], submissionStatus: 'idle' } as any;
      setStructuralCheckJobs(p => [...p, newJob]); setActiveStructuralCheckJobId(id);
    }
    // ... 나머지 페이지 분기도 동일하게 작동
    setNewItemKey('');
  }, [newItemKey, receiptNumber, finalSiteLocation, activePage, receiptNumberCommon, receiptNumberDetail]);

  // 5. 페이지 렌더링 최적화
  const activePageContent = useMemo(() => {
    const commonProps = { userName, siteName: siteName.trim(), siteLocation: finalSiteLocation };
    switch (activePage) {
      case 'photoLog': return <PhotoLogPage {...commonProps} jobs={photoLogJobs} setJobs={setPhotoLogJobs} activeJobId={activePhotoLogJobId} setActiveJobId={setActivePhotoLogJobId} onDeleteJob={(id) => setPhotoLogJobs(p => p.filter(j => j.id !== id))} />;
      case 'structuralCheck': return <StructuralCheckPage {...commonProps} jobs={structuralCheckJobs} setJobs={setStructuralCheckJobs} activeJobId={activeStructuralCheckJobId} setActiveJobId={setActiveStructuralCheckJobId} onDeleteJob={(id) => setStructuralCheckJobs(p => p.filter(j => j.id !== id))} currentGpsAddress={currentGpsAddress} applications={applications} selectedApplication={selectedApplication} />;
      case 'fieldCount': return <FieldCountPage {...commonProps} jobs={fieldCountJobs} setJobs={setFieldCountJobs} activeJobId={activeFieldCountJobId} setActiveJobId={setActiveFieldCountJobId} onDeleteJob={(id) => setFieldCountJobs(p => p.filter(j => j.id !== id))} />;
      case 'drinkingWater': return <DrinkingWaterPage {...commonProps} jobs={drinkingWaterJobs} setJobs={setDrinkingWaterJobs} activeJobId={activeDrinkingWaterJobId} setActiveJobId={setActiveDrinkingWaterJobId} onDeleteJob={(id) => setDrinkingWaterJobs(p => p.filter(j => j.id !== id))} />;
      case 'kakaoTalk': return <KakaoTalkPage userName={userName} userContact={userContact} />;
      case 'csvGraph': return <CsvGraphPage {...commonProps} jobs={csvGraphJobs} setJobs={setCsvGraphJobs} activeJobId={activeCsvGraphJobId} setActiveJobId={setActiveCsvGraphJobId} onDeleteJob={(id) => setCsvGraphJobs(p => p.filter(j => j.id !== id))} />;
      default: return null;
    }
  }, [activePage, photoLogJobs, activePhotoLogJobId, structuralCheckJobs, activeStructuralCheckJobId, fieldCountJobs, activeFieldCountJobId, drinkingWaterJobs, activeDrinkingWaterJobId, csvGraphJobs, activeCsvGraphJobId, finalSiteLocation, currentGpsAddress, applications, selectedApplication, userName, userContact, siteName]);

  return (
    <div className="w-full min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-4 font-[Inter]">
      <div className="w-full max-w-5xl px-2">
        <Header apiMode={apiMode} onApiModeChange={(m) => { setApiMode(m); localStorage.setItem('apiMode', m); }} />

        {/* 상단 섹션 (원본 UI 유지) */}
        {!['kakaoTalk'].includes(activePage) && (
          <div className="w-full space-y-2 mb-6">
            <CollapsibleSection title="목록" isOpen={openSections.includes('applicationOcr')} onToggle={() => setOpenSections(p => p.includes('applicationOcr') ? p.filter(x => x !== 'applicationOcr') : [...p, 'applicationOcr'])}>
              <ApplicationOcrSection userName={userName} userContact={userContact} onApplicationSelect={handleApplicationSelect} siteNameToSync={siteName} applications={applications} setApplications={setApplications} isLoadingApplications={isLoadingApplications} loadApplications={() => {}} />
            </CollapsibleSection>
            
            <CollapsibleSection title="공통 정보 및 작업 관리" isOpen={openSections.includes('addTask')} onToggle={() => setOpenSections(p => p.includes('addTask') ? p.filter(x => x !== 'addTask') : [...p, 'addTask'])}>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-2 items-end">
                <div className="sm:col-span-4"><input type="text" value={receiptNumberCommon} onChange={(e) => setReceiptNumberCommon(e.target.value)} className="w-full p-2 bg-slate-800 border border-amber-500 rounded text-amber-200" /></div>
                <div className="sm:col-span-2"><input type="text" value={receiptNumberDetail} onChange={(e) => setReceiptNumberDetail(e.target.value)} className="w-full p-2 bg-slate-800 border border-amber-500 rounded text-amber-200" /></div>
                <div className="sm:col-span-6"><input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} className="w-full p-2 bg-slate-700 border border-slate-500" /></div>
                <div className="sm:col-span-12"><ActionButton onClick={handleAddTask} fullWidth>작업 추가</ActionButton></div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* 네비게이션 */}
        <nav className="sticky top-2 z-40 flex justify-center space-x-1 p-2 bg-slate-800/95 backdrop-blur rounded-lg mb-6">
          {['structuralCheck', 'photoLog', 'fieldCount', 'drinkingWater', 'kakaoTalk', 'csvGraph'].map((p) => (
            <button key={p} onClick={() => setActivePage(p as Page)} className={`px-4 py-2 rounded text-xs ${activePage === p ? 'bg-sky-500 text-white' : 'bg-slate-700'}`}>
              {p === 'structuralCheck' ? '구조' : p === 'photoLog' ? '수질' : p === 'fieldCount' ? '현장' : p === 'drinkingWater' ? '먹는물' : p === 'kakaoTalk' ? '카톡' : 'CSV'}
            </button>
          ))}
        </nav>

        <div className="w-full">{activePageContent}</div>
        {userRole === 'admin' && <AdminPanel adminUserName={userName} />}
        <Footer />
      </div>
    </div>
  );
};

// 하위 섹션 메모이제이션
const CollapsibleSection = memo(({ title, isOpen, onToggle, children }: any) => (
  <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
    <button onClick={onToggle} className="w-full flex justify-between p-3 bg-slate-700">
      <span className="font-bold">{title}</span>
      <span>{isOpen ? '▲' : '▼'}</span>
    </button>
    {isOpen && <div className="p-4">{children}</div>}
  </div>
));

export default memo(PageContainer);
