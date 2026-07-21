// src/PageContainer.tsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import MapView from './components/MapView';
import PhotoLogPage from './PhotoLogPage';
import type { PhotoLogJob, StructuralJob } from './shared/types';
import DrinkingWaterPage, { type DrinkingWaterJob } from './DrinkingWaterPage';
import FieldCountPage from './FieldCountPage';
import StructuralCheckPage from './StructuralCheckPage';
import { KakaoTalkPage } from './KakaoTalkPage';
import { FieldAnalysisModal } from './components/FieldAnalysisModal';
import { normalizeReceiptBase } from './services/fieldQueueSeed';
import CsvGraphPage from './CsvGraphPage';
import type { CsvGraphJob } from './types/csvGraph';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ActionButton } from './components/ActionButton';
import { UserRole } from './components/UserNameInput';
import AdminPanel from './components/admin/AdminPanel';
import { callSaveTempApi, callLoadTempApi, SaveDataPayload, LoadedData, SavedValueEntry } from './services/apiService';
import { uploadPhotoToServer, downloadPhotosFromServer, deletePhotosFromServer, dedupePhotosForReceipt } from './services/photoStorageService';
import { cachePhotos, loadCachedPhotos, clearCachedPhotos, getAllCacheSummaries, type CacheSummary } from './services/photoCacheService';
import { Spinner } from './components/Spinner';
import {
  MAIN_STRUCTURAL_ITEMS,
  MainStructuralItemKey,
  STRUCTURAL_ITEM_GROUPS,
  CHECKLIST_DEFINITIONS,
  CertificateDetails,
  StructuralCheckSubItemData,
  PREFERRED_MEASUREMENT_METHODS,
  EMISSION_STANDARD_ITEM_NAME
} from './shared/StructuralChecklists';
import { ANALYSIS_ITEM_GROUPS, DRINKING_WATER_IDENTIFIERS } from './shared/constants';
import { getKakaoAddress, searchAddressByKeyword, enforceFullRegionPrefix } from './services/kakaoService';
import { getAllLocations, getAllLocationsAllUsers, saveLocation, deleteLocation, deleteLocationsByBase, reverseGeocode, getCurrentPosition, isValidReceiptId, setLocationUserName, type LocationEntry } from './services/locationService';
import ApplicationOcrSection, { type Application } from './components/ApplicationOcrSection';
import { supabase } from './services/supabaseClient';
import { getAllJobStatuses, saveJobStatus, deleteJobStatus, setSiteOverride, type JobStatusEntry } from './services/jobStatusService';
import ExtraPhotoModal from './components/ExtraPhotoModal';
import type { ExtraPhotoItem } from './shared/types';

type Page = 'photoLog' | 'drinkingWater' | 'fieldCount' | 'structuralCheck' | 'kakaoTalk' | 'csvGraph';
export type ApiMode = 'gemini' | 'vllm';

export function normalizeReceiptNumberComponent(str: string): string {
  if (!str) return '';
  // 1) Full-width numbers to half-width numbers
  let normalized = str.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  // 2) Full-width hyphens, en-dash, em-dash, minus to standard hyphen
  normalized = normalized.replace(/[－—–−]/g, '-');
  // 3) Strip all spaces and non-breaking spaces
  normalized = normalized.replace(/[\s\u00a0\u3000]/g, '');
  return normalized;
}

interface PageContainerProps {
  userName: string;
  userRole: UserRole;
  userContact: string;
  onLogout: () => void;
}

const NAV_ITEMS: { key: Page; label: string; short: string }[] = [
  { key: 'structuralCheck', label: '구조 확인 (P1)', short: 'P1' },
  { key: 'photoLog',        label: '수질 분석 (P2)', short: 'P2' },
  { key: 'fieldCount',     label: '현장 계수 (P3)', short: 'P3' },
  { key: 'drinkingWater',  label: '먹는물 분석 (P4)', short: 'P4' },
  { key: 'csvGraph',       label: 'CSV 그래프 (P5)', short: 'P5' },
];

const TASK_PAGES: Page[] = ['photoLog', 'fieldCount', 'drinkingWater', 'structuralCheck', 'csvGraph'];

const LogoutIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props} className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3-3l-3 3m0 0l3 3m-3-3h12.75" />
  </svg>
);

const SaveIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const LoadIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
  </svg>
);

const GpsIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 01-9-9 9 9 0 019-9 9 9 0 019 9 9 9 0 01-9 9z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

const SearchIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

const MapIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.5-12.75l-7.5 3L3 6.75m18 0l-7.5 3L9 6.75m12 0v12.75A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V6.75m18 0L12 9.75 3 6.75" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const PageContainer: React.FC<PageContainerProps> = ({ userName, userRole, userContact, onLogout }) => {
  const [activePage, setActivePage] = useState<Page>('structuralCheck');
  const [receiptNumberCommon, _setReceiptNumberCommon] = useState('');
  const [receiptNumberDetail, _setReceiptNumberDetail] = useState('');
  const setReceiptNumberCommon = useCallback((val: string) => {
    _setReceiptNumberCommon(normalizeReceiptNumberComponent(val));
  }, []);
  const setReceiptNumberDetail = useCallback((val: string) => {
    _setReceiptNumberDetail(normalizeReceiptNumberComponent(val).replace(/[^0-9]/g, ''));
  }, []);
  const [siteName, setSiteName] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const isSavingRef = useRef(false); // 저장 중 재저장 차단 (동기 가드 — 더블클릭 시 사진 중복 방지)
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [draftMessage, setDraftMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const draftTimerRef = useRef<number | null>(null);

  const [newItemKey, setNewItemKey] = useState<string>('');
  const [apiMode, setApiMode] = useState<ApiMode>(() => {
    const saved = localStorage.getItem('apiMode');
    return (saved === 'gemini' || saved === 'vllm') ? saved : 'gemini';
  });

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

  // ── 추가 사진자료: 접수번호 기준 공통 state ───────────────────────────
  // 기존 P1~P5 state, photoComments, 스탬프 코멘트 로직과 완전히 분리— 섞이지 않음
  const [extraPhotoMap, setExtraPhotoMap] = useState<Record<string, ExtraPhotoItem[]>>({});
  const [extraPhotoModal, setExtraPhotoModal] = useState<{
    receiptNumber: string;
    itemName: string;
  } | null>(null);

  const handleOpenExtraPhotoModal = useCallback((receiptNumber: string, itemName: string) => {
    setExtraPhotoModal({ receiptNumber, itemName });
  }, []);

  const handleExtraPhotosChange = useCallback((receiptNumber: string, photos: ExtraPhotoItem[]) => {
    setExtraPhotoMap(prev => ({ ...prev, [receiptNumber]: photos }));
  }, []);

  // ✅ stale closure 방지: 항상 최신 job 배열 참조
  const photoLogJobsRef = useRef(photoLogJobs);
  const fieldCountJobsRef = useRef(fieldCountJobs);
  const drinkingWaterJobsRef = useRef(drinkingWaterJobs);
  const structuralCheckJobsRef = useRef(structuralCheckJobs);
  useEffect(() => { photoLogJobsRef.current = photoLogJobs; }, [photoLogJobs]);
  useEffect(() => { fieldCountJobsRef.current = fieldCountJobs; }, [fieldCountJobs]);
  useEffect(() => { drinkingWaterJobsRef.current = drinkingWaterJobs; }, [drinkingWaterJobs]);
  useEffect(() => { structuralCheckJobsRef.current = structuralCheckJobs; }, [structuralCheckJobs]);

  // P1(구조확인) TOC 작업의 배출기준 → base 접수번호별 맵 (P2/P3 전송 시 현장계수 큐 seed에 사용)
  const emissionStandards = useMemo(() => {
    const map: Record<string, string> = {};
    for (const j of structuralCheckJobs) {
      if ((j as any)?.mainItemKey !== 'TOC') continue;
      const std = (j as any)?.checklistData?.[EMISSION_STANDARD_ITEM_NAME]?.notes?.trim();
      const rc = normalizeReceiptBase((j as any)?.receiptNumber || '');
      if (std && rc) map[rc] = std;
    }
    return map;
  }, [structuralCheckJobs]);

  // P1 측정범위확인 → 접수번호별 측정범위(range) 맵. 전송 시 calc_data range 저장 + 계산하기에 공급.
  // 세부(-N) 붙은 전체 접수번호 + base(-01) 둘 다 키로 넣어 어느 쪽으로 조회해도 매칭.
  const measurementRanges = useMemo(() => {
    const map: Record<string, string> = {};
    for (const j of structuralCheckJobs) {
      const rng = (j as any)?.checklistData?.['측정범위확인']?.notes?.trim();
      const rc = normalizeReceiptBase((j as any)?.receiptNumber || '');
      if (!rng || !rc) continue;
      map[rc] = rng;
      const base = rc.split('-').slice(0, 3).join('-');
      if (!map[base]) map[base] = rng;
    }
    return map;
  }, [structuralCheckJobs]);

  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoadingApplications, setIsLoadingApplications] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);

  const [currentGpsAddress, setCurrentGpsAddress] = useState('');
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locReceiptInput, setLocReceiptInput] = useState('');
  const [locDetailInput, setLocDetailInput] = useState('');
  // 세부별 입력 폼: 각 세부에 현장_세부(배수지) 명칭을 다르게 저장 (null=폼 닫힘)
  const [multiRows, setMultiRows] = useState<{ id: string; label: string }[] | null>(null);
  const [isLocSaving, setIsLocSaving] = useState(false);
  const [locFieldFilter, setLocFieldFilter] = useState<'없음' | '전체' | '수질' | '먹는물'>('없음');
  const [locYearFilter, setLocYearFilter] = useState<number | '전체'>('전체');   // 검사 년도 필터(접수번호 앞2자리)
  const [allLocations, setAllLocations] = useState<LocationEntry[]>([]);   // 지도 마커용: 전체 사용자 위치(참고)
  const [locationList, setLocationList] = useState<LocationEntry[]>([]);
  const locListScrollRef = useRef<HTMLDivElement>(null); // 저장된 위치 목록 스크롤 컨테이너 (열 때 맨 아래로)

  // 로그인한 사용자 이름을 위치 서비스에 주입 → 사용자별 위치 분리
  useEffect(() => {
    if (userName) {
      setLocationUserName(userName);
      localStorage.setItem('ktl_user_name', userName);
      getAllLocations().then(setLocationList);
    }
  }, [userName]);

  useEffect(() => { if (!userName) getAllLocations().then(setLocationList); }, []);

  const resolveCoords = async (addr: string): Promise<{ lat: number; lng: number }> => {
    let lat = coords?.lat ?? 0;
    let lng = coords?.lng ?? 0;
    if ((!lat || !lng) && addr.trim()) {
      try {
        const results = await searchAddressByKeyword(addr.trim());
        if (results && results.length > 0) {
          const parsedLat = parseFloat(results[0].y);
          const parsedLng = parseFloat(results[0].x);
          if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
            lat = parsedLat;
            lng = parsedLng;
          }
        }
      } catch (err) {
        console.warn('[클라이언트 지오코딩 실패]', err);
      }
    }
    return { lat, lng };
  };

  // 지도 마커용: 전체 사용자 위치(참고용) — 본인 목록(locationList) 변경 시마다 갱신
  useEffect(() => { getAllLocationsAllUsers().then(setAllLocations); }, [locationList]);

  const [openSections, setOpenSections] = useState<string[]>([]);

  // 위치 도우미 열면 저장된 위치 목록을 맨 아래로 스크롤(최신·높은 세부번호가 아래에 있으니 그걸 바로 보게)
  useEffect(() => {
    if (!openSections.includes('locationHelper')) return;
    const t = setTimeout(() => {
      const el = locListScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 340); // 섹션 펼침 애니메이션(300ms) 후
    return () => clearTimeout(t);
  }, [openSections, locationList]);

  // 추복 배너 상태
  const [cacheSummaries, setCacheSummaries] = useState<CacheSummary[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);
  const [showCacheList, setShowCacheList] = useState(false);
  const autoCacheTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 접수번호 일괄 변경 상태
  const [showRename, setShowRename] = useState(false);
  // 작업 목록 펼침 (기본 접힘 — 길어서 페이지가 밑으로 밀리는 것 방지)
  const [showJobList, setShowJobList] = useState(false);
  // 서버 사진 중복 정리 진행 상태
  const [dedupBusy, setDedupBusy] = useState(false);
  const [dedupProgress, setDedupProgress] = useState<string | null>(null);
  const [showKakaoTalkModal, setShowKakaoTalkModal] = useState(false);
  const [showFieldAnalysis, setShowFieldAnalysis] = useState(false);

  const [renameOld, setRenameOld] = useState('');
  const [renameNew, setRenameNew] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // 접수번호 목록 페이지네이션
  const [receiptListPageSize, setReceiptListPageSize] = useState<4 | 8>(4);
  const [receiptListPage, setReceiptListPage] = useState(0);
  const [jobStatuses, setJobStatuses] = useState<JobStatusEntry[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!draftMessage) return;
    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    draftTimerRef.current = window.setTimeout(() => setDraftMessage(null), 4000);
    return () => {
      if (draftTimerRef.current) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [draftMessage]);

  // 앱 시작 시 IndexedDB 캐시 확인 → 복구 배너 표시
  useEffect(() => {
    getAllCacheSummaries()
      .then(summaries => { if (summaries.length > 0) setCacheSummaries(summaries); })
      .catch(() => {});
  }, []);

  // 작업 상태 초기 로드 - 본인(userName) 자료만
  useEffect(() => {
    if (!userName) return;
    getAllJobStatuses(userName)
      .then(setJobStatuses)
      .catch(() => {});
  }, [userName]);

  // ── Heartbeat: 2분 간격 세션 갱신 + 화면 복귀 시 즉시 확인 ─────────────────
  useEffect(() => {
    if (!userName) return;

    // 브라우저 세션 ID (localStorage 영속 - 재로드 후에도 동일 세션으로 추적)
    let sessionId = localStorage.getItem('ktl_session_id');
    if (!sessionId) {
      sessionId = self.crypto.randomUUID();
      localStorage.setItem('ktl_session_id', sessionId);
    }
    const sid = sessionId;

    const sendPing = async () => {
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, userName }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.forceLogout) {
            // 관리자 강제 종료: 알림 후 실제 로그아웃 (작업 IndexedDB 캐시는 onLogout이 건드리지 않아 보존됨)
            alert('관리자에 의해 세션이 종료되었습니다. 작업 내용은 캐시에 보존됩니다.');
            onLogout();
          }
        }
      } catch {
        // ping 실패는 조용히 무시 (네트워크 일시 불안정)
      }
    };

    sendPing(); // 로그인 즉시 1회 등록
    const intervalId = setInterval(sendPing, 1 * 60 * 1000); // 1분 간격 (끊김 방지)

    // iOS Safari 백그라운드→복귀 시 즉시 세션 확인
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sendPing();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 네트워크 복구 시 즉시 재연결 ping
    const onOnline = () => { sendPing(); };
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [userName]);


  const savedStatusRef = React.useRef<Set<string>>(new Set());

  // ── KTL 전송 성공 감지 → job_status + location 자동 저장 (1회만) ──
  useEffect(() => {
    const PAGE_JOB_MAP: { jobs: { receiptNumber: string; submissionStatus?: string }[]; key: 'p1Sent' | 'p2Sent' | 'p3Sent' | 'p4Sent' | 'p5Sent' }[] = [
      { jobs: structuralCheckJobs as any[], key: 'p1Sent' },
      { jobs: photoLogJobs       as any[], key: 'p2Sent' },
      { jobs: fieldCountJobs     as any[], key: 'p3Sent' },
      { jobs: drinkingWaterJobs  as any[], key: 'p4Sent' },
      { jobs: csvGraphJobs       as any[], key: 'p5Sent' },
    ];

    PAGE_JOB_MAP.forEach(({ jobs, key }) => {
      jobs.forEach(job => {
        if (job.submissionStatus !== 'success') return;
        const rn = job.receiptNumber;
        if (!rn || !userName) return;

        const cacheKey = `${rn}::${key}`;
        if (savedStatusRef.current.has(cacheKey)) return; // 이미 저장함
        savedStatusRef.current.add(cacheKey);

        // 현장명: job별 siteLocation 우선, 없으면 전역 siteName
        const jobSiteName = (job as any).siteLocation || (job as any).site || siteName || '';

        setJobStatuses(prev => {
          const existing = prev.find(s => s.receiptNo === rn);
          if (existing && !!(existing[key])) return prev; // 이미 true면 스킵

          const updated: JobStatusEntry = {
            receiptNo: rn,
            userName,
            p1Sent: existing?.p1Sent ?? false,
            p2Sent: existing?.p2Sent ?? false,
            p3Sent: existing?.p3Sent ?? false,
            p4Sent: existing?.p4Sent ?? false,
            p5Sent: existing?.p5Sent ?? false,
            updatedAt: Date.now(),
            [key]: true,
            ...(jobSiteName ? { siteName: jobSiteName } : {}),
          };
          saveJobStatus(updated).catch(() => {});
          const idx = prev.findIndex(s => s.receiptNo === rn);
          if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
          return [...prev, updated];
        });

        // ✅ Claydox 전송 성공 시 주소도 자동 저장 (currentGpsAddress 있을 때만)
        if (currentGpsAddress.trim()) {
          const baseId = rn.replace(/-\d+$/, '') || rn;
          saveLocation({
            id: baseId,
            address: currentGpsAddress.trim(),
            lat: coords?.lat ?? 0,
            lng: coords?.lng ?? 0,
            savedAt: Date.now(),
            siteName: jobSiteName || undefined,
          }).catch(() => {});
        }
      });
    });
  }, [structuralCheckJobs, photoLogJobs, fieldCountJobs, drinkingWaterJobs, csvGraphJobs, userName, siteName, currentGpsAddress, coords]);


  // 사진 변경 시 자동 IndexedDB 백업 (1.5초 debounce)
  useEffect(() => {
    if (autoCacheTimer.current) clearTimeout(autoCacheTimer.current);
    autoCacheTimer.current = setTimeout(async () => {
      try {
        const allJobs = [
          ...photoLogJobs.map(j => ({ job: j, code: 'P2' as const })),
          ...fieldCountJobs.map(j => ({ job: j, code: 'P3' as const })),
          ...drinkingWaterJobs.map(j => ({ job: j as any, code: 'P4' as const })),
          ...structuralCheckJobs.map(j => ({ job: j as any, code: 'P1' as const })),
        ];
        for (const { job, code } of allJobs) {
          if (job.receiptNumber && (job.photos || []).length > 0) {
            await cachePhotos(job.receiptNumber, code, job.photos || [], job.photoComments || {});
          }
        }
      } catch (e) { /* 캐시 실패는 무시 */ }
    }, 1500);
    return () => { if (autoCacheTimer.current) clearTimeout(autoCacheTimer.current); };
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs]);

  // 코드 캐시 사진를 메모리에 불러오고 해당 코드를 배너에서 제거
  const handleRecoverCache = useCallback(async (summary: CacheSummary) => {
    setIsRecovering(true);
    try {
      const cached = await loadCachedPhotos(summary.receiptNumber, summary.pageCode as any);
      if (cached.length === 0) { setCacheSummaries(prev => prev.filter(s => !(s.receiptNumber === summary.receiptNumber && s.pageCode === summary.pageCode))); return; }
      const photos = cached.map(c => ({ uid: c.uid, base64: c.base64, mimeType: c.mimeType, file: { name: c.fileName, size: 0, type: c.mimeType } as File }));
      const comments = Object.fromEntries(cached.filter(c => c.comment).map(c => [c.uid, c.comment!]));
      if (summary.pageCode === 'P2') setPhotoLogJobs(prev => prev.map(j => j.receiptNumber === summary.receiptNumber ? { ...j, photos: [...(j.photos||[]), ...photos.filter(p => !(j.photos||[]).find(e => e.uid === p.uid))], photoComments: { ...j.photoComments, ...comments } } : j));
      else if (summary.pageCode === 'P3') setFieldCountJobs(prev => prev.map(j => j.receiptNumber === summary.receiptNumber ? { ...j, photos: [...(j.photos||[]), ...photos.filter(p => !(j.photos||[]).find(e => e.uid === p.uid))], photoComments: { ...j.photoComments, ...comments } } : j));
      else if (summary.pageCode === 'P1') setStructuralCheckJobs(prev => prev.map(j => j.receiptNumber === summary.receiptNumber ? { ...j, photos: [...(j.photos||[]), ...photos.filter(p => !(j.photos||[]).find(e => e.uid === p.uid))], photoComments: { ...j.photoComments, ...comments } } : j));
      else if (summary.pageCode === 'P4') setDrinkingWaterJobs(prev => prev.map(j => j.receiptNumber === summary.receiptNumber ? { ...j, photos: [...((j as any).photos||[]), ...photos.filter(p => !((j as any).photos||[]).find((e: any) => e.uid === p.uid))] } as any : j));
      setCacheSummaries(prev => prev.filter(s => !(s.receiptNumber === summary.receiptNumber && s.pageCode === summary.pageCode)));
      setDraftMessage({ type: 'success', text: `케시로부터 ${cached.length}장 복구 완료 (접수: ${summary.receiptNumber}, ${summary.pageCode})` });
    } catch (e: any) {
      setDraftMessage({ type: 'error', text: `복구 실패: ${e.message}` });
    } finally {
      setIsRecovering(false);
    }
  }, []);

  /** 접수번호 일괄 변경: startsWith 매칭 → 모든 job 배열 일괄 교체 */
  const handleRenameReceipt = useCallback(async () => {
    const oldP = renameOld.trim();
    const newP = renameNew.trim();
    if (!oldP || !newP) { setDraftMessage({ type: 'error', text: '기존/신규 번호를 모두 입력하세요.' }); return; }
    if (oldP === newP) { setDraftMessage({ type: 'error', text: '기존과 신규 번호가 동일합니다.' }); return; }

    const matches = (r: string) => r === oldP || r.startsWith(oldP + '-');
    const replace = (r: string) => newP + r.slice(oldP.length);

    const allJobs = [
      ...photoLogJobs, ...fieldCountJobs,
      ...(drinkingWaterJobs as any[]), ...(structuralCheckJobs as any[]), ...(csvGraphJobs as any[])
    ];
    const affected = allJobs.filter(j => matches(j.receiptNumber));
    if (affected.length === 0) {
      setDraftMessage({ type: 'error', text: `'${oldP}'로 시작하는 작업이 없습니다.` });
      return;
    }

    const preview = affected.slice(0, 3).map(j => `${j.receiptNumber} → ${replace(j.receiptNumber)}`).join('\n');
    const more = affected.length > 3 ? `\n외 ${affected.length - 3}건` : '';
    if (!window.confirm(`${affected.length}건을 변경합니다.\n\n${preview}${more}\n\n진행하시겠습니까?\n(서버 반영은 저장 버튼을 따로 눌러주세요)`)) return;

    setIsRenaming(true);
    try {
      setPhotoLogJobs(prev => prev.map(j => matches(j.receiptNumber) ? { ...j, receiptNumber: replace(j.receiptNumber) } : j));
      setFieldCountJobs(prev => prev.map(j => matches(j.receiptNumber) ? { ...j, receiptNumber: replace(j.receiptNumber) } : j));
      setDrinkingWaterJobs(prev => prev.map(j => matches(j.receiptNumber) ? { ...j, receiptNumber: replace(j.receiptNumber) } : j));
      setStructuralCheckJobs(prev => prev.map(j => matches(j.receiptNumber) ? { ...j, receiptNumber: replace(j.receiptNumber) } : j));
      setCsvGraphJobs(prev => prev.map(j => matches((j as any).receiptNumber) ? { ...j, receiptNumber: replace((j as any).receiptNumber) } : j) as any);

      const oldReceipts = Array.from(new Set(affected.map(j => j.receiptNumber)));
      await Promise.allSettled(oldReceipts.map(r => deletePhotosFromServer(r)));

      setDraftMessage({ type: 'success', text: `${affected.length}건 변경 완료. '저장' 버튼으로 서버에 반영하세요.` });
      setShowRename(false);
      setRenameOld('');
      setRenameNew('');
    } catch (e: any) {
      setDraftMessage({ type: 'error', text: `변경 실패: ${e.message}` });
    } finally {
      setIsRenaming(false);
    }
  }, [renameOld, renameNew, photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const loadApplications = useCallback(async (showError?: (msg: string) => void) => {
    if (!supabase) {
      if (showError) showError("데이터베이스에 연결할 수 없습니다. Supabase 설정을 확인하세요.");
      return;
    }
    setIsLoadingApplications(true);
    try {
      const { data, error: dbError } = await supabase
        .from('applications')
        .select('*')
        .eq('user_name', userName);

      if (dbError) throw dbError;

      if (data) {
        data.sort((a, b) => {
          const slotA = a.queue_slot;
          const slotB = b.queue_slot;
          if (slotA === null && slotB !== null) return 1;
          if (slotA !== null && slotB === null) return -1;
          if (slotA !== null && slotB !== null && slotA !== slotB) {
            return slotA - slotB;
          }
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setApplications(data);
      } else {
        setApplications([]);
      }
    } catch (err: any) {
      if (showError) showError('데이터를 불러오는 데 실패했습니다: ' + err.message);
      setApplications([]);
    } finally {
      setIsLoadingApplications(false);
    }
  }, [userName]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);


  const handleApiModeChange = useCallback((mode: ApiMode) => {
    setApiMode(mode);
    localStorage.setItem('apiMode', mode);
  }, []);

  const handleApplicationSelect = useCallback((app: Application) => {
    // 이미 선택된(작업중) 항목을 다시 클릭 → 해제 (목록은 맨 아래로 복귀)
    if (selectedApplication?.id === app.id) {
      setSelectedApplication(null);
      return;
    }

    const receiptNo = app.receipt_no || '';
    const parts = receiptNo.split('-');

    if (parts.length > 3) {
      const detailPart = parts.pop() || '';
      const commonPart = parts.join('-');
      setReceiptNumberCommon(commonPart);
      setReceiptNumberDetail(detailPart);
    } else {
      setReceiptNumberCommon(receiptNo);
      setReceiptNumberDetail('');
    }

    setSiteName(app.site_name);
    setSelectedApplication(app);
  }, [selectedApplication]);

  const finalSiteLocation = useMemo(() => siteName.trim(), [siteName]);

  // 관리자가 작업관리에서 지정한 현장명 override (공통정보보다 우선). 접수번호 정확/베이스 매칭, 없으면 ''.
  const overrideFor = (rn: string): string => {
    if (!rn) return '';
    const base = (x: string) => x.split('-').slice(0, 3).join('-');
    const b = base(rn);
    for (const s of jobStatuses) {
      if (s.siteOverride && (s.receiptNo === rn || base(s.receiptNo) === b)) return s.siteOverride;
    }
    return '';
  };

  // ── 위치 분야(수질/먹는물) ──────────────────────────────────
  // 항목 기준: TU·Cl·TU/CL = 먹는물, 나머지(TOC·TN·TP·SS·pH·COD·DO) = 수질. 사용자 수정(category) 우선.
  const fieldFromItem = (item?: string): '수질' | '먹는물' | '' => {
    const c = String(item || '').toUpperCase().replace(/\s/g, '');
    if (!c) return '';
    return (c === 'TU' || c === 'CL' || c === 'TU/CL') ? '먹는물' : '수질';
  };
  const itemForReceipt = (id: string): string => {
    const baseId = id.split('-').slice(0, 3).join('-');
    const j: any = [
      ...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs, ...(drinkingWaterJobs as any[]), ...(csvGraphJobs as any[]),
    ].find((j: any) => j.receiptNumber === id || j.receiptNumber?.startsWith(baseId));
    return j?.mainItemKey || j?.selectedItem || '';
  };
  const fieldOf = (loc: { id: string; category?: string }): '수질' | '먹는물' => {
    if (loc.category === '수질' || loc.category === '먹는물') return loc.category; // 사용자 수정 우선
    const byItem = fieldFromItem(itemForReceipt(loc.id));
    if (byItem) return byItem;
    return loc.id.split('-').length >= 4 ? '먹는물' : '수질'; // 폴백: 세부번호 유무
  };
  // 검사 년도 = 접수번호 앞 2자리 (26-=2026)
  const yearOfId = (id: string): number => { const yy = parseInt(String(id).slice(0, 2), 10); return isNaN(yy) ? 0 : 2000 + yy; };
  const availableYears = Array.from(new Set(allLocations.map(l => yearOfId(l.id)).filter(Boolean))).sort((a, b) => b - a);

  const toggleSection = useCallback((sectionName: string) => {
    setOpenSections(prev => prev.includes(sectionName)
      ? prev.filter(s => s !== sectionName)
      : [...prev, sectionName]
    );
  }, []);

  const handleDeletePhotoLogJob = useCallback((jobIdToDelete: string) => {
    const jobToDelete = photoLogJobs.find(j => j.id === jobIdToDelete);
    const receiptNo = jobToDelete?.receiptNumber;
    setPhotoLogJobs(prev => {
      const remaining = prev.filter(j => j.id !== jobIdToDelete);
      // 접수번호의 모든 job이 삭제되면 서버 사진도 삭제
      if (receiptNo) {
        const allRemaining = [
          ...remaining,
          ...fieldCountJobs, ...drinkingWaterJobs, ...structuralCheckJobs, ...csvGraphJobs
        ].filter(j => j.receiptNumber === receiptNo);
        if (allRemaining.length === 0) {
          deletePhotosFromServer(receiptNo).catch(e => console.warn('[사진삭제 실패]', e.message));
          deleteLocationsByBase(receiptNo).catch(e => console.warn('[위치삭제 실패]', e.message));
        }
      }
      return remaining;
    });
    setActivePhotoLogJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const handleDeleteFieldCountJob = useCallback((jobIdToDelete: string) => {
    const jobToDelete = fieldCountJobs.find(j => j.id === jobIdToDelete);
    const receiptNo = jobToDelete?.receiptNumber;
    setFieldCountJobs(prev => {
      const remaining = prev.filter(j => j.id !== jobIdToDelete);
      if (receiptNo) {
        const allRemaining = [
          ...photoLogJobs, ...remaining,
          ...drinkingWaterJobs, ...structuralCheckJobs, ...csvGraphJobs
        ].filter(j => j.receiptNumber === receiptNo);
        if (allRemaining.length === 0) {
          deletePhotosFromServer(receiptNo).catch(e => console.warn('[사진삭제 실패]', e.message));
          deleteLocationsByBase(receiptNo).catch(e => console.warn('[위치삭제 실패]', e.message));
        }
      }
      return remaining;
    });
    setActiveFieldCountJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const handleDeleteDrinkingWaterJob = useCallback((jobIdToDelete: string) => {
    const jobToDelete = drinkingWaterJobs.find(j => j.id === jobIdToDelete);
    const receiptNo = jobToDelete?.receiptNumber;
    setDrinkingWaterJobs(prev => {
      const remaining = prev.filter(j => j.id !== jobIdToDelete);
      if (receiptNo) {
        const allRemaining = [
          ...photoLogJobs, ...fieldCountJobs, ...remaining,
          ...structuralCheckJobs, ...csvGraphJobs
        ].filter(j => j.receiptNumber === receiptNo);
        if (allRemaining.length === 0) {
          deletePhotosFromServer(receiptNo).catch(e => console.warn('[사진삭제 실패]', e.message));
          deleteLocationsByBase(receiptNo).catch(e => console.warn('[위치삭제 실패]', e.message));
        }
      }
      return remaining;
    });
    setActiveDrinkingWaterJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const handleDeleteStructuralCheckJob = useCallback((jobIdToDelete: string) => {
    const jobToDelete = structuralCheckJobs.find(j => j.id === jobIdToDelete);
    const receiptNo = jobToDelete?.receiptNumber;
    setStructuralCheckJobs(prev => {
      const remaining = prev.filter(j => j.id !== jobIdToDelete);
      if (receiptNo) {
        const allRemaining = [
          ...photoLogJobs, ...fieldCountJobs, ...drinkingWaterJobs,
          ...remaining, ...csvGraphJobs
        ].filter(j => j.receiptNumber === receiptNo);
        if (allRemaining.length === 0) {
          deletePhotosFromServer(receiptNo).catch(e => console.warn('[사진삭제 실패]', e.message));
          deleteLocationsByBase(receiptNo).catch(e => console.warn('[위치삭제 실패]', e.message));
        }
      }
      return remaining;
    });
    setActiveStructuralCheckJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const handleDeleteCsvGraphJob = useCallback((jobIdToDelete: string) => {
    const jobToDelete = csvGraphJobs.find(j => j.id === jobIdToDelete);
    const receiptNo = jobToDelete?.receiptNumber;
    setCsvGraphJobs(prev => {
      const remaining = prev.filter(j => j.id !== jobIdToDelete);
      if (receiptNo) {
        const allRemaining = [
          ...photoLogJobs, ...fieldCountJobs, ...drinkingWaterJobs,
          ...structuralCheckJobs, ...remaining
        ].filter(j => j.receiptNumber === receiptNo);
        if (allRemaining.length === 0) {
          deletePhotosFromServer(receiptNo).catch(e => console.warn('[사진삭제 실패]', e.message));
          deleteLocationsByBase(receiptNo).catch(e => console.warn('[위치삭제 실패]', e.message));
        }
      }
      return remaining;
    });
    setActiveCsvGraphJobId(prev => (prev === jobIdToDelete ? null : prev));
  }, [photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs]);

  const receiptNumber = useMemo(() => {
    const common = receiptNumberCommon.trim();
    const detail = receiptNumberDetail.trim();
    if (!common && !detail) return '';
    if (!common) return detail;
    if (!detail) return common;
    return `${common}-${detail}`;
  }, [receiptNumberCommon, receiptNumberDetail]);

  // 접수번호가 바뀌면 위치 도우미 입력 + 저장된 위치 자동 로드
  useEffect(() => {
    if (!receiptNumber) return;
    // 수질은 현장 1곳이라 위치는 베이스(-01)로 저장 → 세부번호 떼고 채움.
    // 먹는물(TU·Cl)은 시설별 위치라 세부번호 그대로 유지.
    const fld = fieldFromItem(newItemKey) || fieldFromItem(itemForReceipt(receiptNumber));
    const locId = (fld === '먹는물') ? receiptNumber : receiptNumber.split('-').slice(0, 3).join('-');
    setLocReceiptInput(locId);

    // 저장된 목록에서 이 접수번호(또는 base)로 매칭되는 위치 자동 로드
    const exact = locationList.find(l => l.id === receiptNumber);
    const base = receiptNumber.split('-').slice(0, 3).join('-');
    const matched = exact || locationList.find(l => l.id === base);

    if (matched) {
      setCurrentGpsAddress(matched.address);
      // 주소로 카카오 재검색해서 지도 이동 (좌표가 부정확할 수 있어서)
      searchAddressByKeyword(matched.address).then(results => {
        if (results?.length > 0) {
          const lat = parseFloat(results[0].y), lng = parseFloat(results[0].x);
          if (!isNaN(lat) && !isNaN(lng)) setCoords({ lat, lng });
        } else if (matched.lat && matched.lng) {
          setCoords({ lat: matched.lat, lng: matched.lng });
        }
      }).catch(() => {
        if (matched.lat && matched.lng) setCoords({ lat: matched.lat, lng: matched.lng });
      });
    } else {
      setCurrentGpsAddress('');
      setCoords(null);
    }
  }, [receiptNumber, locationList, newItemKey]);

  // 위치 도우미: 저장된 주소 자동 복원.
  // 접수번호칸(locReceiptInput, 또는 메인 receiptNumber)에 저장된 위치가 있고 주소칸이 비어 있으면 채움.
  // → 저장 후 주소가 클리어돼도 재저장 가능(버튼 활성화). 주소가 이미 있으면(GPS/역검색/직접입력) 안 건드림.
  useEffect(() => {
    const rid = (locReceiptInput.trim() || receiptNumber || '').trim();
    if (!rid || currentGpsAddress.trim()) return;
    const base = rid.split('-').slice(0, 3).join('-');
    const matched = locationList.find(l => l.id === rid) || locationList.find(l => l.id === base);
    if (matched?.address) {
      setCurrentGpsAddress(matched.address);
      if (matched.lat && matched.lng) setCoords({ lat: matched.lat, lng: matched.lng });
    }
  }, [locReceiptInput, receiptNumber, locationList, currentGpsAddress]);

  const getReceiptNumberForSaveLoad = useCallback(() => {
    let rn: string | null = receiptNumber;
    if (activePage === 'photoLog' && activePhotoLogJobId) {
      rn = photoLogJobs.find(j => j.id === activePhotoLogJobId)?.receiptNumber || rn;
    } else if (activePage === 'fieldCount' && activeFieldCountJobId) {
      rn = fieldCountJobs.find(j => j.id === activeFieldCountJobId)?.receiptNumber || rn;
    } else if (activePage === 'drinkingWater' && activeDrinkingWaterJobId) {
      rn = drinkingWaterJobs.find(j => j.id === activeDrinkingWaterJobId)?.receiptNumber || rn;
    } else if (activePage === 'structuralCheck' && activeStructuralCheckJobId) {
      rn = structuralCheckJobs.find(j => j.id === activeStructuralCheckJobId)?.receiptNumber || rn;
    } else if (activePage === 'csvGraph' && activeCsvGraphJobId) {
      rn = csvGraphJobs.find(j => j.id === activeCsvGraphJobId)?.receiptNumber || rn;
    }
    return rn;
  }, [
    activePage, receiptNumber,
    photoLogJobs, activePhotoLogJobId,
    fieldCountJobs, activeFieldCountJobId,
    drinkingWaterJobs, activeDrinkingWaterJobId,
    structuralCheckJobs, activeStructuralCheckJobId,
    csvGraphJobs, activeCsvGraphJobId
  ]);

  /** 특정 접수번호에 해당하는 모든 job 데이터를 API payload로 조합 */
  const buildPayloadForReceipt = useCallback((receiptToSave: string) => {
    const jobsToSaveP2 = photoLogJobs.filter(j => j.receiptNumber === receiptToSave);
    const jobsToSaveP3 = fieldCountJobs.filter(j => j.receiptNumber === receiptToSave);
    const jobsToSaveP4 = drinkingWaterJobs.filter(j => j.receiptNumber === receiptToSave);
    const jobsToSaveP1 = structuralCheckJobs.filter(j => j.receiptNumber === receiptToSave);
    const jobsToSaveP6 = csvGraphJobs.filter(j => j.receiptNumber === receiptToSave);

    const allP1P2JobsForDate = [...photoLogJobs, ...fieldCountJobs].filter(j => j.receiptNumber === receiptToSave);
    const firstJobWithDates = allP1P2JobsForDate.find(j => j.inspectionStartDate);
    const inspectionStartDateToSave = firstJobWithDates?.inspectionStartDate;
    const inspectionEndDateToSave = firstJobWithDates?.inspectionEndDate;

    const allItems = new Set<string>();
    const apiPayload: SaveDataPayload['values'] = {};

    const globalMetadata = {
      site: siteName,
      gps_address: currentGpsAddress.trim() || undefined,
      inspectionStartDate: inspectionStartDateToSave,
      inspectionEndDate: inspectionEndDateToSave,
    };
    apiPayload['_global_metadata'] = {
      data: { val: JSON.stringify(globalMetadata), time: new Date().toISOString() }
    };
    allItems.add('_global_metadata');

    const p2p3Jobs = [...jobsToSaveP2, ...jobsToSaveP3];
    p2p3Jobs.forEach(job => {
      if (job.selectedItem === 'TN/TP') {
        allItems.add('TN');
        allItems.add('TP');
      } else {
        allItems.add(job.selectedItem);
      }

      // 검사 날짜 per-job 저장 (item절로 저장하여 여러 job의 날짜 각각 보존)
      const dateKey = job.selectedItem === 'TN/TP' ? 'TN' : job.selectedItem;
      if (!apiPayload[dateKey]) apiPayload[dateKey] = {};
      if (job.inspectionStartDate || job.inspectionEndDate) {
        apiPayload[dateKey]['_inspectionDates'] = {
          val: JSON.stringify({ start: job.inspectionStartDate || '', end: job.inspectionEndDate || '' }),
          time: new Date().toISOString()
        };
      }

      // OCR 데이터 전체를 JSON으로 저장 (_ocrData)
      // - identifier가 undefined여도 time/value 등 모든 필드 보존
      if (job.processedOcrData && job.processedOcrData.length > 0) {
        if (job.selectedItem === 'TN/TP') {
          if (!apiPayload['TN']) apiPayload['TN'] = {};
          apiPayload['TN']['_ocrData'] = { val: JSON.stringify(job.processedOcrData), time: new Date().toISOString() };
        } else {
          if (!apiPayload[job.selectedItem]) apiPayload[job.selectedItem] = {};
          apiPayload[job.selectedItem]['_ocrData'] = { val: JSON.stringify(job.processedOcrData), time: new Date().toISOString() };
        }
      }
    });

    jobsToSaveP4.forEach(job => {
      const itemsToProcess = job.selectedItem === 'TU/CL' ? ['TU', 'Cl'] : [job.selectedItem];
      allItems.add(job.selectedItem);
      itemsToProcess.forEach(item => allItems.add(item));
      const p3Metadata = { details: job.details, decimalPlaces: job.decimalPlaces, decimalPlacesCl: job.decimalPlacesCl };
      if (!apiPayload[job.selectedItem]) apiPayload[job.selectedItem] = {};
      apiPayload[job.selectedItem]['_p3_metadata'] = { val: JSON.stringify(p3Metadata), time: new Date().toISOString() };
      itemsToProcess.forEach(subItem => {
        if (!apiPayload[subItem]) apiPayload[subItem] = {};
        (job.processedOcrData || []).forEach(entry => {
          if (!entry.identifier || entry.identifier.includes('시작') || entry.identifier.includes('완료')) return;
          let valueSource: string | undefined;
          if (job.selectedItem === 'TU/CL') {
            valueSource = (subItem === 'TU') ? entry.value : entry.valueTP;
          } else {
            valueSource = entry.value;
          }
          if (entry.identifier && valueSource && valueSource.trim()) {
            let key = entry.identifier;
            if (subItem === 'Cl' && key === '응답시간_Cl') key = '응답시간';
            apiPayload[subItem]![key] = { val: valueSource.trim(), time: entry.time };
          }
        });
      });
    });

    jobsToSaveP1.forEach(job => {
      allItems.add(job.mainItemKey);
      const timestamp = new Date().toISOString();
      const currentItemData = apiPayload[job.mainItemKey] || {};
      apiPayload[job.mainItemKey] = {
        ...currentItemData,
        '_checklistData': { val: JSON.stringify(job.checklistData), time: timestamp },
        '_postInspectionDate': { val: job.postInspectionDate, time: timestamp }
      };
    });

    jobsToSaveP6.forEach(job => {
      const key = `_csv_${job.id}`;
      allItems.add(key);
      const dataToSave = {
        fileName: job.fileName,
        channelAnalysis: job.channelAnalysis,
        selectedChannelId: job.selectedChannelId,
        timeRangeInMs: job.timeRangeInMs,
        viewEndTimestamp: job.viewEndTimestamp,
        sensorType: job.sensorType,
      };
      apiPayload[key] = { '_data': { val: JSON.stringify(dataToSave), time: new Date().toISOString() } };
    });

    return { allItems, apiPayload };
  }, [
    photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs,
    siteName, currentGpsAddress
  ]);

  const handleSaveDraft = useCallback(async (receipt?: string) => {
    const receiptToSave = (typeof receipt === 'string' ? receipt : undefined) || getReceiptNumberForSaveLoad();
    if (!receiptToSave || !receiptToSave.trim()) {
      setDraftMessage({ type: 'error', text: '저장하려면 접수번호를 입력하세요.' });
      return;
    }

    if (isSavingRef.current) return; // 이미 저장 중 — 중복 저장(사진 2배) 방지
    isSavingRef.current = true;
    setIsSaving(true);
    setDraftMessage(null);

    try {
      const { allItems, apiPayload } = buildPayloadForReceipt(receiptToSave);

      if (allItems.size <= 1) {
        setDraftMessage({ type: 'error', text: '저장할 데이터가 없습니다.' });
        setIsSaving(false);
        isSavingRef.current = false;
        return;
      }

      await callSaveTempApi({
        receipt_no: receiptToSave,
        site: siteName,
        gps_address: currentGpsAddress.trim() || undefined,
        item: Array.from(allItems),
        user_name: userName,
        values: apiPayload,
      });

      // ✅ GPS 주소 자동 저장 (사진 0장이어도 무조건 저장)
      if (currentGpsAddress.trim() && userName) {
        const baseId = receiptToSave.replace(/-\d+$/, '') || receiptToSave;
        saveLocation({
          id: baseId,
          address: currentGpsAddress.trim(),
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
          savedAt: Date.now(),
          siteName: siteName.trim() || undefined,
        }).catch(() => {});
      }

      // ✅ 관리자 대시보드 등록: 저장 시 job_status upsert (기존 P1~P5 상태 유지)
      if (userName) {
        const existing = jobStatuses.find(s => s.receiptNo === receiptToSave);
        const itemArr = Array.from(allItems).filter(i => i !== '_global_metadata');
        const itemName = itemArr[0] || '';
        const jobEntry: JobStatusEntry = {
          receiptNo: receiptToSave,
          userName,
          itemName: itemName || existing?.itemName || '',
          p1Sent: existing?.p1Sent ?? false,
          p2Sent: existing?.p2Sent ?? false,
          p3Sent: existing?.p3Sent ?? false,
          p4Sent: existing?.p4Sent ?? false,
          p5Sent: existing?.p5Sent ?? false,
          updatedAt: Date.now(),
          ...(siteName.trim() ? { siteName: siteName.trim() } : {}),
        };
        saveJobStatus(jobEntry).catch(() => {});
        setJobStatuses(prev => {
          const idx = prev.findIndex(s => s.receiptNo === receiptToSave);
          if (idx >= 0) { const next = [...prev]; next[idx] = jobEntry; return next; }
          return [...prev, jobEntry];
        });
      }

      setDraftMessage({ type: 'success', text: `'${receiptToSave}'으로 저장되었습니다.` });

      // 저장 후 위치(주소) 자동 초기화 — 주소가 다음 작업에 잘못 따라붙는 것 방지
      setCurrentGpsAddress('');
      setCoords(null);
      setLocReceiptInput('');

      // ✅ 페이지별 사진 저장: P1~P4 독립 삭제→업로드 + userName 식별자 + 코멘트 스탬프
      // ── 사진 저장: 단일 delete-all 후 전체 업로드 (race condition 방지) ──
      // ✅ Ref를 통해 항상 최신 job 배열 사용 (stale closure 방지)

      const p1Jobs = structuralCheckJobsRef.current.filter(j => j.receiptNumber === receiptToSave);
      const p2Jobs = photoLogJobsRef.current.filter(j => j.receiptNumber === receiptToSave);
      const p3Jobs = fieldCountJobsRef.current.filter(j => j.receiptNumber === receiptToSave);
      const p4Jobs = drinkingWaterJobsRef.current.filter(j => j.receiptNumber === receiptToSave);

      const hasAnyJobs = p1Jobs.length + p2Jobs.length + p3Jobs.length + p4Jobs.length > 0;

      if (hasAnyJobs) {
        type JobLike = {
          photos?: ({ base64: string; mimeType: string; file: { name: string } } & { uid?: string })[];
          photoComments?: Record<string, string>;
          siteLocation?: string;
          selectedItem?: string;
          mainItemKey?: string;
          inspectionStartDate?: string;
          postInspectionDate?: string;
        };
        const buildFactories = (pageCode: 'P1' | 'P2' | 'P3' | 'P4', jobs: JobLike[]) =>
          jobs.flatMap(job =>
            (job.photos || []).map(photo => () => {
              const comment = photo.uid ? (job.photoComments || {})[photo.uid] : undefined;
              return uploadPhotoToServer(receiptToSave, photo, pageCode, {
                userName,
                comment,
                siteLocation: overrideFor(receiptToSave) || job.siteLocation || siteName,
                selectedItem: job.selectedItem || job.mainItemKey || pageCode,
                inspectionDate: job.inspectionStartDate || job.postInspectionDate || '',
                // 위치 자동 저장: GPS 주소가 있으면 업로드 시 서버에 저장
                address:  currentGpsAddress.trim() || undefined,
                lat:      coords?.lat,
                lng:      coords?.lng,
                siteName: overrideFor(receiptToSave) || siteName.trim() || undefined,
              }).catch(e => console.warn(`[${pageCode} 사진저장 실패]`, e.message));
            })
          );

        const allFactories = [
          ...buildFactories('P1', p1Jobs),
          ...buildFactories('P2', p2Jobs),
          ...buildFactories('P3', p3Jobs),
          ...buildFactories('P4', p4Jobs),
        ];

        // 단 한 번 전체 삭제 (userName 필터 없이 - 서버가 userName 컬럼 미지원) → 완료 후 전체 업로드
        deletePhotosFromServer(receiptToSave)
          .catch(() => {})
          .then(() => {
            if (allFactories.length === 0) return;
            return Promise.all(allFactories.map(fn => fn()))
              .then(() => setDraftMessage({ type: 'success', text: `'${receiptToSave}' 사진 ${allFactories.length}장 저장 완료` }))
              .catch(e => setDraftMessage({ type: 'error', text: `사진 저장 실패: ${e.message}` }));
          });
      }
    } catch (error: any) {
      setDraftMessage({ type: 'error', text: `저장 실패: ${error.message}` });
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [
    getReceiptNumberForSaveLoad, buildPayloadForReceipt, userName,
    siteName, currentGpsAddress, jobStatuses
  ]);

  /** 현재 메모리에 있는 모든 접수번호를 한 번에 일괄 저장 */
  const handleSaveAllDrafts = useCallback(async () => {
    const allJobs = [
      ...photoLogJobs,
      ...fieldCountJobs,
      ...drinkingWaterJobs,
      ...structuralCheckJobs,
      ...csvGraphJobs,
    ];

    const uniqueReceipts = Array.from(
      new Set(allJobs.map(j => ('receiptNumber' in j ? j.receiptNumber : (j as any).receiptNumber)).filter(Boolean))
    ) as string[];

    if (uniqueReceipts.length === 0) {
      setDraftMessage({ type: 'error', text: '저장할 작업이 없습니다.' });
      return;
    }

    if (isSavingRef.current) return; // 이미 저장 중 — 중복 저장(사진 2배) 방지
    isSavingRef.current = true;
    setIsSavingAll(true);
    setDraftMessage(null);

    const succeeded: string[] = [];
    const failed: { receipt: string; reason: string }[] = [];

    for (const receipt of uniqueReceipts) {
      try {
        const { allItems, apiPayload } = buildPayloadForReceipt(receipt);
        if (allItems.size <= 1) continue;
        await callSaveTempApi({
          receipt_no: receipt,
          site: siteName,
          gps_address: currentGpsAddress.trim() || undefined,
          item: Array.from(allItems),
          user_name: userName,
          values: apiPayload,
        });
        succeeded.push(receipt);

        // ✅ GPS 주소 자동 저장 (사진 0장이어도 무조건 저장)
        if (currentGpsAddress.trim() && userName) {
          const baseId = receipt.replace(/-\d+$/, '') || receipt;
          saveLocation({
            id: baseId,
            address: currentGpsAddress.trim(),
            lat: coords?.lat ?? 0,
            lng: coords?.lng ?? 0,
            savedAt: Date.now(),
            siteName: siteName.trim() || undefined,
          }).catch(() => {});
        }

        // ✅ 관리자 대시보드 등록: 전체 저장 시 job_status upsert (기존 P1~P5 상태 유지)
        if (userName) {
          const existingAll = jobStatuses.find(s => s.receiptNo === receipt);
          const itemArrAll = Array.from(allItems).filter(i => i !== '_global_metadata');
          const itemNameAll = itemArrAll[0] || '';
          const jobEntryAll: JobStatusEntry = {
            receiptNo: receipt,
            userName,
            itemName: itemNameAll || existingAll?.itemName || '',
            p1Sent: existingAll?.p1Sent ?? false,
            p2Sent: existingAll?.p2Sent ?? false,
            p3Sent: existingAll?.p3Sent ?? false,
            p4Sent: existingAll?.p4Sent ?? false,
            p5Sent: existingAll?.p5Sent ?? false,
            updatedAt: Date.now(),
            ...(siteName.trim() ? { siteName: siteName.trim() } : {}),
          };
          saveJobStatus(jobEntryAll).catch(() => {});
          setJobStatuses(prev => {
            const idx = prev.findIndex(s => s.receiptNo === receipt);
            if (idx >= 0) { const next = [...prev]; next[idx] = jobEntryAll; return next; }
            return [...prev, jobEntryAll];
          });
        }

        // 전체 저장: 단일 delete-all 후 전체 업로드
        const buildAllFactories = (pageCode: 'P1' | 'P2' | 'P3' | 'P4', jobs: { photos?: (({ base64: string; mimeType: string; file: { name: string } } & { uid?: string }))[], photoComments?: Record<string, string>, siteLocation?: string, selectedItem?: string, mainItemKey?: string, inspectionStartDate?: string, postInspectionDate?: string }[]) =>
          jobs.flatMap(job => (job.photos || []).map(photo => () => {
            const comment = photo.uid ? (job.photoComments || {})[photo.uid] : undefined;
            return uploadPhotoToServer(receipt, photo, pageCode, {
              userName, comment,
              siteLocation: overrideFor(receipt) || job.siteLocation || siteName,
              selectedItem: job.selectedItem || job.mainItemKey || pageCode,
              inspectionDate: job.inspectionStartDate || job.postInspectionDate || '',
              address:  currentGpsAddress.trim() || undefined,
              lat:      coords?.lat,
              lng:      coords?.lng,
              siteName: siteName.trim() || undefined,
            }).catch(e => console.warn(`[전체저장][${pageCode} 사진]`, e.message));
          }));
        const allUploadFactories = [
          ...buildAllFactories('P1', structuralCheckJobs.filter(j => j.receiptNumber === receipt)),
          ...buildAllFactories('P2', photoLogJobs.filter(j => j.receiptNumber === receipt)),
          ...buildAllFactories('P3', fieldCountJobs.filter(j => j.receiptNumber === receipt)),
          ...buildAllFactories('P4', drinkingWaterJobs.filter(j => j.receiptNumber === receipt)),
        ];
        const hasJobs = [
          ...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs, ...drinkingWaterJobs
        ].some(j => j.receiptNumber === receipt);
        if (hasJobs) {
          // 단일 저장과 동일하게 userName 필터 없이 전체 삭제 후 업로드.
          // (서버가 userName 컬럼 미지원 → userName을 붙이면 삭제가 안 돼 중복 누적되던 버그)
          deletePhotosFromServer(receipt)
            .catch(() => {})
            .then(() => {
              if (allUploadFactories.length === 0) return;
              return Promise.all(allUploadFactories.map(fn => fn()));
            });
        }
      } catch (err: any) {
        const reason = err?.message || '알 수 없는 오류';
        console.error(`[전체저장] 실패 (${receipt}):`, reason);
        failed.push({ receipt, reason });
      }
    }

    if (succeeded.length > 0) {
      // 전체 저장 후 위치(주소) 자동 초기화 — 주소가 다음 작업에 잘못 따라붙는 것 방지
      setCurrentGpsAddress('');
      setCoords(null);
      setLocReceiptInput('');
    }

    if (failed.length === 0) {
      setDraftMessage({ type: 'success', text: `전체 ${succeeded.length}건 저장 완료 (${succeeded.join(', ')})` });
    } else {
      const firstReason = failed[0].reason;
      setDraftMessage({
        type: 'error',
        text: `${succeeded.length}건 성공, ${failed.length}건 실패 — 원인: ${firstReason}`
      });
    }
    isSavingRef.current = false;
    setIsSavingAll(false);
  }, [
    photoLogJobs, fieldCountJobs, drinkingWaterJobs, structuralCheckJobs, csvGraphJobs,
    buildPayloadForReceipt, userName, siteName, currentGpsAddress, jobStatuses
  ]);

  const handleLoadDraft = useCallback(async (receipt?: string) => {
    const receiptToLoad = (typeof receipt === 'string' ? receipt : undefined) || getReceiptNumberForSaveLoad();
    if (!receiptToLoad || !receiptToLoad.trim()) {
      setDraftMessage({ type: 'error', text: '불러오려면 접수번호를 입력하세요.' });
      return;
    }

    setIsLoading(true);
    setDraftMessage(null);

    try {
      const loadedData = await callLoadTempApi(receiptToLoad, userName);
      const { receipt_no, site, item: loadedItems, values, gps_address } = loadedData;

      const receiptParts = receipt_no.split('-');
      const detail = receiptParts.pop() || '';
      const common = receiptParts.join('-');
      setReceiptNumberCommon(common);
      setReceiptNumberDetail(detail);

      let loadedSite = site;
      let loadedGpsAddress = gps_address || "";
      let loadedInspectionStartDate: string | undefined = undefined;
      let loadedInspectionEndDate: string | undefined = undefined;

      const globalMetadataRecord = values?._global_metadata;
      const globalMetadataEntry = globalMetadataRecord?.['data'];
      if (globalMetadataEntry?.val) {
        try {
          const parsedMeta = JSON.parse(globalMetadataEntry.val);
          if (typeof parsedMeta.site === 'string') loadedSite = parsedMeta.site;
          if (typeof parsedMeta.gps_address === 'string') loadedGpsAddress = parsedMeta.gps_address;
          if (typeof parsedMeta.inspectionStartDate === 'string' && parsedMeta.inspectionStartDate) {
            loadedInspectionStartDate = parsedMeta.inspectionStartDate;
          }
          if (typeof parsedMeta.inspectionEndDate === 'string' && parsedMeta.inspectionEndDate) {
            loadedInspectionEndDate = parsedMeta.inspectionEndDate;
          }
        } catch (e) {
          console.warn("[LOAD] Global metadata parsing failed:", e);
        }
      }
      setSiteName(loadedSite);
      setCurrentGpsAddress(loadedGpsAddress);

      const p1Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
      const p2Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
      const p3Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
      const p4Items = MAIN_STRUCTURAL_ITEMS.map(i => i.key);

      const available = {
        photoLog: new Set<string>(),
        fieldCount: new Set<string>(),
        drinkingWater: new Set<string>(),
        structuralCheck: new Set<string>(),
      };

      if (loadedData.values.TN && loadedData.values.TP) {
        if (p1Items.includes('TN/TP')) available.photoLog.add('TN/TP');
        if (p2Items.includes('TN/TP')) available.fieldCount.add('TN/TP');
      }

      loadedItems.forEach(item => {
        if (p1Items.includes(item)) available.photoLog.add(item);
        if (p2Items.includes(item)) available.fieldCount.add(item);
        if (p3Items.includes(item)) available.drinkingWater.add(item);
        if (p4Items.includes(item as any)) available.structuralCheck.add(item);
      });

      if (loadedData.values.TU && loadedData.values.Cl && p3Items.includes('TU/CL')) {
        available.drinkingWater.add('TU/CL');
        available.drinkingWater.delete('TU');
        available.drinkingWater.delete('Cl');
      }

      const allSelections = {
        photoLog: Array.from(available.photoLog),
        fieldCount: Array.from(available.fieldCount),
        drinkingWater: Array.from(available.drinkingWater),
        structuralCheck: Array.from(available.structuralCheck),
      };

      const createP1P2Job = (itemName: string): PhotoLogJob => {
        const reconstructedOcrData: PhotoLogJob['processedOcrData'] = [];
        if (itemName === "TN/TP") {
          const tnData = values.TN || {};
          const tpData = values.TP || {};
          const timeToEntryMap: Record<string, Partial<PhotoLogJob['processedOcrData'][0]>> = {};

          Object.entries(tnData).forEach(([id, data]) => {
            if (id === '_checklistData' || id === '_postInspectionDate') return;
            const key = (data as any).time || id;
            if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: (data as any).time };
            (timeToEntryMap[key] as any).value = (data as any).val;
            (timeToEntryMap[key] as any).identifier = id;
          });
          Object.entries(tpData).forEach(([id, data]) => {
            if (id === '_checklistData' || id === '_postInspectionDate') return;
            const key = (data as any).time || id;
            if (!timeToEntryMap[key]) timeToEntryMap[key] = { id: self.crypto.randomUUID(), time: (data as any).time };
            (timeToEntryMap[key] as any).valueTP = (data as any).val;
            (timeToEntryMap[key] as any).identifierTP = id;
          });
          Object.values(timeToEntryMap).sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(partialEntry => {
            reconstructedOcrData.push({
              id: partialEntry.id!,
              time: partialEntry.time || '',
              value: (partialEntry as any).value || '',
              valueTP: (partialEntry as any).valueTP,
              identifier: (partialEntry as any).identifier,
              identifierTP: (partialEntry as any).identifierTP,
            });
          });
        } else {
          // _ocrData (새 형식) 우선 시도 → 없으면 identifier 기반 구 형식 fallback
          const ocrDataEntry = (values as any)[itemName]?.['_ocrData'];
          if (ocrDataEntry?.val) {
            try {
              const parsed = JSON.parse(ocrDataEntry.val);
              if (Array.isArray(parsed)) reconstructedOcrData.push(...parsed);
            } catch (e) {
              console.warn('[LOAD] _ocrData 파싱 실패, 구 형식으로 재시도', e);
            }
          }
          // 구 형식 fallback (identifier가 있는 경우만)
          if (reconstructedOcrData.length === 0) {
            const itemData: Record<string, SavedValueEntry> = (values as any)[itemName] || {};
            Object.entries(itemData).sort(([, a], [, b]) => {
              const timeA = a?.time || '';
              const timeB = b?.time || '';
              return timeA.localeCompare(timeB);
            }).forEach(([id, entryData]) => {
              if (id === '_checklistData' || id === '_postInspectionDate' || id === '_ocrData' || id === '_inspectionDates') return;
              if (entryData) {
                reconstructedOcrData.push({
                  id: self.crypto.randomUUID(),
                  time: String(entryData.time),
                  value: String(entryData.val),
                  identifier: id
                });
              }
            });
          }
        }
        return {
          id: self.crypto.randomUUID(),
          receiptNumber: receipt_no,
          siteLocation: site,
          selectedItem: itemName,
          photos: [],
          photoComments: {},
          processedOcrData: reconstructedOcrData,
          rangeDifferenceResults: null,
          concentrationBoundaries: null,
          decimalPlaces: 0,
          details: '',
          decimalPlacesCl: undefined,
          ktlJsonPreview: null,
          draftJsonPreview: null,
          submissionStatus: 'idle',
          submissionMessage: undefined,
          // item절 날짜 우선, 없으면 global metadata 날짜 fallback
          inspectionStartDate: (() => {
            const dateKey = itemName === 'TN/TP' ? 'TN' : itemName;
            const datesEntry = (values as any)[dateKey]?.['_inspectionDates'];
            if (datesEntry?.val) { try { const d = JSON.parse(datesEntry.val); return d.start || loadedInspectionStartDate; } catch {} }
            return loadedInspectionStartDate;
          })(),
          inspectionEndDate: (() => {
            const dateKey = itemName === 'TN/TP' ? 'TN' : itemName;
            const datesEntry = (values as any)[dateKey]?.['_inspectionDates'];
            if (datesEntry?.val) { try { const d = JSON.parse(datesEntry.val); return d.end || loadedInspectionEndDate; } catch {} }
            return loadedInspectionEndDate;
          })()
        };
      };

      const createDrinkingWaterJob = (itemName: string, data: LoadedData): DrinkingWaterJob => {
        const { receipt_no: local_receipt_no, values: local_values } = data;
        let details = '';
        let decimalPlaces = 2;
        let decimalPlacesCl: number | undefined = undefined;

        const metadataEntry = local_values[itemName]?._p3_metadata;
        if (metadataEntry?.val) {
          try {
            const parsedMeta = JSON.parse(metadataEntry.val);
            details = parsedMeta.details || '';
            decimalPlaces = parsedMeta.decimalPlaces ?? 2;
            if (itemName === 'TU/CL') decimalPlacesCl = parsedMeta.decimalPlacesCl ?? 2;
          } catch (e) {
            console.warn(`[LOAD] P3 메타데이터 파싱 실패 (항목: ${itemName}):`, e);
          }
        }

        const reconstructedOcrData = DRINKING_WATER_IDENTIFIERS.map(identifier => {
          const entry: DrinkingWaterJob['processedOcrData'][0] = { id: self.crypto.randomUUID(), time: '', value: '', identifier };
          if (itemName === 'TU/CL') entry.valueTP = '';
          const tuData = local_values.TU || {};
          const clData = local_values.Cl || {};
          let pVal, sVal, tVal;
          if (itemName === 'TU') {
            pVal = tuData[identifier]?.val;
            tVal = tuData[identifier]?.time;
          } else if (itemName === 'Cl') {
            pVal = clData[identifier]?.val;
            tVal = clData[identifier]?.time;
          } else if (itemName === 'TU/CL') {
            pVal = tuData[identifier]?.val;
            sVal = clData[identifier]?.val;
            tVal = tuData[identifier]?.time || clData[identifier]?.time;
          }
          entry.value = pVal || '';
          if (entry.valueTP !== undefined) entry.valueTP = sVal || '';
          entry.time = tVal || '';
          return entry;
        });

        return {
          id: self.crypto.randomUUID(),
          receiptNumber: local_receipt_no,
          selectedItem: itemName,
          details,
          processedOcrData: reconstructedOcrData,
          decimalPlaces,
          photos: [],
          submissionStatus: 'idle',
          submissionMessage: undefined,
          ...(itemName === 'TU/CL' && { decimalPlacesCl })
        };
      };

      const newP2Jobs = allSelections.photoLog.map(createP1P2Job);
      if (newP2Jobs.length > 0) {
        setPhotoLogJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP2Jobs]);
        if (activePage === 'photoLog') setActivePhotoLogJobId(newP2Jobs[0]?.id || null);
      }

      const newP3Jobs = allSelections.fieldCount.map(createP1P2Job);
      if (newP3Jobs.length > 0) {
        setFieldCountJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP3Jobs]);
        if (activePage === 'fieldCount') setActiveFieldCountJobId(newP3Jobs[0]?.id || null);
      }

      const newP4Jobs: DrinkingWaterJob[] = allSelections.drinkingWater.map(item => createDrinkingWaterJob(item, loadedData));
      if (newP4Jobs.length > 0) {
        setDrinkingWaterJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP4Jobs]);
        if (activePage === 'drinkingWater') setActiveDrinkingWaterJobId(newP4Jobs[0]?.id || null);
      }

      const newP1Jobs = allSelections.structuralCheck.map(itemName => {
        const itemData = (values as any)[itemName as MainStructuralItemKey];
        if (!itemData || !itemData['_checklistData']) return null;
        return {
          id: self.crypto.randomUUID(),
          receiptNumber: receipt_no,
          mainItemKey: itemName as MainStructuralItemKey,
          checklistData: JSON.parse(itemData['_checklistData'].val),
          postInspectionDate: itemData['_postInspectionDate']?.val || '선택 안됨',
          postInspectionDateConfirmedAt: null,
          photos: [],
          photoComments: {},
          submissionStatus: 'idle',
          submissionMessage: undefined,
        } as StructuralJob;
      }).filter(Boolean) as StructuralJob[];

      if (newP1Jobs.length > 0) {
        setStructuralCheckJobs(prev => [...prev.filter(j => j.receiptNumber !== receipt_no), ...newP1Jobs]);
        if (activePage === 'structuralCheck') setActiveStructuralCheckJobId(newP1Jobs[0]?.id || null);
      }

      setDraftMessage({ type: 'success', text: `'${receipt_no}' 데이터를 모두 불러왔습니다.` });

      // ✅ 맥스튜디오 서버에서 사진도 불러오기 (실시간, P1~P4 기준 각 job에 배분)
      downloadPhotosFromServer(receipt_no, userName).then(serverPhotos => {
        if (serverPhotos.length === 0) return;

        // 사진 photo 객체 (uid 포함) 및 코멘트 맵 생성
        const toPhotosWithUid = (items: typeof serverPhotos) =>
          items.map(sp => ({
            uid: self.crypto.randomUUID(),
            base64: sp.base64,
            mimeType: sp.mimeType,
            file: sp.file,
            comment: sp.comment,
          }));

        const p1Items = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P1'));
        const p2Items = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P2'));
        const p3Items = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P3'));
        const p4Items = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P4'));

        const buildComments = (items: typeof p1Items) =>
          Object.fromEntries(items.filter(p => p.comment).map(p => [p.uid, p.comment!]));
        const buildPhotos = (items: typeof p1Items) =>
          items.map(({ uid, base64, mimeType, file }) => ({ uid, base64, mimeType, file }));

        // 실제로 서버에서 사진을 불러온 pageCode에 한해서만 배너 제거
        // → 같은 접수번호의 다른 pageCode(미저장 신규 작업)는 배너 유지
        const loadedCodes = new Set<string>([
          ...(p1Items.length > 0 ? ['P1'] : []),
          ...(p2Items.length > 0 ? ['P2'] : []),
          ...(p3Items.length > 0 ? ['P3'] : []),
          ...(p4Items.length > 0 ? ['P4'] : []),
        ]);
        if (loadedCodes.size > 0) {
          setCacheSummaries(prev =>
            prev.filter(s => !(s.receiptNumber === receipt_no && loadedCodes.has(s.pageCode)))
          );
        }

        if (p1Items.length > 0)
          setStructuralCheckJobs(prev => prev.map(job =>
            job.receiptNumber === receipt_no
              ? { ...job, photos: buildPhotos(p1Items), photoComments: { ...job.photoComments, ...buildComments(p1Items) } }
              : job
          ));
        if (p2Items.length > 0)
          setPhotoLogJobs(prev => prev.map(job =>
            job.receiptNumber === receipt_no
              ? { ...job, photos: buildPhotos(p2Items), photoComments: { ...job.photoComments, ...buildComments(p2Items) } }
              : job
          ));
        if (p3Items.length > 0)
          setFieldCountJobs(prev => prev.map(job =>
            job.receiptNumber === receipt_no
              ? { ...job, photos: buildPhotos(p3Items), photoComments: { ...job.photoComments, ...buildComments(p3Items) } }
              : job
          ));
        if (p4Items.length > 0)
          setDrinkingWaterJobs(prev => prev.map(job =>
            job.receiptNumber === receipt_no
              ? { ...job, photos: buildPhotos(p4Items), photoComments: { ...job.photoComments, ...buildComments(p4Items) } }
              : job
          ));

        // 불러온 후 서버에서 사진 삭제 (재저장 시 중복 방지, userName 필터 없이 전체 삭제)
        deletePhotosFromServer(receipt_no).catch(() => {});

        // 서버 사진 다운로드 후 IndexedDB에 자동 백업 (페이지 재시작 복구용)
        const allDownloaded = [
          ...p1Items.map(p => ({ p, code: 'P1' as const })),
          ...p2Items.map(p => ({ p, code: 'P2' as const })),
          ...p3Items.map(p => ({ p, code: 'P3' as const })),
          ...p4Items.map(p => ({ p, code: 'P4' as const })),
        ];
        const grouped = new Map<string, { code: 'P1'|'P2'|'P3'|'P4'; items: typeof p1Items }>();
        for (const { p, code } of allDownloaded) {
          if (!grouped.has(code)) grouped.set(code, { code, items: [] });
          grouped.get(code)!.items.push(p);
        }
        for (const [, { code, items }] of grouped) {
          cachePhotos(receipt_no, code, items.map(p => ({ ...p, file: p.file })), Object.fromEntries(items.filter(p => p.comment).map(p => [p.uid, p.comment!]))).catch(() => {});
        }
        const totalPhotos = p1Items.length + p2Items.length + p3Items.length + p4Items.length;
        setDraftMessage({ type: 'success', text: `'${receipt_no}' 불러오기 완료${totalPhotos > 0 ? ` (사진 ${totalPhotos}장)` : ' (사진 없음)'}` });



      }).catch(e => {
        console.error('[사진 불러오기 실패]', e);
        setDraftMessage({ type: 'error', text: `사진 불러오기 오류: ${e.message}` });
      });
    } catch (error: any) {
      setDraftMessage({ type: 'error', text: `불러오기 실패: ${error.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [receiptNumber, activePage, userName, getReceiptNumberForSaveLoad]);

  /** 공통 접수번호(base)로 -1, -2, -3... 순서로 전체 불러오기 */
  const handleLoadAllDrafts = useCallback(async () => {
    const base = receiptNumberCommon.trim();
    if (!base) {
      setDraftMessage({ type: 'error', text: '접수번호(공통)를 먼저 입력하세요. 예: 25-000000-01' });
      return;
    }

    setIsLoadingAll(true);
    setDraftMessage(null);

    const accP2: PhotoLogJob[] = [];
    const accP3: PhotoLogJob[] = [];
    const accP4: DrinkingWaterJob[] = [];
    const accP1: StructuralJob[] = [];
    const loadedReceipts: string[] = [];
    let firstSite = '';
    let firstGps = '';

    const p1Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
    const p2Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
    const p3Items = ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
    const p4Keys = MAIN_STRUCTURAL_ITEMS.map(i => i.key);

    for (let i = 1; i <= 30; i++) {
      const receipt = `${base}-${i}`;
      try {
        const data = await callLoadTempApi(receipt, userName);
        const { receipt_no, site, item: loadedItems, values, gps_address } = data;

        // 첫 번째 항목에서 현장명/GPS 설정
        if (i === 1) {
          firstSite = site;
          firstGps = gps_address || '';
          try {
            const m = JSON.parse(values?._global_metadata?.['data']?.val || '{}');
            if (m.site) firstSite = m.site;
            if (m.gps_address) firstGps = m.gps_address;
          } catch {}
        }

        let inspStart: string | undefined;
        let inspEnd: string | undefined;
        try {
          const m = JSON.parse(values?._global_metadata?.['data']?.val || '{}');
          if (m.inspectionStartDate) inspStart = m.inspectionStartDate;
          if (m.inspectionEndDate) inspEnd = m.inspectionEndDate;
        } catch {}

        const avail = { p2: new Set<string>(), p3: new Set<string>(), p4: new Set<string>(), p1: new Set<string>() };
        if (data.values.TN && data.values.TP) {
          if (p1Items.includes('TN/TP')) avail.p2.add('TN/TP');
          if (p2Items.includes('TN/TP')) avail.p3.add('TN/TP');
        }
        loadedItems.forEach(item => {
          if (p1Items.includes(item)) avail.p2.add(item);
          if (p2Items.includes(item)) avail.p3.add(item);
          if (p3Items.includes(item)) avail.p4.add(item);
          if (p4Keys.includes(item as any)) avail.p1.add(item);
        });
        if (data.values.TU && data.values.Cl && p3Items.includes('TU/CL')) {
          avail.p4.add('TU/CL'); avail.p4.delete('TU'); avail.p4.delete('Cl');
        }

        const makeP1P2Job = (itemName: string): PhotoLogJob => {
          const ocrData: PhotoLogJob['processedOcrData'] = [];
          if (itemName === 'TN/TP') {
            // _ocrData (새 형식) 우선 시도
            const ocrEntry = (values as any)['TN']?.['_ocrData'];
            if (ocrEntry?.val) {
              try { const p = JSON.parse(ocrEntry.val); if (Array.isArray(p)) ocrData.push(...p); } catch {}
            }
            // 구 형식 fallback
            if (ocrData.length === 0) {
              const map: Record<string, any> = {};
              Object.entries(values.TN || {}).forEach(([id, d]) => {
                if (id.startsWith('_')) return;
                const k = (d as any).time || id;
                if (!map[k]) map[k] = { id: self.crypto.randomUUID(), time: (d as any).time };
                map[k].value = (d as any).val; map[k].identifier = id;
              });
              Object.entries(values.TP || {}).forEach(([id, d]) => {
                if (id.startsWith('_')) return;
                const k = (d as any).time || id;
                if (!map[k]) map[k] = { id: self.crypto.randomUUID(), time: (d as any).time };
                map[k].valueTP = (d as any).val; map[k].identifierTP = id;
              });
              Object.values(map).sort((a,b) => (a.time||'').localeCompare(b.time||'')).forEach((e: any) =>
                ocrData.push({ id: e.id, time: e.time||'', value: e.value||'', valueTP: e.valueTP, identifier: e.identifier, identifierTP: e.identifierTP })
              );
            }
          } else {
            // _ocrData (새 형식) 우선 시도
            const ocrEntry = (values as any)[itemName]?.['_ocrData'];
            if (ocrEntry?.val) {
              try { const p = JSON.parse(ocrEntry.val); if (Array.isArray(p)) ocrData.push(...p); } catch {}
            }
            // 구 형식 fallback
            if (ocrData.length === 0) {
              Object.entries((values as any)[itemName] || {}).sort(([,a],[,b]) => ((a as any)?.time||'').localeCompare((b as any)?.time||'')).forEach(([id, d]) => {
                if (id.startsWith('_')) return;
                ocrData.push({ id: self.crypto.randomUUID(), time: String((d as any).time), value: String((d as any).val), identifier: id });
              });
            }
          }
          // per-job 검사 날짜 (있으면 우선, 없으면 global fallback)
          const dateKey = itemName === 'TN/TP' ? 'TN' : itemName;
          let jobStart = inspStart;
          let jobEnd = inspEnd;
          try {
            const dEntry = (values as any)[dateKey]?.['_inspectionDates'];
            if (dEntry?.val) { const d = JSON.parse(dEntry.val); if (d.start) jobStart = d.start; if (d.end) jobEnd = d.end; }
          } catch {}
          return { id: self.crypto.randomUUID(), receiptNumber: receipt_no, siteLocation: site, selectedItem: itemName, photos: [], photoComments: {}, processedOcrData: ocrData, rangeDifferenceResults: null, concentrationBoundaries: null, decimalPlaces: 0, details: '', decimalPlacesCl: undefined, ktlJsonPreview: null, draftJsonPreview: null, submissionStatus: 'idle', submissionMessage: undefined, inspectionStartDate: jobStart, inspectionEndDate: jobEnd };
        };

        const makeDWJob = (itemName: string): DrinkingWaterJob => {
          let details = '', dp = 2, dpCl: number | undefined;
          try { const m = JSON.parse(values[itemName]?._p3_metadata?.val || '{}'); details = m.details||''; dp = m.decimalPlaces??2; if (itemName==='TU/CL') dpCl = m.decimalPlacesCl??2; } catch {}
          const ocrData = DRINKING_WATER_IDENTIFIERS.map(identifier => {
            const entry: any = { id: self.crypto.randomUUID(), time: '', value: '', identifier };
            if (itemName === 'TU/CL') entry.valueTP = '';
            const tu = data.values.TU || {}, cl = data.values.Cl || {};
            if (itemName==='TU') { entry.value=tu[identifier]?.val||''; entry.time=tu[identifier]?.time||''; }
            else if (itemName==='Cl') { entry.value=cl[identifier]?.val||''; entry.time=cl[identifier]?.time||''; }
            else if (itemName==='TU/CL') { entry.value=tu[identifier]?.val||''; entry.valueTP=cl[identifier]?.val||''; entry.time=tu[identifier]?.time||cl[identifier]?.time||''; }
            return entry;
          });
          return { id: self.crypto.randomUUID(), receiptNumber: receipt_no, selectedItem: itemName, details, processedOcrData: ocrData, decimalPlaces: dp, photos: [], submissionStatus: 'idle', submissionMessage: undefined, ...(itemName==='TU/CL' && { decimalPlacesCl: dpCl }) };
        };

        Array.from(avail.p2).forEach(item => accP2.push(makeP1P2Job(item)));
        Array.from(avail.p3).forEach(item => accP3.push(makeP1P2Job(item)));
        Array.from(avail.p4).forEach(item => accP4.push(makeDWJob(item)));
        Array.from(avail.p1).forEach(itemName => {
          const d = (values as any)[itemName];
          if (!d?.['_checklistData']) return;
          let cd: Record<string, any>;
          try { cd = JSON.parse(d['_checklistData'].val); } catch { return; } // JSON 파싱 실패 시 무시
          accP1.push({
            id: self.crypto.randomUUID(),
            receiptNumber: receipt_no,
            mainItemKey: itemName as MainStructuralItemKey,
            checklistData: cd,
            postInspectionDate: d['_postInspectionDate']?.val || '선택 안됨',
            postInspectionDateConfirmedAt: null,
            photos: [],
            photoComments: {},
            submissionStatus: 'idle',
            submissionMessage: undefined
          } as StructuralJob);
        });

        loadedReceipts.push(receipt_no);
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('찾을 수 없습니다') || msg.includes('not found') || msg.includes('404')) break;
        console.warn(`[전체불러오기] ${receipt} 오류:`, msg);
      }
    }

    if (loadedReceipts.length === 0) {
      setDraftMessage({ type: 'error', text: `저장된 데이터 없음: '${base}-1'부터 찾을 수 없습니다.` });
      setIsLoadingAll(false);
      return;
    }

    const loaded = new Set(loadedReceipts);
    setSiteName(firstSite);
    setCurrentGpsAddress(firstGps);
    setReceiptNumberCommon(base);
    setReceiptNumberDetail('');
    if (accP2.length > 0) setPhotoLogJobs(prev => [...prev.filter(j => !loaded.has(j.receiptNumber)), ...accP2]);
    if (accP3.length > 0) setFieldCountJobs(prev => [...prev.filter(j => !loaded.has(j.receiptNumber)), ...accP3]);
    if (accP4.length > 0) setDrinkingWaterJobs(prev => [...prev.filter(j => !loaded.has(j.receiptNumber)), ...accP4]);
    if (accP1.length > 0) setStructuralCheckJobs(prev => [...prev.filter(j => !loaded.has(j.receiptNumber)), ...accP1]);

    setDraftMessage({ type: 'success', text: `전체 ${loadedReceipts.length}건 불러오기 완료 (${loadedReceipts.join(', ')})` });
    setIsLoadingAll(false);

    // ✅ 맥스튜디오 사진 다운로드 (접수별 비동기 병렬, userName 필터)
    loadedReceipts.forEach(receipt => {
      downloadPhotosFromServer(receipt, userName)
        .then(serverPhotos => {
          if (serverPhotos.length === 0) return;

          const toPhotosWithUid = (items: typeof serverPhotos) =>
            items.map(sp => ({
              uid: self.crypto.randomUUID(),
              base64: sp.base64,
              mimeType: sp.mimeType,
              file: sp.file,
              comment: sp.comment,
            }));

          const p1 = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P1'));
          const p2 = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P2'));
          const p3 = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P3'));
          const p4 = toPhotosWithUid(serverPhotos.filter(sp => sp.selectedItem === 'P4'));

          const buildComments = (items: typeof p1) =>
            Object.fromEntries(items.filter(p => p.comment).map(p => [p.uid, p.comment!]));
          const buildPhotos = (items: typeof p1) =>
            items.map(({ uid, base64, mimeType, file }) => ({ uid, base64, mimeType, file }));

          if (p1.length > 0) setStructuralCheckJobs(prev => prev.map(j =>
            j.receiptNumber === receipt ? { ...j, photos: buildPhotos(p1), photoComments: { ...j.photoComments, ...buildComments(p1) } } : j));
          if (p2.length > 0) setPhotoLogJobs(prev => prev.map(j =>
            j.receiptNumber === receipt ? { ...j, photos: buildPhotos(p2), photoComments: { ...j.photoComments, ...buildComments(p2) } } : j));
          if (p3.length > 0) setFieldCountJobs(prev => prev.map(j =>
            j.receiptNumber === receipt ? { ...j, photos: buildPhotos(p3), photoComments: { ...j.photoComments, ...buildComments(p3) } } : j));
          if (p4.length > 0) setDrinkingWaterJobs(prev => prev.map(j =>
            j.receiptNumber === receipt ? { ...j, photos: buildPhotos(p4), photoComments: { ...j.photoComments, ...buildComments(p4) } } : j));

          // 불러온 후 서버에서 사진 삭제 (재저장 시 중복 방지)
          deletePhotosFromServer(receipt, undefined, userName).catch(() => {});
          console.log(`[전체불러오기][${receipt}] 사진 P1:${p1.length} P2:${p2.length} P3:${p3.length} P4:${p4.length}장`);
        })
        .catch(e => console.warn(`[전체불러오기][사진] ${receipt}:`, e.message));
    });
  }, [receiptNumberCommon, userName]);

  const handleAddTask = useCallback(() => {
    const isCsvPage = activePage === 'csvGraph';

    if (!isCsvPage) {
      if (!receiptNumberCommon.trim() || !receiptNumberDetail.trim()) {
        alert("접수번호 (공통)와 (세부)를 모두 입력해주세요.");
        return;
      }
      if (!newItemKey) {
        alert("항목을 선택해주세요.");
        return;
      }
    }

    // 세부(-N) 항목 생성 시, 잘못 남아있는 3파트 base 위치도우미를 삭제.
    // ※ 세부 위치(-01-1)는 절대 삭제 안 함 — 오직 3파트 base(-01)만. (deleteLocationsByBase는 세부까지 지우므로 안 씀)
    {
      const _rp = receiptNumber.trim().split('-');
      if (_rp.length === 4) {
        deleteLocation(_rp.slice(0, 3).join('-'))
          .then(() => getAllLocations().then(setLocationList)) // 삭제를 위치 도우미 화면에 즉시 반영
          .catch(() => {});
      }
    }

    if (activePage === 'photoLog' || activePage === 'fieldCount') {
      const newJob: PhotoLogJob = {
        id: self.crypto.randomUUID(),
        receiptNumber,
        siteLocation: siteName.trim(),  // P1에만 GPS 주소 포함, P2/P3는 현장명만 사용
        selectedItem: newItemKey,
        photos: [],
        photoComments: {},
        processedOcrData: null,
        rangeDifferenceResults: null,
        concentrationBoundaries: null,
        decimalPlaces: 0,
        details: '',
        ktlJsonPreview: null,
        draftJsonPreview: null,
        submissionStatus: 'idle',
        submissionMessage: undefined
      };
      if (activePage === 'photoLog') {
        setPhotoLogJobs(prev => [...prev, newJob]);
        setActivePhotoLogJobId(newJob.id);
      } else {
        setFieldCountJobs(prev => [...prev, newJob]);
        setActiveFieldCountJobId(newJob.id);
      }
    } else if (activePage === 'drinkingWater') {
      const initialData = DRINKING_WATER_IDENTIFIERS.map(id => ({
        id: self.crypto.randomUUID(),
        time: '',
        value: '',
        identifier: id,
        isRuleMatched: false,
        ...(newItemKey === 'TU/CL' && { valueTP: '' })
      }));
      const newJob: DrinkingWaterJob = {
        id: self.crypto.randomUUID(),
        receiptNumber,
        selectedItem: newItemKey,
        details: '',
        processedOcrData: initialData,
        decimalPlaces: 2,
        photos: [],
        submissionStatus: 'idle',
        submissionMessage: undefined,
        ...(newItemKey === 'TU/CL' && { decimalPlacesCl: 2 })
      };
      setDrinkingWaterJobs(prev => [...prev, newJob]);
      setActiveDrinkingWaterJobId(newJob.id);
    } else if (activePage === 'structuralCheck') {
      const key = newItemKey as MainStructuralItemKey;
      const newChecklist = Object.fromEntries(CHECKLIST_DEFINITIONS[key].map(itemName => {
        let defaultNotes = '';
        if (itemName === "정도검사 증명서") {
          defaultNotes = JSON.stringify({ presence: 'not_selected' } as CertificateDetails);
        }
        if (itemName === "측정방법확인") {
          const preferredMethod = PREFERRED_MEASUREMENT_METHODS[key];
          if (preferredMethod) defaultNotes = preferredMethod;
        }
        return [itemName, { status: '선택 안됨', notes: defaultNotes, confirmedAt: null, specialNotes: '' } as StructuralCheckSubItemData];
      }));

      if (key === 'PH') newChecklist["측정범위확인"].notes = "pH 0-14";
      if (key === 'TU') newChecklist["측정범위확인"].notes = "0-10 NTU";
      if (key === 'Cl') newChecklist["측정범위확인"].notes = "0-2 mg/L";

      const isFixedDateItem = key === 'PH' || key === 'TU' || key === 'Cl';

      const newJob: StructuralJob = {
        id: self.crypto.randomUUID(),
        receiptNumber,
        mainItemKey: key,
        checklistData: newChecklist,
        postInspectionDate: isFixedDateItem ? '2년 후' : '선택 안됨',
        postInspectionDateConfirmedAt: null,
        photos: [],
        photoComments: {},
        submissionStatus: 'idle',
        submissionMessage: undefined,
      };
      setStructuralCheckJobs(prev => [...prev, newJob]);
      setActiveStructuralCheckJobId(newJob.id);

      // ✅ 항목별 관련 페이지 잡 자동 생성
      // P2/P3 공통 기반 잡 팩토리
      const makeAnalysisJob = (): PhotoLogJob => ({
        id: self.crypto.randomUUID(),
        receiptNumber,
        siteLocation: siteName.trim(),
        selectedItem: key,
        photos: [],
        photoComments: {},
        processedOcrData: null,
        rangeDifferenceResults: null,
        concentrationBoundaries: null,
        decimalPlaces: 0,
        details: '',
        ktlJsonPreview: null,
        draftJsonPreview: null,
        submissionStatus: 'idle',
        submissionMessage: undefined,
      });

      // P4(먹는물) 잡 팩토리
      const makeDrinkingWaterJob = (itemName: string): DrinkingWaterJob => {
        const initialData = DRINKING_WATER_IDENTIFIERS.map(id => ({
          id: self.crypto.randomUUID(),
          time: '',
          value: '',
          identifier: id,
          isRuleMatched: false,
        }));
        return {
          id: self.crypto.randomUUID(),
          receiptNumber,
          selectedItem: itemName,
          details: '',
          processedOcrData: initialData,
          decimalPlaces: 2,
          photos: [],
          submissionStatus: 'idle',
          submissionMessage: undefined,
        };
      };

      // P6(CSV 그래프) 잡 팩토리
      const makeCsvJob = (sensorType: 'SS' | 'PH' | 'TU' | 'Cl' | 'DO'): CsvGraphJob => ({
        id: self.crypto.randomUUID(),
        receiptNumber,
        fileName: null,
        parsedData: null,
        channelAnalysis: {},
        autoMinMaxResults: null,
        selectedChannelId: null,
        timeRangeInMs: 'all',
        viewEndTimestamp: null,
        submissionStatus: 'idle',
        sensorType,
      });

      // TOC, TN, TP, COD → P2 + P3
      if (['TOC', 'TN', 'TP', 'COD'].includes(key)) {
        const p2Job = makeAnalysisJob();
        const p3Job = makeAnalysisJob();
        setPhotoLogJobs(prev => [...prev, p2Job]);
        setFieldCountJobs(prev => [...prev, p3Job]);
      }
      // SS, PH, DO → P2 + P3 + P6
      else if (['SS', 'PH', 'DO'].includes(key)) {
        const p2Job = makeAnalysisJob();
        const p3Job = makeAnalysisJob();
        const p6Job = makeCsvJob(key as 'SS' | 'PH' | 'DO');
        setPhotoLogJobs(prev => [...prev, p2Job]);
        setFieldCountJobs(prev => [...prev, p3Job]);
        setCsvGraphJobs(prev => [...prev, p6Job]);
      }
      // TU, Cl → P4 + P6
      else if (['TU', 'Cl'].includes(key)) {
        const p4Job = makeDrinkingWaterJob(key);
        const p6Job = makeCsvJob(key as 'TU' | 'Cl');
        setDrinkingWaterJobs(prev => [...prev, p4Job]);
        setCsvGraphJobs(prev => [...prev, p6Job]);
      }

    } else if (activePage === 'csvGraph') {
      const newJob: CsvGraphJob = {
        id: self.crypto.randomUUID(),
        receiptNumber,
        fileName: null,
        parsedData: null,
        channelAnalysis: {},
        autoMinMaxResults: null,
        selectedChannelId: null,
        timeRangeInMs: 'all',
        viewEndTimestamp: null,
        submissionStatus: 'idle',
        sensorType: 'SS',
      };
      setCsvGraphJobs(prev => [...prev, newJob]);
      setActiveCsvGraphJobId(newJob.id);
    }

    const currentDetailNum = parseInt(receiptNumberDetail, 10);
    if (!isNaN(currentDetailNum) && receiptNumberDetail.length > 0) {
      setReceiptNumberDetail(String(currentDetailNum + 1).padStart(receiptNumberDetail.length, '0'));
    }
    setNewItemKey('');
  }, [newItemKey, receiptNumber, receiptNumberCommon, receiptNumberDetail, activePage, finalSiteLocation]);

  const handleFetchGpsAddress = useCallback(() => {
    setIsFetchingAddress(true);
    setCurrentGpsAddress("주소 찾는 중...");

    if (!navigator.geolocation) {
      setCurrentGpsAddress("이 브라우저에서는 GPS를 지원하지 않습니다.");
      setIsFetchingAddress(false);
      return;
    }

    const onSuccess = async (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      setCoords({ lat: latitude, lng: longitude });

      try {
        const addr = await getKakaoAddress(latitude, longitude);
        setCurrentGpsAddress(addr);
      } catch (err: any) {
        console.error("GPS 주소 오류:", err);
        setCurrentGpsAddress(`주소 탐색 중 오류 발생: ${err.message}`);
      } finally {
        setIsFetchingAddress(false);
      }
    };

    const onError = (error: GeolocationPositionError) => {
      console.error("Geolocation error:", `Code: ${error.code}, Message: ${error.message}`);
      setCurrentGpsAddress(
        error.code === error.PERMISSION_DENIED
          ? "GPS 위치 권한이 거부되었습니다."
          : "GPS 위치를 가져올 수 없습니다."
      );
      setIsFetchingAddress(false);
    };

    // 고정밀 우선 시도 → 실패(맥 데스크톱 등 kCLErrorLocationUnknown)면 저정밀+캐시허용으로 1회 재시도
    const tryGet = (highAccuracy: boolean) => {
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (error) => {
          if (highAccuracy && error.code !== error.PERMISSION_DENIED) {
            console.warn("GPS 고정밀 실패 → 저정밀·캐시허용으로 재시도");
            tryGet(false);
            return;
          }
          onError(error);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 8000 : 15000,
          maximumAge: highAccuracy ? 0 : 60000,
        }
      );
    };
    tryGet(true);
  }, []);

  const handleSearchAddress = useCallback(async () => {
    if (!currentGpsAddress.trim()) {
      alert("검색할 주소를 'GPS 주소 또는 직접 입력' 필드에 입력해주세요.");
      return;
    }
    setIsFetchingAddress(true);
    try {
      const results = await searchAddressByKeyword(currentGpsAddress);
      if (results && results.length > 0) {
        const firstResult = results[0];
        const newLat = parseFloat(firstResult.y);
        const newLng = parseFloat(firstResult.x);

        if (!isNaN(newLat) && !isNaN(newLng)) {
          setCoords({ lat: newLat, lng: newLng });
          setCurrentGpsAddress(enforceFullRegionPrefix(firstResult.road_address_name || firstResult.address_name));
        } else {
          throw new Error("검색 결과에서 유효한 좌표를 받지 못했습니다.");
        }
      } else {
        alert("검색 결과가 없습니다. 다른 주소로 시도해주세요.");
      }
    } catch (err: any) {
      console.error("Address search error:", err);
      setCurrentGpsAddress(`주소 검색 중 오류 발생: ${err.message}`);
    } finally {
      setIsFetchingAddress(false);
    }
  }, [currentGpsAddress]);

  const handleOpenMap = useCallback(() => {
    if (!coords) {
      const defaultCoords = { lat: 37.5665, lng: 126.9780 };
      setCoords(defaultCoords);
    }
  }, [coords]);

  const handleCloseMap = useCallback(() => {
    setCoords(null); // 지도만 닫기 — 주소는 유지
  }, []);

  const handleResetGps = useCallback(() => {
    setCoords(null);
    setCurrentGpsAddress('');
    setLocReceiptInput('');
    setIsFetchingAddress(false);
  }, []);

  const itemOptionsForNewTask = useMemo(() => {
    if (activePage === 'photoLog') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '수질')?.items || [];
    if (activePage === 'fieldCount') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '현장 계수')?.items || [];
    if (activePage === 'drinkingWater') return ANALYSIS_ITEM_GROUPS.find(g => g.label === '먹는물')?.items || [];
    if (activePage === 'structuralCheck') return STRUCTURAL_ITEM_GROUPS;
    return [];
  }, [activePage]);

  const showTaskManagement = useMemo(() => TASK_PAGES.includes(activePage), [activePage]);

  const navButtonBaseStyle = "flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500/60 text-xs whitespace-nowrap shrink-0 border ktl-nav-btn";

  // P1~P5 페이지 선택 네비 — 예전 위치(패널 아래)로 고정, 테마 무관 어두운 바탕
  const pageNav = (
    <nav className="ktl-page-nav sticky top-2 z-40 w-full max-w-3xl mb-4 p-2 backdrop-blur-md rounded-xl shadow-xl">
      <div className="flex gap-1 overflow-x-auto scrollbar-hide justify-center items-center">
        {NAV_ITEMS.map(({ key, label, short }) => (
          <button
            key={key}
            onClick={() => setActivePage(key)}
            className={`${navButtonBaseStyle} ${activePage === key ? 'ktl-nav-on' : 'ktl-nav-off'}`}
            aria-pressed={activePage === key}
            title={label}
          >
            <span className="ktl-nav-badge font-black text-[13px] leading-none px-1.5 py-0.5 rounded">{short}</span>
            <span className="hidden sm:inline">{label.replace(/\s*\(P\d\)\s*$/, '')}</span>
          </button>
        ))}
      </div>
    </nav>
  );

  const siteNameOnly = useMemo(() => siteName.trim(), [siteName]);
  const appIdToSync = selectedApplication ? selectedApplication.id : null;

  const activePageContent = useMemo(() => {
    switch (activePage) {
      case 'photoLog':
        return (
          <PhotoLogPage
            userName={userName}
            jobs={photoLogJobs}
            setJobs={setPhotoLogJobs}
            activeJobId={activePhotoLogJobId}
            setActiveJobId={setActivePhotoLogJobId}
            siteName={siteNameOnly}
            siteLocation={finalSiteLocation}
            onDeleteJob={handleDeletePhotoLogJob}
            onSaveDraft={handleSaveDraft}
            onLoadDraft={handleLoadDraft}
            onSaveAllDrafts={handleSaveAllDrafts}
            onLoadAllDrafts={handleLoadAllDrafts}
            draftMessage={draftMessage}
            applications={applications}
            onOpenExtraPhotoModal={handleOpenExtraPhotoModal}
            emissionStandards={emissionStandards}
          />
        );
      case 'fieldCount':
        return (
          <FieldCountPage
            userName={userName}
            jobs={fieldCountJobs}
            setJobs={setFieldCountJobs}
            activeJobId={activeFieldCountJobId}
            setActiveJobId={setActiveFieldCountJobId}
            siteName={siteNameOnly}
            siteLocation={finalSiteLocation}
            onDeleteJob={handleDeleteFieldCountJob}
            onSaveDraft={handleSaveDraft}
            onLoadDraft={handleLoadDraft}
            onSaveAllDrafts={handleSaveAllDrafts}
            onLoadAllDrafts={handleLoadAllDrafts}
            draftMessage={draftMessage}
            applications={applications}
            onOpenExtraPhotoModal={handleOpenExtraPhotoModal}
            emissionStandards={emissionStandards}
          />
        );
      case 'drinkingWater':
        return (
          <DrinkingWaterPage
            userName={userName}
            jobs={drinkingWaterJobs}
            setJobs={setDrinkingWaterJobs}
            activeJobId={activeDrinkingWaterJobId}
            setActiveJobId={setActiveDrinkingWaterJobId}
            siteName={siteNameOnly}
            siteLocation={finalSiteLocation}
            onDeleteJob={handleDeleteDrinkingWaterJob}
            onSaveDraft={handleSaveDraft}
            onLoadDraft={handleLoadDraft}
            onSaveAllDrafts={handleSaveAllDrafts}
            onLoadAllDrafts={handleLoadAllDrafts}
            draftMessage={draftMessage}
            isSavingDraft={isSaving}
            isLoadingDraft={isLoading}
            applications={applications}
            onOpenExtraPhotoModal={handleOpenExtraPhotoModal}
            locationList={locationList}
            measurementRanges={measurementRanges}
          />
        );
      case 'structuralCheck':
        return (
          <StructuralCheckPage
            userName={userName}
            jobs={structuralCheckJobs}
            setJobs={setStructuralCheckJobs}
            activeJobId={activeStructuralCheckJobId}
            setActiveJobId={setActiveStructuralCheckJobId}
            siteName={siteNameOnly}
            onDeleteJob={handleDeleteStructuralCheckJob}
            currentGpsAddress={currentGpsAddress}
            locationList={locationList}
            applications={applications}
            selectedApplication={selectedApplication}
            onSaveDraft={handleSaveDraft}
            onLoadDraft={handleLoadDraft}
            onSaveAllDrafts={handleSaveAllDrafts}
            onLoadAllDrafts={handleLoadAllDrafts}
            draftMessage={draftMessage}
            isSavingDraft={isSaving}
            isLoadingDraft={isLoading}
            onOpenExtraPhotoModal={handleOpenExtraPhotoModal}
          />
        );
      case 'kakaoTalk':
        return <KakaoTalkPage userName={userName} userContact={userContact} />;
      case 'csvGraph':
        return (
          <CsvGraphPage
            userName={userName}
            jobs={csvGraphJobs}
            setJobs={setCsvGraphJobs}
            activeJobId={activeCsvGraphJobId}
            setActiveJobId={setActiveCsvGraphJobId}
            siteLocation={finalSiteLocation}
            onDeleteJob={handleDeleteCsvGraphJob}
            locationList={locationList}
          />
        );
      default:
        return null;
    }
  }, [
    activePage,
    userName,
    userContact,
    photoLogJobs,
    activePhotoLogJobId,
    fieldCountJobs,
    activeFieldCountJobId,
    drinkingWaterJobs,
    activeDrinkingWaterJobId,
    structuralCheckJobs,
    activeStructuralCheckJobId,
    currentGpsAddress,
    applications,
    selectedApplication,
    csvGraphJobs,
    activeCsvGraphJobId,
    siteNameOnly,
    finalSiteLocation,
    handleDeletePhotoLogJob,
    handleDeleteFieldCountJob,
    handleDeleteDrinkingWaterJob,
    handleDeleteStructuralCheckJob,
    handleDeleteCsvGraphJob,
    handleSaveDraft,
    handleLoadDraft,
    handleSaveAllDrafts,
    handleLoadAllDrafts,
    draftMessage,
  ]);

  return (
    <>
    <div className="w-full min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex flex-col items-center px-0 sm:px-8 py-0 sm:py-6 font-[Inter] overflow-x-hidden selection:bg-sky-500/30 touch-manipulation">
      <div className="w-full max-w-5xl flex flex-col items-center bg-slate-900/60 backdrop-blur-sm min-h-screen sm:min-h-0 sm:rounded-2xl border border-slate-800/80 shadow-2xl px-2 sm:px-6 py-4 sm:py-6">
        <Header apiMode={apiMode} onApiModeChange={handleApiModeChange} userName={userName} onLogout={onLogout} onKakaoTalkClick={() => setShowKakaoTalkModal(true)} onFieldAnalysisClick={() => setShowFieldAnalysis(true)} />


        {(
          <>
          {/* ── sticky 패널: 목록 / 공통정보 / 데이터관리 ── */}
          <div className="sticky top-0 z-30 w-full max-w-3xl mb-0 bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-700/60 shadow-md overflow-hidden divide-y divide-slate-700/40">
            <div>
              <button
                onClick={() => toggleSection('applicationOcr')}
                className={`w-full flex justify-between items-center text-left px-4 py-3 border-l-4 transition-all hover:bg-slate-800/70 ${
                  openSections.includes('applicationOcr') ? 'border-sky-500 bg-slate-800/80' : 'border-transparent'
                }`}
                aria-expanded={openSections.includes('applicationOcr')}
                aria-controls="application-ocr-section"
              >
                <span className={`text-sm font-bold tracking-wide ${openSections.includes('applicationOcr') ? 'text-sky-300' : 'text-slate-200'}`}>📋 목록</span>
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform ${openSections.includes('applicationOcr') ? 'rotate-180 text-sky-400' : 'text-slate-400'}`}
                />
              </button>
              <div
                id="application-ocr-section"
                className={`overflow-hidden transition-all duration-300 ease-in-out ${openSections.includes('applicationOcr') ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <ApplicationOcrSection
                  isOpen={openSections.includes('applicationOcr')}
                  userName={userName}
                  userContact={userContact}
                  onApplicationSelect={handleApplicationSelect}
                  siteNameToSync={siteName}
                  appIdToSync={appIdToSync}
                  receiptNumberCommonToSync={receiptNumberCommon}
                  applications={applications}
                  setApplications={setApplications}
                  isLoadingApplications={isLoadingApplications}
                  loadApplications={loadApplications}
                  onLocationSaved={() => getAllLocations().then(setLocationList)}
                />
              </div>
            </div>

            <div>
              <button
                onClick={() => toggleSection('addTask')}
                className={`w-full flex justify-between items-center text-left px-4 py-3 border-l-4 transition-all hover:bg-slate-800/70 ${
                  openSections.includes('addTask') ? 'border-sky-500 bg-slate-800/80' : 'border-transparent'
                }`}
                aria-expanded={openSections.includes('addTask')}
                aria-controls="add-task-section"
              >
                <span className={`text-sm font-bold tracking-wide ${openSections.includes('addTask') ? 'text-sky-300' : 'text-slate-200'}`}>⚙️ 공통 정보 및 작업 관리</span>
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform ${openSections.includes('addTask') ? 'rotate-180 text-sky-400' : 'text-slate-400'}`}
                />
              </button>

              <div
                id="add-task-section"
                className={`overflow-hidden transition-all duration-300 ease-in-out ${openSections.includes('addTask') ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <div className="pt-3 px-2 space-y-2">
                  {/* 1줄: 접수번호(공통) - (세부) - 항목 */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <label htmlFor="global-receipt-common" className="block text-xs font-medium text-slate-300 mb-1">
                        접수번호 <span className="text-amber-400 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        id="global-receipt-common"
                        value={receiptNumberCommon}
                        onChange={(e) => setReceiptNumberCommon(e.target.value)}
                        className="block w-full p-2 bg-slate-950/80 border border-amber-500/80 rounded-md text-amber-200 text-sm placeholder-slate-400 focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                        placeholder="25-000000-01"
                      />
                    </div>
                    <div className="flex-none w-14">
                      <label htmlFor="global-receipt-detail" className="block text-xs font-medium text-slate-300 mb-1">
                        세부 <span className="text-amber-400 font-bold">*</span>
                      </label>
                      <input
                        type="text"
                        id="global-receipt-detail"
                        value={receiptNumberDetail}
                        onChange={(e) => setReceiptNumberDetail(e.target.value)}
                        className="block w-full p-2 bg-slate-950/80 border border-amber-500/80 rounded-md text-amber-200 text-sm placeholder-slate-400 text-center focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                        placeholder="1"
                      />
                    </div>
                    {activePage !== 'csvGraph' && showTaskManagement && (
                      <div className="flex-1 min-w-0">
                        <label htmlFor="new-task-item" className="block text-xs font-medium text-slate-300 mb-1">항목</label>
                        <select
                          id="new-task-item"
                          value={newItemKey}
                          onChange={(e) => setNewItemKey(e.target.value)}
                          className="block w-full p-2 bg-slate-950/60 border border-slate-600 rounded-md text-slate-100 text-sm h-[38px]"
                        >
                          <option value="" disabled>선택...</option>
                          {Array.isArray(itemOptionsForNewTask) &&
                          itemOptionsForNewTask.length > 0 &&
                          typeof itemOptionsForNewTask[0] === 'object' &&
                          itemOptionsForNewTask[0] !== null &&
                          'label' in (itemOptionsForNewTask[0] as any)
                            ? (
                              itemOptionsForNewTask as {
                                label: string;
                                items: { key: string; name: string }[];
                              }[]
                            ).map((group) => (
                              <optgroup key={group.label} label={group.label}>
                                {group.items.map((item) => (
                                  <option key={item.key} value={item.key}>
                                    {item.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))
                            : (itemOptionsForNewTask as string[]).map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* 2줄: 현장 위치(가장 넓게) + 추가 버튼 */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <label htmlFor="global-site-location" className="block text-xs font-medium text-slate-300 mb-1">
                        현장 위치
                      </label>
                      <input
                        type="text"
                        id="global-site-location"
                        value={siteName}
                        onChange={(e) => setSiteName(e.target.value)}
                        className="block w-full p-2 bg-slate-950/60 border border-slate-600 rounded-md text-slate-100 text-sm"
                        placeholder="OO처리장"
                      />
                    </div>
                    {showTaskManagement && (
                      <div className="flex-none">
                        <ActionButton onClick={handleAddTask} className="!py-1.5 !px-3 !text-xs">추가</ActionButton>
                      </div>
                    )}
                  </div>
              </div>
            </div>
          </div>


            <div>
              <button
                onClick={() => toggleSection('data')}
                className={`w-full flex justify-between items-center text-left px-4 py-3 border-l-4 transition-all hover:bg-slate-800/70 ${
                  openSections.includes('data') ? 'border-sky-500 bg-slate-800/80' : 'border-transparent'
                }`}
                aria-expanded={openSections.includes('data')}
                aria-controls="data-section"
              >
                <span className={`text-sm font-bold tracking-wide ${openSections.includes('data') ? 'text-sky-300' : 'text-slate-200'}`}>🗄️ 데이터 관리</span>
                <ChevronDownIcon className={`w-4 h-4 transition-transform ${openSections.includes('data') ? 'rotate-180 text-sky-400' : 'text-slate-400'}`} />
              </button>

              <div
                id="data-section"
                className={`overflow-hidden transition-all duration-300 ease-in-out ${openSections.includes('data') ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <div className="pt-4 px-2 space-y-3">
                                   {/* 1행: 임시 저장 / 불러오기 - 단건만 disabled */}
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      onClick={() => handleSaveDraft()}
                      variant="secondary"
                      disabled={isSaving || isLoading}
                      className="!py-1.5 !px-3 !text-xs"
                    >
                      {isSaving ? '저장 중...' : '임시 저장'}
                    </ActionButton>
                     <ActionButton
                      onClick={() => handleLoadDraft(receiptNumber)}
                      variant="secondary"
                      disabled={isSaving || isLoading}
                      className="!py-1.5 !px-3 !text-xs"
                    >
                      {isLoading ? '로딩 중...' : '불러오기'}
                    </ActionButton>

                  </div>

                  {/* 2행: 전체 저장 / 전체 불러오기 - 전체만 disabled */}
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      onClick={handleSaveAllDrafts}
                      variant="secondary"
                      disabled={isSavingAll || isLoadingAll}
                      className="!py-1.5 !px-3 !text-xs"
                    >
                      {isSavingAll ? '저장 중...' : '전체 저장'}
                    </ActionButton>
                    <ActionButton
                      onClick={handleLoadAllDrafts}
                      variant="secondary"
                      disabled={isSavingAll || isLoadingAll}
                      className="!py-1.5 !px-3 !text-xs"
                    >
                      {isLoadingAll ? '로딩 중...' : '전체 불러오기'}
                    </ActionButton>
                  </div>

                  {draftMessage && (
                    <p className={`text-xs text-center ${draftMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`} role="status">
                      {draftMessage.type === 'success' ? '✅' : '❌'} {draftMessage.text}
                    </p>
                  )}

                  {/* IndexedDB 미저장 사진 복구 배너 (접기/펼치기) */}
                  {cacheSummaries.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowCacheList(s => !s)}
                        className="w-full flex items-center justify-between px-2 py-1.5 bg-amber-950/40 border border-amber-700/40 rounded-lg text-[10px] hover:bg-amber-950/60 transition-colors"
                      >
                        <span className="text-amber-400 font-semibold">📸 미저장 사진 {cacheSummaries.reduce((a,s)=>a+s.photoCount,0)}장 ({cacheSummaries.length}건)</span>
                        <span className="text-amber-600">{showCacheList ? '▲' : '▼'}</span>
                      </button>
                      {showCacheList && (
                        <div className="mt-1 space-y-1">
                          {cacheSummaries.map(s => (
                            <div key={`${s.receiptNumber}||${s.pageCode}`} className="flex items-center justify-between gap-2 px-2 py-1 bg-amber-950/30 border border-amber-800/30 rounded-lg text-[10px]">
                              <span className="text-amber-300 truncate">{s.receiptNumber} <span className="text-amber-500">{({P1:"구조확인",P2:"수질분석",P3:"현장계수",P4:"먹는물",P5:"(구)카카오톡",P6:"(구)CSV",P7:"(구)알수없음"} as Record<string,string>)[s.pageCode] ?? s.pageCode}</span> · {s.photoCount}장</span>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={() => handleRecoverCache(s)}
                                  disabled={isRecovering}
                                  className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-black rounded text-[10px] font-bold transition-colors"
                                >
                                  {isRecovering ? '...' : '복구'}
                                </button>
                                <button
                                  onClick={async () => { await clearCachedPhotos(s.receiptNumber, s.pageCode as any).catch(()=>{}); setCacheSummaries(prev => prev.filter(x => !(x.receiptNumber===s.receiptNumber && x.pageCode===s.pageCode))); }}
                                  className="px-2 py-0.5 bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-300 rounded text-[10px] transition-colors"
                                >
                                  삭제
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 접수번호 일괄 변경 */}
                  <div className="mt-2">
                    <button
                      onClick={() => setShowRename(s => !s)}
                      className="w-full flex items-center justify-between px-2 py-1.5 bg-slate-800/60 border border-slate-700/40 rounded-lg text-[10px] hover:bg-slate-700/60 transition-colors"
                    >
                      <span className="text-slate-300 font-semibold">🔄 접수번호 변경</span>
                      <span className="text-slate-500">{showRename ? '▲' : '▼'}</span>
                    </button>
                    {showRename && (
                      <div className="mt-1.5 p-2 bg-slate-800/40 border border-slate-700/30 rounded-lg space-y-2">

                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400">기존 번호 (prefix)</label>
                          <input
                            type="text"
                            value={renameOld}
                            onChange={e => setRenameOld(e.target.value)}
                            placeholder="예) 26-029426 또는 26-029426-01 또는 26-029426-01-1"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400">신규 번호 (prefix)</label>
                          <input
                            type="text"
                            value={renameNew}
                            onChange={e => setRenameNew(e.target.value)}
                            placeholder="예) 26-030785 또는 26-030785-01 또는 26-030785-01-1"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        {renameOld && renameNew && renameOld !== renameNew && (
                          <p className="text-[10px] text-blue-400">
                            미리보기: <span className="text-slate-400">{renameOld}</span>... → <span className="text-blue-300">{renameNew}</span>...
                          </p>
                        )}
                        <button
                          onClick={handleRenameReceipt}
                          disabled={isRenaming || !renameOld || !renameNew}
                          className="w-full py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[11px] font-bold rounded transition-colors"
                        >
                          {isRenaming ? '변경 중...' : '일괄 변경 실행'}
                        </button>
                        <p className="text-[10px] text-slate-500">변경 후 '저장' 버튼으로 서버에 반영하세요</p>
                      </div>
                    )}
                  </div>

                  {/* 접수번호 그룹형 작업 목록 */}
                  {(() => {
                    // 전체 접수번호 목록
                    // 현재 세션 작업 + 맥스튜디오에 저장된 이력 모두 표시
                    const allRcpts = Array.from(new Set([
                      ...structuralCheckJobs.map(j => j.receiptNumber),
                      ...photoLogJobs.map(j => j.receiptNumber),
                      ...fieldCountJobs.map(j => j.receiptNumber),
                      ...(drinkingWaterJobs as any[]).map(j => j.receiptNumber),
                      ...(csvGraphJobs as any[]).map(j => j.receiptNumber),
                      ...jobStatuses.map(s => s.receiptNo), // ← 맥스튜디오 저장 이력
                    ].filter(Boolean))) as string[];

                    if (allRcpts.length === 0) return null;

                    // 부모번호(26-031075-01)로 그룹핑
                    const groupMap = new Map<string, string[]>();
                    allRcpts.forEach(rn => {
                      const parts = rn.split('-');
                      // 마지막 파트가 숫자 1자리면 suffix (-1, -2...) 있는 것으로 간주
                      const hasSubSuffix = parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1]);
                      const parentKey = hasSubSuffix ? parts.slice(0, -1).join('-') : rn;
                      if (!groupMap.has(parentKey)) groupMap.set(parentKey, []);
                      groupMap.get(parentKey)!.push(rn);
                    });

                    const groups = Array.from(groupMap.entries()); // [parentKey, children[]]
                    // receiptListPage===0: 4개만, 1: 전체 표시
                    const visibleGroups = receiptListPage === 0 ? groups.slice(0, 4) : groups;

                    // 페이지라벨 매핑
                    const PAGE_LABELS: { key: keyof JobStatusEntry; label: string; color: string }[] = [
                      { key: 'p1Sent', label: 'P1', color: 'bg-violet-500' },
                      { key: 'p2Sent', label: 'P2', color: 'bg-sky-500' },
                      { key: 'p3Sent', label: 'P3', color: 'bg-emerald-500' },
                      { key: 'p4Sent', label: 'P4', color: 'bg-amber-500' },
                      { key: 'p5Sent', label: 'P5', color: 'bg-pink-500' },
                    ];

                    // 항목별 사용 가능 P 페이지 규칙
                    // 수질: TOC/TN/TP/TN/TP->P1,P2,P3 | SS/pH/DO->P1,P5
                    // 먹는물: TU/Cl/TU/Cl->P1,P4,P5
                    const getActivePagesForItem = (itemName?: string): Set<string> => {
                      const n = (itemName||'').toUpperCase().replace(/\s/g,'');
                      if (['TOC','TN','TP','TN/TP','TNTP'].includes(n)) return new Set(['p1Sent','p2Sent','p3Sent']);
                      if (['SS','PH','DO'].includes(n))                  return new Set(['p1Sent','p5Sent']);
                      if (['TU','CL','TU/CL','TUCL'].includes(n))       return new Set(['p1Sent','p4Sent','p5Sent']);
                      return new Set(['p1Sent','p2Sent','p3Sent','p4Sent','p5Sent']);
                    };

                    const handleDeleteAllJobs = async () => {
                      if (!window.confirm(`작업 목록 전체(${allRcpts.length}건)를 삭제하시겠습니까?\n⚠️ 저장된 P1~P5 전송 상태도 함께 삭제됩니다.`)) return;
                      setStructuralCheckJobs([]);
                      setPhotoLogJobs([]);
                      setFieldCountJobs([]);
                      setDrinkingWaterJobs([] as any);
                      setCsvGraphJobs([]);
                      await Promise.allSettled(allRcpts.map(rn => deleteJobStatus(rn)));
                      // 위치 도우미 연동 삭제
                      await Promise.allSettled(allRcpts.map(rn => deleteLocationsByBase(rn).catch(() => {})));
                      setLocationList(await getAllLocations());
                      setJobStatuses([]);
                    };

                    // 서버 사진 중복 정리 — 접수번호별로 같은 사진 1장만 남기고 여분 삭제
                    const handleDedupePhotos = async () => {
                      if (dedupBusy) return;
                      if (!window.confirm(`작업 목록 전체(${allRcpts.length}건)의 서버 사진에서 중복을 정리합니다.\n같은 사진은 1장만 남기고 나머지를 삭제합니다. 계속할까요?`)) return;
                      setDedupBusy(true);
                      let totalRemoved = 0, processed = 0;
                      for (const rn of allRcpts) {
                        setDedupProgress(`정리 중… ${processed + 1}/${allRcpts.length} (${rn})`);
                        try {
                          const { removed } = await dedupePhotosForReceipt(rn);
                          totalRemoved += removed;
                        } catch (e: any) {
                          console.warn('[중복정리]', rn, e?.message);
                        }
                        processed++;
                      }
                      setDedupBusy(false);
                      setDedupProgress(null);
                      setDraftMessage({ type: 'success', text: `사진 중복 정리 완료 — ${processed}건 처리, 중복 ${totalRemoved}장 제거` });
                    };

                    const handleDeleteGroup = async (parentKey: string, children: string[]) => {
                      if (!window.confirm(`"${parentKey}" 그룹의 모든 작업을 삭제하시겠습니까?\n(하위: ${children.join(', ')})`)) return;
                      children.forEach(rn => {
                        setStructuralCheckJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                        setPhotoLogJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                        setFieldCountJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                        setDrinkingWaterJobs(prev => (prev as any[]).filter(j => j.receiptNumber !== rn) as any);
                        setCsvGraphJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                      });
                      await Promise.allSettled(children.map(rn => deleteJobStatus(rn)));
                      // 위치 도우미 연동 삭제
                      await Promise.allSettled(children.map(rn => deleteLocationsByBase(rn).catch(() => {})));
                      setLocationList(await getAllLocations());
                      setJobStatuses(prev => prev.filter(s => !children.includes(s.receiptNo)));
                      setExpandedGroups(prev => { const n = new Set(prev); n.delete(parentKey); return n; });
                    };

                    const handleDeleteChild = async (rn: string) => {
                      if (!window.confirm(`"${rn}" 작업을 삭제하시겠습니까?`)) return;
                      setStructuralCheckJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                      setPhotoLogJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                      setFieldCountJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                      setDrinkingWaterJobs(prev => (prev as any[]).filter(j => j.receiptNumber !== rn) as any);
                      setCsvGraphJobs(prev => prev.filter(j => j.receiptNumber !== rn));
                      await deleteJobStatus(rn);
                      // 위치 도우미 연동 삭제
                      await deleteLocationsByBase(rn).catch(() => {});
                      setLocationList(await getAllLocations());
                      setJobStatuses(prev => prev.filter(s => s.receiptNo !== rn));
                    };

                    const handleTogglePage = async (rn: string, pageKey: keyof JobStatusEntry) => {
                      const existing = jobStatuses.find(s => s.receiptNo === rn);
                      const current = existing ? !!(existing[pageKey]) : false;
                      const updated: JobStatusEntry = {
                        receiptNo: rn,
                        userName,
                        p1Sent: existing?.p1Sent ?? false,
                        p2Sent: existing?.p2Sent ?? false,
                        p3Sent: existing?.p3Sent ?? false,
                        p4Sent: existing?.p4Sent ?? false,
                        p5Sent: existing?.p5Sent ?? false,
                        updatedAt: Date.now(),
                        [pageKey]: !current,
                        ...(siteName ? { siteName } : {}),
                      };
                      setJobStatuses(prev => {
                        const idx = prev.findIndex(s => s.receiptNo === rn);
                        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
                        return [...prev, updated];
                      });
                      await saveJobStatus(updated);
                    };

                    const handleToggleGroup = (parentKey: string) => {
                      setExpandedGroups(prev => {
                        const n = new Set(prev);
                        if (n.has(parentKey)) n.delete(parentKey);
                        else n.add(parentKey);
                        return n;
                      });
                    };

                    // 관리자 현장명 수정(override). 공통정보보다 우선, 비우면 해제. 최신 입력이 우선.
                    const handleEditGroupSite = async (parentKey: string, _children: string[], currentSite: string) => {
                      const input = window.prompt(
                        `"${parentKey}" 현장명을 입력하세요.\n(비우고 확인 → 관리자 지정 해제, 다시 공통정보 우선)`,
                        currentSite || '');
                      if (input === null) return;   // 취소
                      const val = input.trim();
                      const ok = await setSiteOverride(parentKey, val, userName);
                      if (!ok) { alert('현장명 저장 실패'); return; }
                      const at = Date.now();
                      setJobStatuses(prev => {
                        const idx = prev.findIndex(s => s.receiptNo === parentKey);
                        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], siteOverride: val, siteOverrideAt: at }; return n; }
                        return [...prev, { receiptNo: parentKey, userName, p1Sent:false, p2Sent:false, p3Sent:false, p4Sent:false, p5Sent:false, updatedAt: at, siteOverride: val, siteOverrideAt: at }];
                      });
                    };

                    // 접수번호(그룹) 현장명 우선순위: 관리자 override → (작업 중)공통정보 → 세션 작업 → 신청목록
                    const getGroupSiteName = (parentKey: string, children: string[]): string => {
                      const ov = overrideFor(parentKey) || children.map(overrideFor).find(Boolean);
                      if (ov) return ov;                                                   // 1) 관리자 override
                      if ((parentKey === receiptNumber || children.includes(receiptNumber)) && finalSiteLocation)
                        return finalSiteLocation;                                          // 2) 현재 작업 중 공통정보
                      const allJobs: any[] = [
                        ...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs,
                        ...(drinkingWaterJobs as any[]), ...(csvGraphJobs as any[]),
                      ];
                      for (const rn of children) {
                        const j = allJobs.find(j => j.receiptNumber === rn);
                        const s = j?.siteLocation || j?.site;
                        if (s) return s;
                      }
                      const base = parentKey.split('-').slice(0, 3).join('-');
                      const app = applications.find(a => a.receipt_no === base || a.receipt_no === parentKey);
                      return app?.site_name || '';
                    };

                    return (
                      <div className="mt-2">
                        {/* 작업 목록(중요) — 길어서 기본 접힘. 눈에 띄는 헤더로 펼침 */}
                        <button
                          onClick={() => setShowJobList(s => !s)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-sky-950/40 border border-sky-700/50 rounded-lg hover:bg-sky-950/60 transition-colors"
                        >
                          <span className="text-xs font-bold text-sky-300">📋 작업 목록 ({allRcpts.length}건)</span>
                          <span className="text-[11px] font-semibold text-sky-500">{showJobList ? '▲ 접기' : '▼ 펼치기'}</span>
                        </button>

                        {showJobList && (
                        <div className="mt-1.5 space-y-1.5">
                          {allRcpts.length > 0 && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={handleDedupePhotos}
                                disabled={dedupBusy}
                                title="서버에 중복 저장된 사진을 1장만 남기고 정리"
                                className="px-2 py-0.5 text-[11px] text-sky-400 hover:text-sky-300 hover:bg-sky-900/30 rounded transition-colors disabled:opacity-50"
                              >{dedupBusy ? '정리 중…' : '🧹 사진 중복 정리'}</button>
                              <button
                                onClick={handleDeleteAllJobs}
                                title="작업 목록 전체 삭제"
                                className="px-2 py-0.5 text-[11px] text-slate-500 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
                              >🗑️ 전체 삭제</button>
                            </div>
                          )}
                          {dedupProgress && (
                            <p className="text-[10px] text-sky-400 text-right">{dedupProgress}</p>
                          )}

                        <div className="space-y-1">
                          {visibleGroups.map(([parentKey, children]) => {
                            const isExpanded = expandedGroups.has(parentKey);
                            const groupSite = getGroupSiteName(parentKey, children);
                            return (
                              <div key={parentKey} className="rounded-lg border border-slate-700/50 bg-slate-800/40 overflow-hidden">
                                {/* 부모 헤더 - 클릭 시 아코디언 토글 */}
                                <div className="flex items-center gap-1 px-2 py-1.5 bg-slate-700/40 cursor-pointer"
                                  onClick={() => handleToggleGroup(parentKey)}>
                                  <span className="text-[9px] text-slate-500 mr-0.5">{isExpanded ? '▼' : '▶'}</span>
                                  <span className="flex-1 min-w-0 text-[10px] truncate">
                                    <span className="font-bold text-sky-300">{parentKey}</span>
                                    {groupSite && <span className="text-slate-300 font-normal ml-1.5">· {groupSite}</span>}
                                  </span>
                                  <button
                                    onClick={e => { e.stopPropagation(); handleEditGroupSite(parentKey, children, groupSite); }}
                                    className="shrink-0 px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-sky-300 hover:bg-sky-900/30 rounded border border-transparent hover:border-sky-700/40 transition-colors"
                                    title={`"${parentKey}" 현장명 수정 (관리자 지정 → 공통정보보다 우선)`}
                                  >✏️</button>
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDeleteGroup(parentKey, children); }}
                                    className="shrink-0 px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-900/30 rounded border border-transparent hover:border-red-700/40 transition-colors"
                                    title={`"${parentKey}" 그룹 삭제`}
                                  >✕</button>
                                </div>

                                {/* 하위 접수번호들 - 펼쳐졌을 때만 */}
                                {isExpanded && (
                                  <div className="divide-y divide-slate-700/30">
                                    {[...children].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(rn => {
                                      const status = jobStatuses.find(s => s.receiptNo === rn);
                                      const suffix = rn.split('-').pop();
                                      return (
                                        <div key={rn} className="flex items-center gap-1 px-2 py-1.5">
                                          {/* 번호 클릭 → 접수번호 설정 */}
                                          <button
                                            onClick={() => {
                                              const parts = rn.split('-');
                                              if (parts.length >= 4) {
                                                setReceiptNumberCommon(parts.slice(0, -1).join('-'));
                                                setReceiptNumberDetail(parts[parts.length - 1]);
                                              } else {
                                                setReceiptNumberCommon(rn);
                                                setReceiptNumberDetail('');
                                              }
                                            }}
                                            className="shrink-0 text-[10px] text-slate-400 hover:text-sky-300 transition-colors font-mono w-6 text-left"
                                            title={`${rn} 선택`}
                                          >-{suffix}</button>

                                          {/* P1~P5 토글 뱃지 — 항목별 사용 P만 활성 */}
                                          <div className="flex gap-0.5 flex-1">
                                            {PAGE_LABELS.map(({ key, label, color }) => {
                                              const sent = status ? !!(status[key]) : false;
                                              const activePages = getActivePagesForItem(status?.itemName);
                                              const isActive = activePages.has(key as string);
                                              if (!isActive) {
                                                return (
                                                  <span
                                                    key={key}
                                                    title={`${label}: 이 항목(${status?.itemName||'미지정'})에서 사용 안 함`}
                                                    className="px-1 py-0.5 text-[9px] font-bold rounded bg-slate-900 text-slate-700 cursor-default select-none"
                                                  >—</span>
                                                );
                                              }
                                              return (
                                                <button
                                                  key={key}
                                                  onClick={() => handleTogglePage(rn, key as keyof JobStatusEntry)}
                                                  title={`${rn} ${label} ${sent ? '전송완료 (클릭→취소)' : '미전송 (클릭→완료)'}`}
                                                  className={`px-1 py-0.5 text-[9px] font-bold rounded transition-all ${
                                                    sent
                                                      ? `${color} text-white shadow-sm`
                                                      : 'bg-slate-700 text-slate-500 hover:bg-slate-600'
                                                  }`}
                                                >{label}</button>
                                              );
                                            })}
                                          </div>

                                          {/* 하위 삭제 */}
                                          <button
                                            onClick={() => handleDeleteChild(rn)}
                                            className="shrink-0 p-0.5 text-[10px] text-slate-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                            title={`"${rn}" 삭제`}
                                          >✕</button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* 더보기 버튼 */}
                        {groups.length > 4 && (
                          <button
                            onClick={() => setReceiptListPage(p => p === 0 ? 1 : 0)}
                            className="w-full py-1 text-[10px] text-slate-400 hover:text-sky-300 hover:bg-slate-700/40 rounded-md transition-colors border border-slate-700/30 hover:border-sky-700/40"
                          >
                            {receiptListPage === 0
                              ? `▼ 더보기 (${groups.length - 4}건 더)`
                              : '▲ 접기'}
                          </button>
                        )}
                        </div>
                        )}
                      </div>
                    );
                  })()}

                  <p className="text-xs text-slate-500 text-center">
                    위: 현재 접수번호 &nbsp;|&nbsp; 아래: 전체 일괄 처리
                  </p>
                </div>
              </div>
            </div>
          </div>{/* end sticky panel */}

          {/* ── 위치 도우미: sticky 밖, 아래 고정 패널 ── */}
          <div className="w-full max-w-3xl mt-2 mb-4 bg-slate-900/70 rounded-xl border border-slate-700/60 shadow-md overflow-hidden">
            <button
              onClick={() => toggleSection('locationHelper')}
              className={`w-full flex justify-between items-center text-left px-4 py-3 border-l-4 transition-all hover:bg-slate-800/70 ${
                openSections.includes('locationHelper') ? 'border-sky-500 bg-slate-800/80' : 'border-transparent'
              }`}
              aria-expanded={openSections.includes('locationHelper')}
              aria-controls="location-helper-section"
            >
              <span className={`text-sm font-bold tracking-wide ${openSections.includes('locationHelper') ? 'text-sky-300' : 'text-slate-200'}`}>📍 위치 도우미</span>
              <ChevronDownIcon className={`w-4 h-4 transition-transform ${openSections.includes('locationHelper') ? 'rotate-180 text-sky-400' : 'text-slate-400'}`} />
            </button>

            <div
              id="location-helper-section"
              className={`overflow-hidden transition-all duration-300 ease-in-out ${openSections.includes('locationHelper') ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
            >
              <div className="pt-3 px-3 pb-3 space-y-2">

                {/* 접수번호 + 세부 + 주소저장 한 줄 */}
                <div className="space-y-1">
                  <p className="text-[10px] text-slate-500">접수번호별 위치 저장 <span className="text-slate-600">· 세부 비우면 전체 적용 (먹는물 제외)</span></p>
                  <div className="flex gap-1.5 items-center">
                    {/* 접수번호 (세부포함 입력 가능: 26-031078-01-1) */}
                    <input
                      type="text"
                      value={locReceiptInput}
                      onChange={e => setLocReceiptInput(e.target.value)}
                      placeholder="26-031078-01 / -1 포함 / 여러개: -1,12"
                      className="flex-1 min-w-0 p-2 bg-slate-800 border border-slate-600 rounded-md text-slate-300 text-xs placeholder-slate-500"
                    />
                    {/* 주소 저장 */}
                    <button
                      onClick={async () => {
                        const id_base = locReceiptInput.trim() || receiptNumber;
                        if (!id_base) { alert('접수번호를 입력하세요.'); return; }
                        if (!currentGpsAddress.trim()) { alert('저장할 주소가 없습니다.\nGPS, 찾기, 또는 지도에서 주소를 먼저 가져오세요.'); return; }

                        // ── 다중 세부 일괄 저장: 쉼표로 여러 개(예 "26-000000-01-1, 12") → 같은 위치·현장으로 전부 저장 ──
                        // 순수 숫자 토큰은 앞 접수번호의 base(-01)에 붙임. 먹는물(배수지) 전용 편의 — 수질은 base 하나뿐이라 다중 개념 없음.
                        {
                          const _tokens = (locReceiptInput.trim() || receiptNumber || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                          const _ids: string[] = [];
                          let _b3 = '';
                          for (const tk of _tokens) {
                            if (/^\d+$/.test(tk)) { if (_b3) _ids.push(`${_b3}-${tk}`); }
                            else { _ids.push(tk); _b3 = tk.split('-').slice(0, 3).join('-'); }
                          }
                          const _uniq = [...new Set(_ids)];
                          if (_uniq.length > 1) {
                            const bad = _uniq.filter(i => !isValidReceiptId(i));
                            if (bad.length) { alert(`올바르지 않은 형식: ${bad.join(', ')}`); return; }
                            const base3 = _uniq[0].split('-').slice(0, 3).join('-');
                            const matched = [...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs, ...(drinkingWaterJobs as any[])].find(j => j.receiptNumber?.startsWith(base3))?.siteLocation || siteName || '';
                            const label = window.prompt(`${_uniq.length}개 세부를 같은 위치·현장으로 저장합니다:\n${_uniq.join(', ')}\n\n배수지·정수장 등 현장_세부 명칭을 입력하세요.\n예: ${matched || '(현장명)'}(○○배수지)`, '');
                            if (label === null) return;
                            const t = label.trim();
                            setIsLocSaving(true);
                            try {
                              const addr = currentGpsAddress.trim();
                              const resolved = await resolveCoords(addr);
                              const lat = resolved.lat, lng = resolved.lng;
                              if (!t) {
                                const isSusil = window.confirm(`배수지·정수장 명칭이 없습니다.\n\n이 위치는 "수질" 인가요?\n[확인] 수질 → 세부 대신 접수번호 기본 ${base3} 하나로 저장\n[취소] 먹는물 → 배수지 명칭을 입력하세요`);
                                if (!isSusil) { setIsLocSaving(false); return; }
                                await saveLocation({ id: base3, address: addr, lat, lng, savedAt: Date.now(), siteName: matched, category: '수질' });
                              } else {
                                const siteForLoc = `${matched}(${t})`;
                                for (const oneId of _uniq) {
                                  await saveLocation({ id: oneId, address: addr, lat, lng, savedAt: Date.now(), siteName: siteForLoc, category: '먹는물' });
                                }
                              }
                              setLocationList(await getAllLocations());
                              setCurrentGpsAddress(''); setCoords(null); setLocReceiptInput('');
                            } catch (e: any) { alert(e.message || '저장 오류'); }
                            finally { setIsLocSaving(false); }
                            return;
                          }
                        }

                        const id = (locReceiptInput.trim() || receiptNumber);
                        if (!isValidReceiptId(id)) { alert(`올바르지 않은 형식: ${id}`); return; }
                        // 같은 베이스(-01)의 위치가 이미 있으면 중복 저장 경고 (같은 현장 주소 여러 건 쌓임 방지)
                        // 단, 먹는물(세부 번호가 있거나 먹는물 분야)의 경우는 각 세부 접수번호별로 개별 위치를 저장하는 것이 정상이므로 경고를 생략함
                        const autoCat = fieldFromItem(itemForReceipt(id));
                        // 먹는물(TU·Cl 항목)은 시설별 위치라 꼬리번호(-N) 권장. 단 현장에서 세부번호를 아직 모를 수 있으니
                        // 막지 않고 경고만 — 베이스로 저장 허용. 진짜 강제는 전송(Claydox) 직전에.
                        if (autoCat === '먹는물' && id.split('-').length < 4) {
                          const ok = window.confirm('🚰 Cl·TU(먹는물)은 보통 시설별 세부번호(-1, -2 …)가 필요합니다.\n세부번호를 아직 모르면 베이스로 저장해두고, 전송 전에 시설별로 지정하세요.\n\n[취소] 저장 안 함 · [확인] 베이스로 저장');
                          if (!ok) return;
                        }
                        const isDrinkingWater = autoCat === '먹는물' || id.split('-').length >= 4;

                        let dupBaseLoc = null;
                        if (!isDrinkingWater) {
                          const newBase = id.split('-').slice(0, 3).join('-');
                          dupBaseLoc = locationList.find(l => l.id !== id && l.id.split('-').slice(0, 3).join('-') === newBase && (l.address || '').trim());
                        }

                        if (dupBaseLoc) {
                          const ok = window.confirm(
                            `⚠️ 같은 접수번호(${id.split('-').slice(0, 3).join('-')})의 위치가 이미 저장돼 있습니다:\n` +
                            `· ${dupBaseLoc.id} → ${dupBaseLoc.address}\n\n` +
                            `중복 저장하면 같은 현장 주소가 여러 건으로 쌓입니다.\n` +
                            `보통 베이스(${id.split('-').slice(0, 3).join('-')})로 한 번만 저장하면 하위 세부(-1, -2 …) 전체에 적용됩니다.\n\n` +
                            `[취소] 저장 안 함 · [확인] 그래도 저장`
                          );
                          if (!ok) return;
                        }
                        setIsLocSaving(true);
                        try {
                          const resolved = await resolveCoords(currentGpsAddress);
                          const lat = resolved.lat;
                          const lng = resolved.lng;
                          // 현장명: jobs에서 접수번호 base로 매칭
                        const baseId = id_base.split('-').slice(0, 3).join('-');
                          const matchedSite = [
                            ...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs, ...(drinkingWaterJobs as any[])
                          ].find(j => j.receiptNumber?.startsWith(baseId))?.siteLocation || siteName || '';
                          // 분야 자동 분류: 항목(TU·Cl=먹는물, 그외=수질) 기준. 못 정하면 빈값(서버가 기존 유지)
                          const autoCat = fieldFromItem(itemForReceipt(id));
                          // 꼬리번호(-N) 위치: 세부 시설 명칭 입력(배수지·정수장·여과지 등) → 현장명 뒤 괄호로.
                          // 먹는물은 꼬리번호별로 시설이 달라서 어느 시설인지 구분 필요. base(-01)는 안 물어봄.
                          let siteForLoc = matchedSite;
                          let saveId = id;
                          let saveCat = autoCat;
                          if (id.split('-').length >= 4) {
                            const label = window.prompt(
                              `"${id}" 세부 위치 명칭을 입력하세요.\n배수지·정수장·여과지 등 — 현장명 뒤에 괄호로 붙습니다.\n예: ${matchedSite || '(현장명)'}(○○배수지)`,
                              ''
                            );
                            if (label === null) return; // 취소 → 저장 안 함 (finally가 isLocSaving 해제)
                            const t = label.trim();
                            if (!t) {
                              // 배수지·정수장 등 명칭이 없음 → 수질 여부 확인
                              const isSusil = window.confirm(
                                `배수지·정수장 등 세부 명칭이 없습니다.\n\n이 위치는 "수질" 인가요?\n\n` +
                                `[확인] 수질 → 세부(-N) 대신 접수번호 기본 ${id.split('-').slice(0, 3).join('-')} 로 저장\n` +
                                `[취소] 먹는물 → 배수지·정수장 명칭을 다시 입력하세요`
                              );
                              if (!isSusil) return; // 먹는물인데 명칭 없음 → 저장 취소(명칭 다시 입력하라고)
                              saveId = id.split('-').slice(0, 3).join('-'); // 수질 = 세부 대신 base(-01)로 저장
                              siteForLoc = matchedSite;
                              saveCat = '수질';
                            } else {
                              siteForLoc = `${matchedSite}(${t})`; // 배수지 명칭 있음 = 먹는물
                              saveCat = '먹는물';
                            }
                          }
                          await saveLocation({ id: saveId, address: currentGpsAddress.trim(), lat, lng, savedAt: Date.now(), siteName: siteForLoc, category: saveCat });
                          const all = await getAllLocations();
                          setLocationList(all);
                          // 저장 후 위치(주소) 자동 초기화 — 주소가 다음 작업에 잘못 따라붙는 것 방지
                          setCurrentGpsAddress('');
                          setCoords(null);
                          setLocReceiptInput('');
                        } catch(e: any) { alert(e.message || '저장 오류'); }
                        finally { setIsLocSaving(false); }
                      }}
                      disabled={isLocSaving || !currentGpsAddress.trim() || (!locReceiptInput.trim() && !receiptNumber)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-2 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition-colors"
                      title="현재 주소를 접수번호에 저장"
                    >
                      {isLocSaving ? <Spinner size="sm" /> : <span>💾</span>}
                      저장
                    </button>
                    {/* 세부별 입력: 세부마다 현장_세부 명칭을 각각 다르게 저장 */}
                    <button
                      onClick={() => {
                        if (!currentGpsAddress.trim()) { alert('저장할 주소가 없습니다.\nGPS/찾기/지도에서 주소를 먼저 가져오세요.'); return; }
                        const _tokens = (locReceiptInput.trim() || receiptNumber || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                        const _ids: string[] = []; let _b3 = '';
                        for (const tk of _tokens) {
                          if (/^\d+$/.test(tk)) { if (_b3) _ids.push(`${_b3}-${tk}`); }
                          else { _ids.push(tk); _b3 = tk.split('-').slice(0, 3).join('-'); }
                        }
                        const _uniq = [...new Set(_ids)];
                        if (_uniq.length < 2) { alert('세부를 2개 이상 입력하세요.\n예: 26-044262-01-8,9,10,11,12,13,14'); return; }
                        const bad = _uniq.filter(i => !isValidReceiptId(i));
                        if (bad.length) { alert(`올바르지 않은 형식: ${bad.join(', ')}`); return; }
                        setMultiRows(_uniq.map(id => ({ id, label: '' })));
                      }}
                      disabled={isLocSaving || !currentGpsAddress.trim()}
                      className="shrink-0 px-2.5 py-2 text-[11px] font-semibold rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
                      title="세부마다 현장_세부(배수지) 명칭을 각각 입력해서 저장"
                    >세부별 입력</button>
                  </div>
                </div>

                {/* 세부별 입력 폼: 각 세부에 현장_세부(배수지) 명칭을 다르게 저장 */}
                {multiRows && (
                  <div className="p-2 rounded-lg border border-indigo-600/50 bg-indigo-950/30 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-indigo-300">세부별 현장_세부 입력 · {multiRows.length}개</span>
                      <button onClick={() => setMultiRows(null)} className="text-[10px] text-slate-400 hover:text-slate-200">✕ 닫기</button>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">주소(공통): {currentGpsAddress || '—'}</p>
                    <div className="space-y-1 max-h-52 overflow-y-auto">
                      {multiRows.map((row, i) => (
                        <div key={row.id} className="flex items-center gap-1.5">
                          <span className="shrink-0 text-[10px] font-mono text-indigo-300 w-28 truncate" title={row.id}>{row.id}</span>
                          <input
                            type="text"
                            value={row.label}
                            onChange={e => setMultiRows(rows => rows!.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                            placeholder="배수지·정수장 명칭"
                            className="flex-1 min-w-0 p-1.5 bg-slate-800 border border-slate-600 rounded text-slate-200 text-xs placeholder-slate-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setMultiRows(rows => { const first = rows?.[0]?.label.trim() || ''; return rows!.map(r => ({ ...r, label: first })); })}
                        className="shrink-0 px-2 py-1 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                        title="첫 칸 명칭을 전체에 복사 (같은 배수지일 때)"
                      >첫 명칭 전체적용</button>
                      <button
                        onClick={async () => {
                          const addr = currentGpsAddress.trim();
                          if (!addr) { alert('주소가 없습니다.'); return; }
                          const rowsToSave = multiRows.filter(r => r.label.trim());
                          if (!rowsToSave.length) { alert('명칭을 1개 이상 입력하세요.'); return; }
                          const base3 = multiRows[0].id.split('-').slice(0, 3).join('-');
                          const matched = [...structuralCheckJobs, ...photoLogJobs, ...fieldCountJobs, ...(drinkingWaterJobs as any[])].find(j => j.receiptNumber?.startsWith(base3))?.siteLocation || siteName || '';
                          setIsLocSaving(true);
                          try {
                            const resolved = await resolveCoords(addr);
                            const lat = resolved.lat, lng = resolved.lng;
                            for (const r of rowsToSave) {
                              await saveLocation({ id: r.id, address: addr, lat, lng, savedAt: Date.now(), siteName: `${matched}(${r.label.trim()})`, category: '먹는물' });
                            }
                            setLocationList(await getAllLocations());
                            setCurrentGpsAddress(''); setCoords(null); setLocReceiptInput(''); setMultiRows(null);
                          } catch (e: any) { alert(e.message || '저장 오류'); }
                          finally { setIsLocSaving(false); }
                        }}
                        disabled={isLocSaving}
                        className="flex-1 px-2 py-1 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                      >{isLocSaving ? '저장 중...' : '전부 저장'}</button>
                    </div>
                    <p className="text-[10px] text-slate-500">명칭 빈 칸은 저장 안 함 · 같은 배수지면 "첫 명칭 전체적용"</p>
                  </div>
                )}

                {/* 분야 필터 (수질/먹는물/전체) */}
                {locationList.length > 0 && (
                  <div className="flex items-center gap-1 mb-1">
                    {(['없음', '전체', '수질', '먹는물'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setLocFieldFilter(f)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-colors ${
                          locFieldFilter === f
                            ? (f === '먹는물' ? 'bg-blue-600 border-blue-500 text-white' : f === '수질' ? 'bg-teal-600 border-teal-500 text-white' : 'bg-slate-600 border-slate-500 text-white')
                            : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200'
                        }`}
                      >{(f === '수질' || f === '먹는물') ? `${f} ${locationList.filter(l => fieldOf(l) === f).length}` : f === '전체' ? `${f} ${locationList.length}` : f}</button>
                    ))}
                  </div>
                )}

                {/* 저장된 위치 목록 */}
                {locationList.length === 0 ? (
                  <p className="text-center text-[11px] text-slate-600 py-1">저장된 위치 없음</p>
                ) : (
                  <div ref={locListScrollRef} className="space-y-1 max-h-40 overflow-y-auto">
                    {[...locationList]
                      .filter(loc => (locFieldFilter === '전체' || locFieldFilter === '없음' || fieldOf(loc) === locFieldFilter) && (locYearFilter === '전체' || yearOfId(loc.id) === locYearFilter))
                      .sort((a, b) => {
                        // 클릭(작업중) 항목은 항상 맨 위로
                        const selA = locReceiptInput === a.id ? 1 : 0;
                        const selB = locReceiptInput === b.id ? 1 : 0;
                        if (selA !== selB) return selB - selA;
                        const idxA = applications.findIndex(ap => ap.receipt_no === a.id.split('-').slice(0,3).join('-') || ap.receipt_no === a.id);
                        const idxB = applications.findIndex(ap => ap.receipt_no === b.id.split('-').slice(0,3).join('-') || ap.receipt_no === b.id);
                        // 접수번호(application)가 다르면 그 순서대로, 미등록(-1)은 뒤로
                        if (idxA !== idxB) {
                          if (idxA === -1) return 1;
                          if (idxB === -1) return -1;
                          return idxA - idxB;
                        }
                        // 같은 접수번호 안에서는 세부번호 오름차순 (-1,-2,-3,…,-11 → 큰 번호가 아래)
                        return a.id.localeCompare(b.id, undefined, { numeric: true });
                      })
                      .map(loc => (
                      <div key={loc.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-all ${
                        locReceiptInput === loc.id
                          ? 'bg-sky-900/40 border-sky-500/70 ring-1 ring-sky-500/30'
                          : 'bg-slate-800/60 border-slate-700/30 hover:border-slate-600/50'
                      }`}>
                        <button
                          className="flex-1 text-left min-w-0"
                          onClick={async () => {
                            // 이미 작업중인 항목을 재클릭 → 해제(토글)
                            if (locReceiptInput === loc.id) {
                              setLocReceiptInput('');
                              return;
                            }
                            setLocReceiptInput(loc.id);
                            setCurrentGpsAddress(loc.address);
                            // 주소로 카카오 재검색해서 정확한 좌표로 지도 이동
                            // (저장된 lat/lng이 부정확하거나 동일한 경우에도 올바르게 이동)
                            setIsFetchingAddress(true);
                            try {
                              const results = await searchAddressByKeyword(loc.address);
                              if (results?.length > 0) {
                                const r = results[0];
                                const lat = parseFloat(r.y), lng = parseFloat(r.x);
                                if (!isNaN(lat) && !isNaN(lng)) setCoords({ lat, lng });
                              } else if (loc.lat && loc.lng) {
                                setCoords({ lat: loc.lat, lng: loc.lng });
                              }
                            } catch {
                              if (loc.lat && loc.lng) setCoords({ lat: loc.lat, lng: loc.lng });
                            } finally {
                              setIsFetchingAddress(false);
                            }
                          }}
                          title="클릭 → 접수번호·주소 모두 적용"
                        >
                          {/* 접수번호 + 현장명: 현재 작업중인 항목은 공통 정보 siteName을 실시간 반영 */}
                          <p className="text-[11px] font-bold text-sky-400 truncate">
                            {locReceiptInput === loc.id && (
                              <span className="mr-1 text-[9px] font-bold px-1 py-0.5 rounded bg-sky-500 text-white align-middle">작업중</span>
                            )}
                            {/* No. 순번: applications 목록 기준 */}
                            {(() => {
                              const idx = applications.findIndex(a => a.receipt_no === loc.id.split('-').slice(0,3).join('-') || a.receipt_no === loc.id);
                              return idx >= 0
                                ? <span className="mr-1 text-[10px] font-normal text-slate-500">{idx + 1}.</span>
                                : null;
                            })()}
                            {loc.id}
                            {(() => {
                              // 우선순위: 1) 관리자 override 2) 현재 작업 중 공통정보 3) DB 저장값 4) applications.site_name
                              const baseId = loc.id.split('-').slice(0,3).join('-');
                              const appMatch = applications.find(a => a.receipt_no === baseId || a.receipt_no === loc.id);
                              const displayName = overrideFor(loc.id)
                                || ((loc.id === receiptNumber && finalSiteLocation)
                                  ? finalSiteLocation
                                  : (loc.siteName || appMatch?.site_name || ''));
                              return displayName
                                ? <span className="ml-1.5 text-[10px] font-normal text-slate-400">{displayName}</span>
                                : null;
                            })()}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">{loc.address}</p>
                        </button>
                        {/* 분야 배지 — 클릭 시 수질↔먹는물 수동 전환(override 저장) */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = fieldOf(loc) === '먹는물' ? '수질' : '먹는물';
                            await saveLocation({ ...loc, category: next });
                            setLocationList(await getAllLocations());
                          }}
                          title="분야 전환 (수질 ↔ 먹는물)"
                          className={`shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded border transition-colors ${
                            fieldOf(loc) === '먹는물'
                              ? 'bg-blue-900/50 border-blue-600/60 text-blue-200'
                              : 'bg-teal-900/50 border-teal-600/60 text-teal-200'
                          }`}
                        >{fieldOf(loc)}</button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`"${loc.id}" 위치를 영구 삭제하시겠습니까?`)) return;
                            await deleteLocation(loc.id);
                            setLocationList(await getAllLocations());
                          }}
                          className="shrink-0 p-1 text-slate-600 hover:text-red-400 rounded transition-colors"
                        ><TrashIcon /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 현재 작업 GPS 주소 직접 입력 */}
                <div className="border-t border-slate-700/40 pt-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-500">현재 작업 GPS 주소</p>
                    {locationList.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-slate-500">지도:</span>
                        {(['없음', '전체', '수질', '먹는물'] as const).map(f => (
                          <button
                            key={f}
                            onClick={() => setLocFieldFilter(f)}
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
                              locFieldFilter === f
                                ? (f === '먹는물' ? 'bg-blue-600 border-blue-500 text-white' : f === '수질' ? 'bg-teal-600 border-teal-500 text-white' : 'bg-slate-600 border-slate-500 text-white')
                                : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:text-slate-200'
                            }`}
                          >{f}</button>
                        ))}
                        {availableYears.length > 0 && (
                          <select
                            value={locYearFilter}
                            onChange={e => setLocYearFilter(e.target.value === '전체' ? '전체' : Number(e.target.value))}
                            title="검사 년도 (접수번호 앞2자리)"
                            className="ml-1 px-1 py-0.5 text-[10px] rounded border bg-slate-800/60 border-slate-700/40 text-slate-300"
                          >
                            <option value="전체">전체년도</option>
                            {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  {/* 신호등 범례 — 마커 보일 때만 */}
                  {locFieldFilter !== '없음' && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400 pt-0.5">
                      <span>🟢 정상</span><span>🟡 임박</span><span>🔴 지연·미신청</span><span>⚠️ 수질 꼬리오류</span>
                      <span className="text-slate-600">· 수질 1년 / 먹는물 2년 주기</span>
                    </div>
                  )}
                  <input
                    type="text"
                    id="current-gps-address"
                    value={currentGpsAddress}
                    onChange={(e) => setCurrentGpsAddress(e.target.value)}
                    className="block w-full p-2 bg-slate-800 border border-slate-600 rounded-md text-slate-300 text-sm placeholder-slate-400"
                    placeholder="GPS 주소 또는 직접 입력"
                  />
                  <div className="flex gap-1">
                    <button onClick={handleFetchGpsAddress} disabled={isFetchingAddress} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 disabled:opacity-40 transition-colors">
                      {isFetchingAddress ? <Spinner size="sm" /> : <GpsIcon />} GPS
                    </button>
                    <button onClick={handleSearchAddress} disabled={isFetchingAddress} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 disabled:opacity-40 transition-colors">
                      <SearchIcon /> 찾기
                    </button>
                    {!coords ? (
                      <button onClick={handleOpenMap} disabled={isFetchingAddress} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 disabled:opacity-40 transition-colors">
                        <MapIcon /> 열기
                      </button>
                    ) : (
                      <button onClick={handleCloseMap} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-sky-800/60 hover:bg-sky-700/60 text-sky-200 border border-sky-600/50 transition-colors">
                        <MapIcon /> 닫기
                      </button>
                    )}
                    <button onClick={handleResetGps} disabled={isFetchingAddress || (!currentGpsAddress && !coords)} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-300 border border-slate-600 disabled:opacity-40 transition-colors">
                      <TrashIcon /> 초기화
                    </button>
                  </div>
                </div>

                {coords && (
                  <div className="h-[280px] rounded-lg overflow-hidden border border-slate-600">
                    <MapView
                      latitude={coords.lat}
                      longitude={coords.lng}
                      onAddressSelect={(addr, lat, lng) => { setCurrentGpsAddress(addr); setCoords({ lat, lng }); }}
                      savedLocations={(locFieldFilter === '없음' ? [] : allLocations.filter(l => ((l.lat && l.lng) || l.address?.trim()) && (locFieldFilter === '전체' || fieldOf(l) === locFieldFilter) && (locYearFilter === '전체' || yearOfId(l.id) === locYearFilter))).map(l => {
                        const baseId = l.id.split('-').slice(0, 3).join('-');
                        const appMatch = applications.find(a => a.receipt_no === baseId || a.receipt_no === l.id);
                        const resolvedSiteName = overrideFor(l.id) || l.siteName || appMatch?.site_name || '';
                        return { id: l.id, lat: l.lat, lng: l.lng, siteName: resolvedSiteName, address: l.address, category: fieldOf(l) };
                      })}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
        )}

        {/* ── P1~P5 페이지 선택 (예전 위치, 패널 아래 고정) ── */}
        {pageNav}

        {activePageContent}

        {userRole === 'admin' && <AdminPanel adminUserName={userName} />}

        {/* ── 현장계수 수분석 (주간표) ── */}
        <FieldAnalysisModal isOpen={showFieldAnalysis} onClose={() => setShowFieldAnalysis(false)} />

        {/* ── 카카오톡 전송 모달 ── */}
        {showKakaoTalkModal && (
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-10 pb-4 px-2 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setShowKakaoTalkModal(false); }}
          >
            <div className="w-full max-w-2xl relative">
              <button
                onClick={() => setShowKakaoTalkModal(false)}
                className="absolute -top-8 right-0 text-slate-400 hover:text-white text-xs px-3 py-1 bg-slate-800 rounded-full border border-slate-700 transition-colors"
              >
                ✕ 닫기
              </button>
              <KakaoTalkPage userName={userName} userContact={userContact} />
            </div>
          </div>
        )}

        <Footer />
      </div>
    </div>

    {extraPhotoModal && (
      <ExtraPhotoModal
        isOpen={true}
        onClose={() => setExtraPhotoModal(null)}
        receiptNumber={extraPhotoModal.receiptNumber}
        itemName={extraPhotoModal.itemName}
        photos={extraPhotoMap[extraPhotoModal.receiptNumber] ?? []}
        onPhotosChange={(photos) => handleExtraPhotosChange(extraPhotoModal.receiptNumber, photos)}
        userName={userName}
        siteLocation={finalSiteLocation}
      />
    )}
    </>
  );
};

export default PageContainer;
