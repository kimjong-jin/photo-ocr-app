import React, { useState, useCallback, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from './ActionButton';
import { ImageInput, ImageInfo } from './ImageInput';
import { Spinner } from './Spinner';
import { extractTextFromImage } from '../services/geminiService';
import { Type } from '@google/genai';
import { preprocessImageForGemini } from '../services/imageProcessingService';
import { supabase } from '../services/supabaseClient';
import { sendKakaoTalkMessage } from '../services/claydoxApiService';
import { searchAddressByKeyword, enforceFullRegionPrefix } from '../services/kakaoService';
import { saveLocation } from '../services/locationService';
import EmailModal from './EmailModal';

export interface Application {
  id: number;
  created_at: string;
  queue_slot: number | null;
  receipt_no: string;
  site_name: string; // 현장
  representative_name: string; // 대표자
  representative_phone?: string; // 대표전화 (현장 대표번호 — 신청인 휴대폰과 별개)
  site_address?: string; // 현장 주소 (역검색 위치)
  applicant_name: string; // 신청인
  applicant_phone: string; // 휴대폰
  applicant_email: string; // 이메일
  maintenance_company?: string;
  user_name?: string;
  p1_check?: boolean;
  p2_check?: boolean;
  p3_check?: boolean;
  p4_check?: boolean;
  p5_check?: boolean;
  p6_check?: boolean;
  p7_check?: boolean;
}

interface ApplicationOcrSectionProps {
  userName: string;
  userContact: string;
  onApplicationSelect: (app: Application) => void;
  siteNameToSync: string;
  appIdToSync: number | null;
  receiptNumberCommonToSync: string;
  applications: Application[];
  setApplications: React.Dispatch<React.SetStateAction<Application[]>>;
  isLoadingApplications: boolean;
  loadApplications: (showError?: (msg: string) => void) => void;
  /** 접수번호별 각 페이지 전송 완료 여부: { '26-031078-01': { P1: true, P2: true, ... } } */
  transmissionSummary?: Record<string, Record<string, boolean>>;
}

// 🔍 역검색 카카오 검색어 후보: 현장명이 "주식회사 블루골드 (용암공공폐수처리시설）"처럼
// 회사명+괄호 시설명+전각문자로 지저분해도 검색되도록 후보를 우선순위대로 생성.
// 순서: 괄호 안 실제 시설명 → 회사형태(주식회사 등) 제거 코어 → 괄호 밖 → 원본 전체.
function buildSiteSearchTerms(raw: string): string[] {
  const s = (raw || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, ' ').trim();
  const inParen = (s.match(/\(([^)]*)\)/)?.[1] || '').trim();       // 괄호 안 = 실제 현장/시설명
  const noParen = s.replace(/\([^)]*\)/g, '').trim();                // 괄호 밖 = 보통 회사명
  const stripCo = noParen.replace(/(주식회사|유한회사|㈜|㈔|\(주\)|\(유\)|\(재\)|\(사\))/g, '').trim();
  const ordered = [inParen, stripCo, noParen, s];
  return [...new Set(ordered)].filter(t => t && t.length >= 2);
}

// 먹는물 여부: 접수번호에 세부순번(-N)이 붙어 4파트면 먹는물(주소·현장 역검색 제외, 대표자·대표전화만)
const isEatWaterReceipt = (receiptNo: string): boolean => (receiptNo || '').split('-').length === 4;

// 한국 전화번호 하이픈 포맷: '0522310114' → '052-231-0114'
function formatKoreanPhone(raw: string): string {
  const s = (raw || '').trim();
  const d = s.replace(/[^\d]/g, '');
  if (!d) return s;
  if (d.startsWith('02')) {                                   // 서울(지역번호 2자리)
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length === 9)  return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    return s;
  }
  if (d.length === 8)  return `${d.slice(0, 4)}-${d.slice(4)}`;             // 1588-0000 대표번호
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;   // 010/0503 등
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;   // 052-231-0114
  return s;
}

const TrashIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.03 3.22.077m3.22-.077L10.88 5.79m2.558 0c-.29.042-.58.083-.87.124" />
  </svg>
);

const EditIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const SaveIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const CancelIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

const EmailIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

// 접수번호 정규화: 전각숫자→반각, 비표준 하이픈→'-', 모든 공백(NBSP 포함) 제거.
// (PageContainer.normalizeReceiptNumberComponent 와 동일 규칙 — 순환 import 방지 위해 로컬 복제)
function normalizeReceiptNo(str?: string): string {
  if (!str) return '';
  let n = String(str).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  n = n.replace(/[－—–−]/g, '-');
  n = n.replace(/[\s 　]/g, '');
  return n;
}

const ApplicationOcrSection: React.FC<ApplicationOcrSectionProps> = ({
  userName,
  userContact,
  onApplicationSelect,
  siteNameToSync,
  appIdToSync,
  receiptNumberCommonToSync,
  applications,
  setApplications,
  isLoadingApplications,
  loadApplications,
  transmissionSummary = {},
}) => {
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editedData, setEditedData] = useState<Partial<Application>>({});
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set()); // 선택 삭제용
  const [kakaoSendingId, setKakaoSendingId] = useState<number | null>(null);
  const [emailModalApp, setEmailModalApp] = useState<Application | null>(null);
  // 🔍 회사 역검색(확인용) — 현장명 기준으로 대표전화/대표자 조회. 자동저장 아님, '적용' 눌러야 반영.
  const [lookupId, setLookupId] = useState<number | null>(null);       // 조회 중인 app.id
  const [lookupOpenId, setLookupOpenId] = useState<number | null>(null); // 팝오버 열린 app.id
  const [lookupAnchor, setLookupAnchor] = useState<{ top: number; left: number } | null>(null); // 팝오버 고정위치(overflow 클리핑 회피)
  const [lookupResult, setLookupResult] = useState<Record<number, {
    kakao: { phone: string; place_name: string; road_address_name?: string; address_name?: string }[];
    ai: { representative: string; phone: string; address: string; companyName: string; confidence: string; note: string } | null;
    // 🗺️ 카카오 vs 구글 vs 네이버 대조 (place-consensus)
    consensus?: {
      sources: {
        kakao: { name: string; address: string; phone: string } | null;
        google: { name: string; address: string; phone: string } | null;
        naver: { name: string; address: string; phone: string } | null;
      };
      consensus: { address: string; phone: string; addressAgree: boolean; phoneAgree: boolean; note: string };
    } | null;
    consensusLoading?: boolean;
    error?: string;
  }>>({});
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // KTL 실시간 접수번호 존재 여부: true=있음, false=없음, null=확인중
  const [receiptStatuses, setReceiptStatuses] = useState<Record<string, boolean | null>>({});
  // 이미 조회된 접수번호 캐시 (siteName 등 변경 시 재조회 방지)
  const ktlCacheRef = useRef<Record<string, { exists: boolean; ktlInfo: KtlDetail | null }>>({});

  interface KtlDetail {
    companyName?: string;
    representativeName?: string;
  }
  // KTL 상세 정보 (회사명 및 대표자명)
  const [ktlDetails, setKtlDetails] = useState<Record<string, KtlDetail | null>>({});

  // 한글 base64 디코딩용 함수
  const decodeBase64Ko = (base64: string): string => {
    try {
      if (!base64) return '';
      const binString = atob(base64);
      const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      console.error('Base64 decode error:', e);
      return '';
    }
  };

  // 목록 로드 시 KTL API로 접수번호 실시간 확인 (캐시된 결과 재사용)
  useEffect(() => {
    if (applications.length === 0) return;

    // 캐시에 없는 새 접수번호만 필터링
    const newApps = applications.filter(app =>
      app.receipt_no && ktlCacheRef.current[app.receipt_no] === undefined
    );

    // 캐시된 결과는 즉시 state에 반영 (기존 state 유지 + 캐시 병합)
    setReceiptStatuses(prev => {
      const merged = { ...prev };
      applications.forEach(app => {
        if (!app.receipt_no) return;
        const cached = ktlCacheRef.current[app.receipt_no];
        if (cached !== undefined) merged[app.receipt_no] = cached.exists;
        else if (merged[app.receipt_no] === undefined) merged[app.receipt_no] = null; // 확인중
      });
      return merged;
    });
    setKtlDetails(prev => {
      const merged = { ...prev };
      applications.forEach(app => {
        if (!app.receipt_no) return;
        const cached = ktlCacheRef.current[app.receipt_no];
        if (cached !== undefined) merged[app.receipt_no] = cached.ktlInfo;
      });
      return merged;
    });

    if (newApps.length === 0) return; // 새 접수번호 없으면 API 호출 안 함

    // 새 접수번호만 확인 중으로 표시
    setReceiptStatuses(prev => {
      const updated = { ...prev };
      newApps.forEach(app => { if (app.receipt_no) updated[app.receipt_no] = null; });
      return updated;
    });

    const checkNew = async () => {
      const results = await Promise.allSettled(
        newApps.map(async (app) => {
          const rcpn = app.receipt_no?.trim() ?? '';
          const parts = rcpn.split('-');
          const hasSequence = parts.length === 4;
          const baseRcpn = hasSequence ? parts.slice(0, 3).join('-') : rcpn;
          const isValidFormat = /^\d{2}-\d{6}-\d{2}$/.test(baseRcpn);
          if (!isValidFormat) return { receipt_no: rcpn, exists: false, ktlInfo: null };
          try {
            // 존재확인은 항상 base-1로 probe (내부 세부번호가 KTL 회차와 안 맞아 생기는 오탐 방지)
            const limsclientId = `${baseRcpn}-1`;
            const res = await fetch(`/api/ktl-proxy?id=${encodeURIComponent(limsclientId)}`);
            const data = await res.json();
            const isSuccess = data.Success === true || data.Success === 'true' || data.Success === 'True';
            let ktlInfo: KtlDetail | null = null;
            if (isSuccess && data.Results) {
              ktlInfo = {
                companyName: decodeBase64Ko(data.Results.EXRS_BSAC_NM),
                representativeName: decodeBase64Ko(data.Results.EXRS_RPPR_NM),
              };
            }
            return { receipt_no: rcpn, exists: isSuccess, ktlInfo };
          } catch {
            return { receipt_no: rcpn, exists: false, ktlInfo: null };
          }
        })
      );
      const statuses: Record<string, boolean | null> = {};
      const details: Record<string, KtlDetail | null> = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          statuses[r.value.receipt_no] = r.value.exists;
          details[r.value.receipt_no] = r.value.ktlInfo;
          // 캐시에 저장 → 이후 applications 변경 시 재조회 없음
          ktlCacheRef.current[r.value.receipt_no] = { exists: r.value.exists, ktlInfo: r.value.ktlInfo };
        }
      });
      setReceiptStatuses(prev => ({ ...prev, ...statuses }));
      setKtlDetails(prev => ({ ...prev, ...details }));
    };
    checkNew();
  }, [applications]);

  // '맨 아래 보기'를 유지할지 여부 (사용자가 위로 스크롤하면 false)
  const stickBottomRef = useRef(true);

  // 목록/선택 변경 시: 선택(작업중) 항목 있으면 위로 고정, 없으면 맨 아래(최신)로
  useLayoutEffect(() => {
    const el = tableContainerRef.current;
    if (!el || applications.length === 0) return;
    if (appIdToSync != null) {
      el.scrollTop = 0;
      stickBottomRef.current = false;
    } else {
      el.scrollTop = el.scrollHeight;
      stickBottomRef.current = true;
    }
  }, [applications, appIdToSync]);

  // KTL 상태·회사명·대표자가 비동기로 로드돼 행 높이가 커져도 '맨 아래 보기'를 유지.
  // (사용자가 위로 스크롤한 상태면 stickBottomRef=false라 방해하지 않음)
  useEffect(() => {
    const el = tableContainerRef.current;
    const content = el?.querySelector('table');
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (appIdToSync == null && stickBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [appIdToSync]);

  // 컨테이너 스크롤 시 '바닥 근접' 여부 기록 → 위로 올리면 바닥 고정 해제
  const handleTableScroll = useCallback(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newApplicationData, setNewApplicationData] = useState<Partial<Application>>({});
  const [ocrApiMode, setOcrApiMode] = useState<'gemini' | 'vllm'>(() => {
    const saved = localStorage.getItem('ocrApiMode');
    return (saved === 'gemini' || saved === 'vllm') ? saved : 'vllm';
  });
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
  };

  useEffect(() => {
    const handleUpdate = () => {
      console.log('Application list update event received. Refreshing list.');
      loadApplications();
    };
    window.addEventListener('applicationsUpdated', handleUpdate);
    return () => window.removeEventListener('applicationsUpdated', handleUpdate);
  }, [loadApplications]);

  // 최신 applications를 ref로 보관 (effect 재실행 없이 현재값만 읽기 위함)
  const applicationsRef = useRef(applications);
  applicationsRef.current = applications;

  // 작업폼의 현장명(siteNameToSync)을 저장된 목록의 해당 접수에 동기화.
  // ⚠️ deps에서 applications 제거 — 넣으면 '목록에서 현장명 직접 수정'이 applications 변경을 유발해
  //    이 effect가 재실행되며 옛 siteNameToSync로 되돌리는 롤백 버그(크롬에서 재현)를 일으킴.
  //    siteNameToSync가 '실제로 바뀔 때'만 동기화하고, 현재값은 ref로 읽는다.
  useEffect(() => {
    const syncSiteName = async () => {
      if (appIdToSync === null || !supabase) return;
      if (!siteNameToSync) return; // 빈 값으로 기존 현장명을 지우지 않음
      const appToUpdate = applicationsRef.current.find((app) => app.id === appIdToSync);
      if (!appToUpdate || appToUpdate.site_name === siteNameToSync) return; // 이미 같으면 skip
      const { error } = await supabase
        .from('applications')
        .update({ site_name: siteNameToSync })
        .eq('id', appIdToSync);
      if (!error) {
        setApplications((prevApps) =>
          prevApps.map((app) =>
            app.id === appIdToSync ? { ...app, site_name: siteNameToSync } : app,
          ),
        );
      } else {
        console.error('Failed to sync site name to Supabase:', error);
      }
    };
    syncSiteName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteNameToSync, appIdToSync, setApplications]);

  useEffect(() => {
    const syncReceiptNumber = async () => {
      if (appIdToSync !== null && receiptNumberCommonToSync.trim() && supabase) {
        const appToUpdate = applications.find((app) => app.id === appIdToSync);
        if (appToUpdate && appToUpdate.receipt_no) {
          const parts = appToUpdate.receipt_no.split('-');
          let detailPart = '';
          let currentCommonPart = appToUpdate.receipt_no;

          if (parts.length > 3) {
            detailPart = parts.pop() || '';
            currentCommonPart = parts.join('-');
          }

          if (receiptNumberCommonToSync !== currentCommonPart) {
            const newReceiptNo = detailPart
              ? `${receiptNumberCommonToSync}-${detailPart}`
              : receiptNumberCommonToSync;
            const { error } = await supabase
              .from('applications')
              .update({ receipt_no: newReceiptNo })
              .eq('id', appIdToSync);

            if (!error) {
              setApplications((prevApps) =>
                prevApps.map((app) =>
                  app.id === appIdToSync ? { ...app, receipt_no: newReceiptNo } : app,
                ),
              );
            } else {
              console.error('Failed to sync receipt number to Supabase:', error);
            }
          }
        }
      }
    };
    syncReceiptNumber();
  }, [receiptNumberCommonToSync, appIdToSync, applications, setApplications]);

  const handleImagesSet = useCallback((images: ImageInfo[]) => {
    setImage(images[0] || null);
    clearMessages();
  }, []);

  const handleAnalyzeAndSave = async () => {
    if (!image) {
      setError('분석할 이미지를 먼저 업로드해주세요.');
      return;
    }
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }

    setIsProcessing(true);
    clearMessages();

    const originalApiMode = localStorage.getItem('apiMode') || 'gemini';
    localStorage.setItem('apiMode', ocrApiMode);

    try {
      // ✅ DB에서 직접 가장 높은 순번을 조회 (목록 로딩 지연으로 인한 중복 방지)
      const { data: maxSlotData } = await supabase
        .from('applications')
        .select('queue_slot')
        .eq('user_name', userName)
        .order('queue_slot', { ascending: false })
        .limit(1)
        .single();
      
      const currentMaxSlot = maxSlotData?.queue_slot ?? 0;
      const provisionalSlot = currentMaxSlot + 1;

      const geminiPrompt = `
너는 '검사(시험)신청서' 이미지에서 지정 필드만 추출하는 OCR 파서다.
반드시 단일 JSON 한 줄만 출력하고, 다른 텍스트는 금지한다.

[출력 스키마(모두 문자열)]
{"receipt_no":"","site_name":"","representative_name":"","applicant_name":"","applicant_phone":"","applicant_email":""}

[출력 형식]
- 출력은 위 6개 키만 포함한 단일 JSON 객체 1개만 허용한다.
- 마크다운 코드블록과 설명 문장은 절대 출력하지 마라.
- 줄바꿈 없이 한 줄로만 출력한다.

[필드별 매핑 규칙]
- site_name: 신청서의 "성적서 발급" 표에 있는 "회사명" → 현장
- representative_name: "성적서 발급" 표에 있는 "대표자" → 대표자
- applicant_name: "신청인" 섹션의 "성명" → 신청인
- applicant_phone: "신청인" 섹션의 "휴대폰" → 휴대폰
- applicant_email: "신청인" 섹션의 "E-mail" → 이메일

[추출 규칙 (필드별 의미와 대략적 위치)]
- receipt_no:
  - 문서 맨 위 오른쪽 상단에 있는 '접수번호' 라벨 옆 값.
  - 보통 바코드 또는 QR 코드 근처 상단 박스 안에 위치한다.
  - 예: 25-069243-01.
  - 앞뒤 공백만 제거(trim)하고, 형식이 달라도 원문 그대로 유지한다.
  - 없으면 ""(빈 문자열)로 둔다.

- site_name:
  - 문서 중단부의 "성적서 발급" 섹션 표에서 '회사명' 칸의 값.
  - "성적서 발급" 제목 바로 아래 표에서 첫 번째 행/열에 위치하는 회사명을 사용한다.
  - 회사명에 부서명('과', '팀' 등)이 포함된 경우, 전체를 하나의 문자열로 추출한다.
    - 예: 포항시 맑은물사업본부 정수과.
  - 단, 다음과 같은 발급기관/기관장 이름은 site_name으로 사용하면 안 된다:
    - "한국산업기술시험원"
    - "한국산업기술시험원장"
    - "산업기술시험원장"
    - 위와 유사한 발급기관 이름/직함(원장, 소장 등)을 포함하는 문자열
  - 이런 값이 보이면 무시하고, 실제 시험·검사를 의뢰한 현장 이름만 site_name으로 추출한다.
  - 회사명 안에 "(인)", "(서명)", "직인" 같은 표기들은 절대 포함하지 말고 제거한다.

- representative_name:
  - 같은 "성적서 발급" 섹션 표에서 '대표자' 칸의 값.
  - '회사명'과 같은 표 안에서, '대표자' 라벨이 붙어 있는 셀의 이름을 가져온다.
  - 대표자 이름 뒤에 붙는 "(인)", "(서명)", "직인" 등은 모두 제거하고 이름만 남긴다.

- applicant_name:
  - 문서 하단의 "신청인" 섹션에서 '성명' 칸의 값.
  - 보통 서명란 또는 도장란 근처, '신청인' 제목 아래 표 안에 위치한다.
  - 이름 뒤에 붙는 "(인)", "(서명)", "직인" 등은 모두 제거하고 이름만 남긴다.
    - 예: "홍길동(인)" → "홍길동"

- applicant_email:
  - 같은 "신청인" 섹션에서 E-mail(또는 '이메일') 칸의 값.
  - 앞뒤 공백을 제거한 뒤 소문자화한다.

- applicant_phone:
  - 같은 "신청인" 섹션에서 '휴대폰' 또는 '핸드폰' 라벨이 붙은 칸의 값.
  - 반드시 휴대폰 번호(010, 011, 016, 017, 018, 019로 시작하는 번호)만 사용한다.
  - 02-, 031-, 054-, 055- 등 지역번호(일반 전화번호)로 시작하는 번호는 휴대폰 번호가 아니므로 applicant_phone에 쓰지 말고 무시한다.
  - 휴대폰 번호가 여러 개 보이면 가장 대표로 보이는 하나만 선택한다.
  - 숫자만 추출해 010-0000-0000 또는 011-000-0000 형식으로 하이픈을 넣어 표준화하라.
  - 숫자는 가리지 말고 그대로 유지한다.
  - 번호 형식이 너무 애매하면 ""(빈 문자열)로 둔다.
  - 앞뒤 공백은 제거(trim)한다.

- 위 필드 중 어느 것이든 값이 확실치 않으면 ""(빈 문자열)로 둔다.
`;

      const modelConfig = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            receipt_no: { type: Type.STRING },
            site_name: { type: Type.STRING },
            representative_name: { type: Type.STRING },
            applicant_name: { type: Type.STRING },
            applicant_phone: { type: Type.STRING },
            applicant_email: { type: Type.STRING },
          },
          required: [
            'receipt_no',
            'site_name',
            'representative_name',
            'applicant_name',
            'applicant_phone',
            'applicant_email',
          ],
        },
      } as const;

      const { base64: preprocessedBase64, mimeType: preprocessedMimeType } =
        await preprocessImageForGemini(image.file, {
          maxWidth: 1600,
          jpegQuality: 0.9,
          grayscale: true,
        });

      const jsonString = await extractTextFromImage(
        preprocessedBase64,
        preprocessedMimeType,
        geminiPrompt,
        modelConfig,
      );

      // --- 후처리 헬퍼들 ---
      const INVALID_SITE_NAMES = ['한국산업기술시험원', '한국산업기술시험원장', '산업기술시험원장'];

      // (인), (서명), 직인 같은 표시 공통 제거
      const stripApprovalMarks = (value: string): string => {
        if (!value) return '';
        return value
          .replace(/\(\s*인\s*\)/g, '')
          .replace(/\(\s*서명\s*\)/g, '')
          .replace(/직인/g, '')
          .trim();
      };

      const sanitizeSiteName = (name: string): string => {
        if (!name) return '';
        const cleaned = stripApprovalMarks(name).trim();
        if (!cleaned) return '';
        if (INVALID_SITE_NAMES.some((bad) => cleaned.includes(bad))) {
          return '';
        }
        return cleaned;
      };

      const cleanPersonName = (name: string): string => {
        if (!name) return '';
        let result = stripApprovalMarks(name);
        // 끝에 남은 괄호 표기 하나 정도는 잘라버린다. 예: "홍길동 (팀장)"
        result = result.replace(/\([^)]*\)\s*$/g, '').trim();
        return result;
      };

      const normalizeMobile = (phone: string): string => {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        if (!digits) return '';
        const prefix = digits.slice(0, 3);
        const mobilePrefixes = ['010', '011', '016', '017', '018', '019'];
        if (!mobilePrefixes.includes(prefix)) {
          // 휴대폰 번호가 아니면 버린다
          return '';
        }
        if (digits.length === 10) {
          // 0111234567 → 011-123-4567
          return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
        if (digits.length === 11) {
          // 01012345678 → 010-1234-5678
          return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
        }
        // 길이가 이상하면 버림
        return '';
      };
      // -----------------------

      const rawOcrResult = JSON.parse(jsonString.trim());

      const ocrResult = {
        ...rawOcrResult,
        receipt_no: normalizeReceiptNo(rawOcrResult.receipt_no),
        site_name: sanitizeSiteName(rawOcrResult.site_name),
        representative_name: cleanPersonName(rawOcrResult.representative_name),
        applicant_name: cleanPersonName(rawOcrResult.applicant_name),
        applicant_phone: normalizeMobile(rawOcrResult.applicant_phone),
      };

      // 본인 중복 차단: 같은 사용자가 이미 보유한 접수번호는 불가 (다른 관리자는 같은 번호 보유 가능)
      const ocrDup = applications.find(
        (a) => (a.user_name || '') === userName && normalizeReceiptNo(a.receipt_no) === ocrResult.receipt_no,
      );
      if (ocrResult.receipt_no && ocrDup) {
        setError(`이미 ${userName}님이 접수번호 '${ocrResult.receipt_no}'를 보유 중입니다 — 본인 중복은 불가합니다. (다른 관리자는 같은 번호 보유 가능)`);
        return;
      }

      const newApp = {
        ...ocrResult,
        // ✅ AI 결과와 무관하게, DB에서 조회한 다음 순번을 사용
        queue_slot: provisionalSlot,
        user_name: userName,
      };

      const { error: insertError } = await supabase.from('applications').insert(newApp);

      if (insertError) {
        if (
          insertError.code === '23505' ||
          (insertError.message && insertError.message.includes('duplicate key'))
        ) {
          console.warn(
            `[OCR Save] Insert failed due to duplicate receipt_no '${ocrResult.receipt_no}'. Attempting to update instead.`,
          );

          const { data: existingData, error: fetchError } = await supabase
            .from('applications')
            .select('id, queue_slot')
            .eq('receipt_no', ocrResult.receipt_no)
            .single();

          if (fetchError || !existingData) {
            throw new Error(
              `중복된 항목 '${ocrResult.receipt_no}'을(를) 업데이트하는데 실패했습니다: 기존 데이터를 찾을 수 없습니다.`,
            );
          }

          const dataToUpdate = {
            ...ocrResult,
            queue_slot: existingData.queue_slot,
            user_name: userName,
          };

          const { error: updateError } = await supabase
            .from('applications')
            .update(dataToUpdate)
            .eq('id', existingData.id);

          if (updateError) {
            throw new Error(
              `중복된 항목 '${ocrResult.receipt_no}' 업데이트 실패: ${updateError.message}`,
            );
          }

          setSuccessMessage(
            `'${ocrResult.receipt_no}' 데이터가 성공적으로 업데이트되었습니다 (중복 감지).`,
          );
        } else {
          throw insertError;
        }
      } else {
        setSuccessMessage(`'${ocrResult.receipt_no}' 데이터가 성공적으로 저장되었습니다.`);
      }

      loadApplications();
      setImage(null);
    } catch (err: any) {
      setError('작업 실패: ' + (err.message || '알 수 없는 오류가 발생했습니다.'));
    } finally {
      localStorage.setItem('apiMode', originalApiMode);
      setIsProcessing(false);
    }
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditedData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStartAdding = () => {
    setEditingId(null);
    setIsAddingNew(true);
    setNewApplicationData({
      receipt_no: '',
      site_name: '',
      representative_name: '',
      representative_phone: '',
      applicant_name: '',
      applicant_phone: '',
      applicant_email: '',
      p1_check: false,
      p2_check: false,
      p3_check: false,
      p4_check: false,
      p5_check: false,
      p6_check: false,
      p7_check: false,
    });
    // + 클릭 후 맨 아래로 스크롤하여 새 입력 행 표시
    setTimeout(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTop = tableContainerRef.current.scrollHeight;
      }
    }, 50);
  };

  const handleCancelAdding = () => {
    setIsAddingNew(false);
    setNewApplicationData({});
  };

  const handleNewDataChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setNewApplicationData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveNewApplication = async () => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }
    if (!newApplicationData.receipt_no || !newApplicationData.site_name) {
      setError('접수번호와 현장명은 필수 항목입니다.');
      return;
    }
    const newRcpn = normalizeReceiptNo(newApplicationData.receipt_no);
    // 본인 중복 차단: 같은 사용자가 이미 보유한 접수번호는 불가 (다른 관리자는 같은 번호 보유 가능)
    if (applications.find((a) => (a.user_name || '') === userName && normalizeReceiptNo(a.receipt_no) === newRcpn)) {
      setError(`이미 ${userName}님이 접수번호 '${newRcpn}'를 보유 중입니다 — 본인 중복은 불가합니다.`);
      return;
    }
    clearMessages();
    setIsProcessing(true);

    try {
      const dataToInsert: any = {
        ...newApplicationData,
        receipt_no: newRcpn,
        user_name: userName,
        queue_slot: newApplicationData.queue_slot
          ? Number(newApplicationData.queue_slot)
          : null,
      };
      delete dataToInsert.id;
      // 대표전화 미입력이면 필드 제거 — DB에 컬럼 추가 전에도 일반 추가가 깨지지 않도록.
      if (!dataToInsert.representative_phone) delete dataToInsert.representative_phone;

      const { error: insertError } = await supabase
        .from('applications')
        .insert(dataToInsert);

      if (insertError) {
        if (
          insertError.code === '23505' ||
          (insertError.message && insertError.message.includes('duplicate key'))
        ) {
          console.warn(
            `[Save New] Insert failed due to duplicate receipt_no '${dataToInsert.receipt_no}'. Attempting to update.`,
          );

          const { receipt_no, ...updateData } = dataToInsert;

          const { error: updateError } = await supabase
            .from('applications')
            .update(updateData)
            .eq('receipt_no', receipt_no);

          if (updateError) {
            throw new Error(
              `항목 '${receipt_no}'이(가) 이미 존재하여 업데이트를 시도했으나 실패했습니다: ${updateError.message}`,
            );
          }
          setSuccessMessage(`'${receipt_no}' 항목이 이미 존재하여 내용이 업데이트되었습니다.`);
        } else {
          throw insertError;
        }
      } else {
        setSuccessMessage(`'${dataToInsert.receipt_no}'이(가) 성공적으로 추가되었습니다.`);
      }

      setIsAddingNew(false);
      setNewApplicationData({});
      loadApplications();
    } catch (err: any) {
      setError('작업 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 삭제/수정 핸들러들 ---
  const handleDeleteApplication = async (idToDelete: number) => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }
    const appToDelete = applications.find((app) => app.id === idToDelete);
    if (!appToDelete) {
      setError('삭제할 항목을 찾을 수 없습니다.');
      return;
    }

    clearMessages();
    try {
      const { error: deleteError } = await supabase
        .from('applications')
        .delete()
        .eq('id', idToDelete);

      if (deleteError) throw deleteError;

      const deletedSlot = appToDelete.queue_slot;
      if (deletedSlot !== null) {
        const appsToUpdate = applications
          .filter(
            (app) => app.queue_slot !== null && app.queue_slot > deletedSlot,
          )
          .map((app) => ({
            ...app,
            queue_slot: app.queue_slot! - 1,
          }));

        if (appsToUpdate.length > 0) {
          const { error: updateError } = await supabase
            .from('applications')
            .upsert(appsToUpdate);
          if (updateError) {
            console.error('Failed to re-sequence queue slots:', updateError);
          }
        }
      }

      setSuccessMessage(`'${appToDelete.receipt_no}' 데이터가 삭제되었습니다.`);
      loadApplications();
    } catch (err: any) {
      console.error('[handleDeleteApplication] error:', err);
      setError(
        '삭제 실패: ' + (err.message || '알 수 없는 오류가 발생했습니다.'),
      );
    }
  };

  const toggleAppSelected = (id: number) => {
    setSelectedAppIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (!supabase || selectedAppIds.size === 0) return;
    const ids = Array.from(selectedAppIds);
    if (!window.confirm(`선택한 ${ids.length}개 항목을 삭제할까요?`)) return;
    clearMessages();
    try {
      const { error: deleteError } = await supabase
        .from('applications')
        .delete()
        .in('id', ids);
      if (deleteError) throw deleteError;
      setSuccessMessage(`${ids.length}개 항목이 삭제되었습니다.`);
      setSelectedAppIds(new Set());
      loadApplications();
    } catch (err: any) {
      console.error('[handleDeleteSelected] error:', err);
      setError('삭제 실패: ' + (err.message || '알 수 없는 오류가 발생했습니다.'));
    }
  };

  const handleEdit = (app: Application) => {
    setEditingId(app.id);
    setEditedData(app);
    setIsAddingNew(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditedData({});
  };

  const handleSaveEdit = async (id: number) => {
    if (!supabase) {
      setError('데이터베이스에 연결할 수 없습니다.');
      return;
    }

    const { id: appId, created_at, user_name, ...dataToUpdate } =
      editedData as Application;

    const editRcpn = normalizeReceiptNo(dataToUpdate.receipt_no);
    // 본인 중복 차단: 이 행의 소유자가 (이 행을 제외하고) 같은 접수번호를 이미 보유하면 불가
    const owner = applications.find((a) => a.id === id)?.user_name || '';
    if (editRcpn && applications.find((a) => a.id !== id && (a.user_name || '') === owner && normalizeReceiptNo(a.receipt_no) === editRcpn)) {
      setError(`${owner || '이 사용자'}님이 이미 접수번호 '${editRcpn}'를 보유 중입니다 — 본인 중복은 불가합니다.`);
      return;
    }

    const finalData = {
      ...dataToUpdate,
      ...(dataToUpdate.receipt_no !== undefined ? { receipt_no: editRcpn } : {}),
      queue_slot: dataToUpdate.queue_slot
        ? Number(dataToUpdate.queue_slot)
        : null,
    };

    const { error } = await supabase
      .from('applications')
      .update(finalData)
      .eq('id', id);

    if (error) {
      setError('업데이트 실패: ' + error.message);
    } else {
      loadApplications();
      setEditingId(null);
      setEditedData({});
    }
  };
  // ---------------------------

  const handleCheckChange = async (
    appId: number,
    checkField: keyof Application,
    isChecked: boolean,
  ) => {
    if (!supabase) return;

    const originalApplications = applications;
    setApplications((prev) =>
      prev.map((app) =>
        app.id === appId ? { ...app, [checkField]: isChecked } : app,
      ),
    );

    const { error } = await supabase
      .from('applications')
      .update({ [checkField]: isChecked })
      .eq('id', appId);

    if (error) {
      setApplications(originalApplications);

      if (error.message.includes('column') && error.message.includes('does not exist')) {
        setError(
          `'${String(
            checkField,
          )}' 상태를 저장할 수 없습니다. 데이터베이스에 해당 열이 존재하지 않습니다. Supabase 스튜디오에서 'applications' 테이블에 '${String(
            checkField,
          )}' (boolean 타입) 열을 추가해주세요.`,
        );
      } else {
        setError(`'${String(checkField)}' 상태 업데이트 실패: ${error.message}`);
      }
    } else {
      clearMessages();
    }
  };

  // 🔍 회사 역검색: 현장명 기준으로 카카오(정확한 전화)+AI(대표자 추정) 조회. 결과는 확인용, 자동저장 안 함.
  // 논블로킹: 팝오버를 즉시 열고 각 소스가 도착하는 대로 채움(스피너만 돌고 무반응하는 문제 방지). AI엔 20초 타임아웃.
  const handleCompanyLookup = (app: Application, ev?: React.MouseEvent) => {
    if (lookupOpenId === app.id) { setLookupOpenId(null); return; }  // 이미 열려있으면 토글 닫기
    const site = (app.site_name || '').trim();
    if (!site) { setError('현장명이 없어 검색할 수 없습니다.'); return; }
    // 결과는 항상 화면 중앙 아래(하단시트+딤배경)로 — 데스크톱/모바일 공통. 확인 후 적용 결정.
    setLookupAnchor(null);
    setLookupId(app.id);
    setLookupOpenId(app.id);
    setLookupResult(prev => ({ ...prev, [app.id]: { kakao: [], ai: null } })); // 즉시 로딩 상태로 팝오버 오픈

    let done = 0;
    const finish = () => { if (++done >= 2) setLookupId(null); };

    // 🗺️ 지도 3사 대조 → 그 결과를 AI에 넘겨 "최종 판정"까지 (AI가 소스들 대조해 가장 정확한 값 결정)
    setLookupResult(prev => ({ ...prev, [app.id]: { ...(prev[app.id] || { kakao: [], ai: null }), consensusLoading: true } }));
    (async () => {
      let consensus: any = null;
      try {
        const r = await fetch(`/api/place-consensus?query=${encodeURIComponent(site)}`);
        consensus = r.ok ? await r.json() : null;
      } catch {}
      setLookupResult(prev => ({ ...prev, [app.id]: { ...(prev[app.id] || { kakao: [], ai: null }), consensus, consensusLoading: false } }));

      // AI 최종 판정 — 지도 3사 후보를 근거로 (28초 타임아웃)
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 28000);
      try {
        const r = await fetch('/api/company-lookup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteName: site, address: '', candidates: consensus?.sources || null }),
          signal: ctrl.signal,
        });
        const ai = r.ok ? await r.json() : null;
        setLookupResult(prev => ({ ...prev, [app.id]: { ...(prev[app.id] || { kakao: [], ai: null }), ai, error: ai ? undefined : 'AI 판정 실패(지도 참고)' } }));
      } catch {
        setLookupResult(prev => ({ ...prev, [app.id]: { ...(prev[app.id] || { kakao: [], ai: null }), error: 'AI 판정 시간초과(지도 참고)' } }));
      } finally { clearTimeout(to); finish(); }
    })();

    // 카카오(빠름) — 현장명이 지저분해도(회사명+괄호 시설명 등) 후보를 순차 검색해 첫 결과 사용
    (async () => {
      for (const term of buildSiteSearchTerms(site)) {
        const docs = await searchAddressByKeyword(term).catch(() => [] as any[]);
        if (docs && docs.length) {
          // 현장명과 가장 잘 맞는 결과만 남김(예: '고려제강 양산공장'에 '유산공장' 섞여 나오는 것 방지)
          const siteTokens = site.replace(/\([^)]*\)/g, ' ').replace(/[^\w가-힣]/g, ' ')
            .split(/\s+/).filter(t => t.length >= 2 && !/^(주식회사|유한회사|주식|회사)$/.test(t));
          const scored = docs.map((d: any) => ({
            d, score: siteTokens.reduce((n, t) => n + ((d.place_name || '').includes(t) ? 1 : 0), 0),
          }));
          const maxScore = Math.max(0, ...scored.map(s => s.score));
          const best = (maxScore > 0 ? scored.filter(s => s.score === maxScore) : scored).slice(0, 3);
          const kakao = best.map(({ d }) => ({
            phone: formatKoreanPhone(d.phone || ''), place_name: d.place_name || '',
            // 카카오는 '경남'처럼 지역명을 축약 → 전체명('경상남도')으로 복원
            road_address_name: enforceFullRegionPrefix(d.road_address_name || ''),
            address_name: enforceFullRegionPrefix(d.address_name || ''),
          }));
          setLookupResult(prev => ({ ...prev, [app.id]: { ...(prev[app.id] || { kakao: [], ai: null }), kakao } }));
          return;
        }
      }
    })().catch(() => {}).finally(finish);
  };

  // 팝오버 '적용' = 그 필드를 DB에 즉시 덮어쓰기(낙관적 반영). 팝오버는 열어둬 여러 항목 연속 적용 가능.
  // ※ 신청인/휴대폰(applicant_*)은 절대 대상 아님. 대표자·현장·대표전화·주소만.
  const applyField = async (
    app: Application,
    field: 'representative_name' | 'representative_phone' | 'site_name' | 'site_address',
    value: string,
    silent = false,
  ): Promise<boolean> => {
    let v = (value || '').trim();
    if (field === 'representative_phone') v = formatKoreanPhone(v); // 저장값도 하이픈 포맷
    if (!v || !supabase) return false;
    const prevApps = applications;
    setApplications(prev => prev.map(a => (a.id === app.id ? { ...a, [field]: v } : a))); // 낙관적 즉시 반영
    const { error } = await supabase.from('applications').update({ [field]: v }).eq('id', app.id);
    if (error) {
      setApplications(prevApps); // 롤백
      const colMissing = /column/i.test(error.message) && /exist/i.test(error.message);
      setError(colMissing
        ? `'${field}' 저장 실패 — DB에 컬럼이 없습니다. Supabase에서 컬럼을 추가하세요.`
        : `'${field}' 적용 실패: ${error.message}`);
      return false;
    }
    if (!silent) { clearMessages(); setSuccessMessage('적용(저장)되었습니다.'); }
    return true;
  };

  // 주소는 applications가 아니라 위치 도우미(locations)에 저장 → 접수번호(id)로 saveLocation. 서버가 지오코딩.
  const saveAddressToLocation = async (app: Application, address: string, silent = false): Promise<boolean> => {
    const addr = (address || '').trim();
    const id = (app.receipt_no || '').trim();
    if (!addr || !id) return false;
    try {
      await saveLocation({ id, address: addr, lat: 0, lng: 0, savedAt: Date.now(), siteName: app.site_name || '', category: isEatWaterReceipt(id) ? '먹는물' : '수질' });
      if (!silent) { clearMessages(); setSuccessMessage(`위치 도우미에 주소 저장: ${id}`); }
      return true;
    } catch (e: any) {
      setError('위치 저장 실패: ' + (e?.message || ''));
      return false;
    }
  };

  // '검증 후 전체 적용' — 대표자·대표전화(→applications) + 주소(→위치 도우미)를 한 번에. 현장명은 공식명 보존 위해 개별.
  // 전화·주소는 카카오(현장 직통) 우선, 없으면 AI. 대표자는 AI.
  const applyAllFromLookup = async (app: Application) => {
    const res = lookupResult[app.id];
    if (!res) return;
    const top = res.kakao[0];
    const phone = top?.phone || (res.ai?.phone || '');
    const address = top?.road_address_name || top?.address_name || (res.ai?.address ? enforceFullRegionPrefix(res.ai.address) : '');
    const rep = res.ai?.representative || '';
    const eatWater = isEatWaterReceipt(app.receipt_no); // 먹는물은 주소 제외
    let n = 0;
    if (rep && await applyField(app, 'representative_name', rep, true)) n++;
    if (phone && await applyField(app, 'representative_phone', phone, true)) n++;
    if (address && !eatWater && await saveAddressToLocation(app, address, true)) n++; // 주소 → 위치 도우미 생성
    setLookupOpenId(null); // 전체 적용 끝났으니 팝오버 닫기
    if (n > 0) { clearMessages(); setSuccessMessage(`검증 항목 ${n}개 전체 적용 완료 (주소는 위치 도우미)`); }
  };

  const handleSendKakao = async (app: Application) => {
    if (!userContact) { setError('담당자 연락처 정보가 없습니다.'); return; }
    if (!app.applicant_phone) { setError('신청인 휴대폰 번호가 없습니다.'); return; }
    clearMessages();
    setKakaoSendingId(app.id);
    try {
      const codeRes = await fetch('/api/issue-calc-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: userName, days: 10, applicantName: app.applicant_name || '', receiptNo: app.receipt_no || '', siteName: app.site_name || '' }),
      });
      const codeData = await codeRes.json();
      if (!codeRes.ok) throw new Error(codeData.error || '코드 발급 실패');
      const pw = codeData.pw as string;

      const message = `<시험·검사 배정 완료>
*현장: ${app.site_name}
*시험·검사 담당자: ${userName}
*연락처: ${userContact}

문의 사항은 이 메시지로 편하게 회신해 주세요. 시험·검사일에 뵙겠습니다.

[KTL 정도검사 계산기]
<유지관리 담당자 전달용>
홈페이지: https://aicalc.work
바로접속: https://aicalc.work/?pw=${pw}
비밀번호: ${pw}

※ 데이터를 직접 입력하시려면 화면 상단 [주사용자 전환] 버튼을 먼저 눌러주세요.
   (누르지 않으면 확인(읽기)만 가능합니다)
※ 정도검사 계산 확인용으로 유지관리 담당자에게 전달해 주시기 바랍니다.`;

      await sendKakaoTalkMessage(message, app.applicant_phone);
      const { error: updateError } = await supabase!
        .from('applications').update({ p5_check: true }).eq('id', app.id);
      if (updateError) throw updateError;
      setApplications(prev => prev.map(a => a.id === app.id ? { ...a, p5_check: true } : a));
      setSuccessMessage(`'${app.receipt_no}'으로 카카오톡 메시지를 전송했습니다.`);
    } catch (err: any) {
      setError('카카오톡 전송 실패: ' + err.message);
    } finally {
      setKakaoSendingId(null);
    }
  };


  const handleEmailSentSuccess = async (appId: number) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('applications')
      .update({ p7_check: true })
      .eq('id', appId);
    if (error) {
      setError(`P7 체크 업데이트 실패: ${error.message}`);
    } else {
      setApplications((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, p7_check: true } : a)),
      );
      setSuccessMessage('이메일 전송 후 상태가 업데이트되었습니다.');
    }
  };

  const CHECK_COLUMNS: { key: keyof Application; label: string; title: string }[] = [
    { key: 'p5_check', label: '💬', title: '카카오톡 전송 완료' },
    { key: 'p7_check', label: '✉️', title: '이메일 전송 완료' },
  ];

  const editInputClass =
    'w-full bg-white text-slate-900 border-slate-400 rounded-md p-1 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none';

  if (!supabase) {
    return (
      <div className="pt-4 px-2 space-y-4">
        <p className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">
          데이터베이스에 연결할 수 없습니다. Supabase 환경 변수(URL, ANON_KEY)가
          올바르게 설정되었는지 확인해주세요.
        </p>
      </div>
    );
  }

  const totalColumns = 8 + CHECK_COLUMNS.length + 1; // No.·접수·현장·대표자·대표전화·신청인·휴대폰·이메일(8) + 체크 + 관리

  // 선택된 항목(작업 대상)을 목록 맨 위로 고정 — 정렬·새로고침에도 자리가 안 바뀌어
  // 접수번호/공통정보가 흔들리지 않게 한다. 다른 행 클릭 시엔 그 행이 새 선택이 된다.
  const displayApplications = useMemo(() => {
    if (appIdToSync == null) return applications;
    const sel = applications.find((a) => a.id === appIdToSync);
    if (!sel) return applications;
    return [sel, ...applications.filter((a) => a.id !== appIdToSync)];
  }, [applications, appIdToSync]);

  return (
    <div className="pt-4 px-2 space-y-4">
      {/* 컴팩트 한 줄 레이아웃 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* 파일 선택 (모바일에선 OS가 카메라 옵션 제공) */}
          <>
              <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-600 hover:bg-slate-500 text-white cursor-pointer transition-colors border border-slate-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {image ? '파일 변경' : '📁 파일 선택'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isProcessing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const base64 = (ev.target?.result as string).split(',')[1];
                      setImage({ file, base64, mimeType: file.type || 'image/jpeg' });
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {/* 분석 모드 + 분석및저장 오른쪽 */}
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setOcrApiMode('vllm'); localStorage.setItem('ocrApiMode', 'vllm'); }}
                    disabled={isProcessing}
                    className={`px-2.5 py-1.5 transition-colors ${
                      ocrApiMode === 'vllm' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    내부
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOcrApiMode('gemini'); localStorage.setItem('ocrApiMode', 'gemini'); }}
                    disabled={isProcessing}
                    className={`px-2.5 py-1.5 transition-colors border-l border-slate-600 ${
                      ocrApiMode === 'gemini' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    외부
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleAnalyzeAndSave}
                  disabled={isProcessing || !image || isLoadingApplications}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    isProcessing || !image || isLoadingApplications
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
                      : 'bg-sky-600 hover:bg-sky-500 text-white border border-sky-500'
                  }`}
                >
                  {isProcessing ? (
                    <><Spinner size="sm" /> 처리 중...</>
                  ) : isLoadingApplications ? '로딩 중...' : '⚡ 분석 및 저장'}
                </button>
              </div>

              {/* 선택된 파일 썸네일 */}
              {image && (
                <div className="flex items-center gap-2">
                  <img
                    src={`data:${image.mimeType};base64,${image.base64}`}
                    alt="미리보기"
                    className="h-8 w-8 rounded object-cover border border-slate-500"
                  />
                  <span className="text-xs text-sky-400 truncate max-w-[120px]">{image.file.name}</span>
                </div>
              )}
          </>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">
          {error}
        </p>
      )}
      {successMessage && (
        <p className="text-green-400 text-sm p-2 bg-green-900/30 rounded-md">
          {successMessage}
        </p>
      )}

      <div className="pt-4 border-t border-slate-700">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-xs font-semibold text-slate-400 tracking-widest uppercase">저장된 목록</h4>
          <div className="flex items-center gap-2">
            {selectedAppIds.size > 0 && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
                aria-label={`선택 ${selectedAppIds.size}개 삭제`}
                title={`선택한 ${selectedAppIds.size}개 삭제`}
              >
                <TrashIcon className="w-3.5 h-3.5" />
                {selectedAppIds.size}
              </button>
            )}
            <ActionButton
              onClick={handleStartAdding}
              disabled={isLoadingApplications || isAddingNew || editingId !== null}
              variant="secondary"
              className="!p-2"
              aria-label="새 항목 추가"
            >
              <PlusIcon className="w-5 h-5" />
            </ActionButton>
            <ActionButton
              onClick={() => loadApplications()}
              disabled={isLoadingApplications || isAddingNew}
              variant="secondary"
              className="!p-2"
              aria-label="목록 새로고침"
            >
              {isLoadingApplications ? <Spinner size="sm" /> : <RefreshIcon />}
            </ActionButton>
          </div>
        </div>
        <div
          ref={tableContainerRef}
          onScroll={handleTableScroll}
          className="overflow-auto bg-slate-800 rounded-lg border border-slate-700 transition-all duration-300"
          style={{ maxHeight: isTableExpanded ? '365px' : '205px', WebkitOverflowScrolling: 'touch' }}
        >
          <table className="w-max min-w-full divide-y divide-slate-600 text-sm">
            <thead className="bg-slate-700/50 sticky top-0 z-10">
              <tr>
                {(['No.', '접수번호', '현장', '대표자', '대표전화', '신청인', '휴대폰', '이메일'] as const).map(
                  (h) => {
                    const widthMap: Record<string, string> = {
                      'No.': 'w-12',
                      '접수번호': 'w-36',
                      '현장': 'w-64',
                      '대표자': 'w-28',
                      '대표전화': 'w-28',
                      '신청인': 'w-[5.5rem]',
                      '휴대폰': 'w-28',
                      '이메일': 'w-40',
                    };
                    return (
                      <th
                        key={h}
                        className={`px-3 py-2 text-xs font-medium text-slate-300 uppercase tracking-wider text-left sticky top-0 bg-slate-700/50 whitespace-nowrap ${widthMap[h] ?? ''} ${
                          h === 'No.' ? 'text-center' : ''
                        }`}
                      >
                        {h === 'No.' ? (
                          <span className="inline-flex flex-col items-center gap-0.5 leading-none">
                            <input
                              type="checkbox"
                              checked={applications.length > 0 && applications.every(a => selectedAppIds.has(a.id))}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedAppIds(new Set(applications.map(a => a.id)));
                                else setSelectedAppIds(new Set());
                              }}
                              className="w-3.5 h-3.5 accent-red-500 cursor-pointer"
                              aria-label="전체 선택"
                              title="전체 선택 / 해제"
                            />
                            <span className="text-[9px] normal-case tracking-normal">전체</span>
                          </span>
                        ) : h}
                      </th>
                    );
                  },
                )}
                {CHECK_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    className="px-2 py-2 text-base font-medium text-slate-300 text-center sticky top-0 bg-slate-700/50 cursor-help"
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs font-medium text-slate-300 uppercase tracking-wider sticky top-0 bg-slate-700/50">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {isLoadingApplications ? (
                <tr>
                  <td colSpan={totalColumns} className="text-center p-4 text-slate-400">
                    로딩 중...
                  </td>
                </tr>
              ) : applications.length === 0 && !isAddingNew ? (
                <tr>
                  <td colSpan={totalColumns} className="text-center p-4 text-slate-400">
                    저장된 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                displayApplications.map((app) =>
                  editingId === app.id ? (
                    <tr key={app.id} className="bg-sky-900/30">
                      <td className="p-1">
                        <input
                          name="queue_slot"
                          type="number"
                          value={editedData.queue_slot ?? ''}
                          onChange={handleEditInputChange}
                          className={`w-16 text-center ${editInputClass}`}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="receipt_no"
                          value={editedData.receipt_no ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="site_name"
                          value={editedData.site_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="representative_name"
                          value={editedData.representative_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1 min-w-[8rem]">
                        <input
                          name="representative_phone"
                          value={editedData.representative_phone ?? ''}
                          onChange={handleEditInputChange}
                          placeholder="대표전화"
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_name"
                          value={editedData.applicant_name ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_phone"
                          value={editedData.applicant_phone ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          name="applicant_email"
                          value={editedData.applicant_email ?? ''}
                          onChange={handleEditInputChange}
                          className={editInputClass}
                        />
                      </td>
                      {CHECK_COLUMNS.map((c) => (
                        <td key={c.key} className="p-1 text-center">
                          <input
                            type="checkbox"
                            name={c.key}
                            checked={!!editedData[c.key]}
                            onChange={(e) =>
                              setEditedData((prev) => ({
                                ...prev,
                                [c.key]: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded"
                          />
                        </td>
                      ))}
                      <td className="p-1 whitespace-nowrap text-center">
                        <button
                          onClick={() => handleSaveEdit(app.id)}
                          className="p-1.5 text-green-400 hover:text-white rounded-full transition-colors hover:bg-green-600"
                          aria-label="저장"
                        >
                          <SaveIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1.5 text-slate-400 hover:text-white rounded-full transition-colors hover:bg-slate-600"
                          aria-label="취소"
                        >
                          <CancelIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={app.id}
                      className={
                        app.id === appIdToSync
                          ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400/60 cursor-pointer'
                          : 'hover:bg-slate-700/30 cursor-pointer'
                      }
                      onClick={() => onApplicationSelect(app)}
                    >
                      <td
                        onClick={(e) => { e.stopPropagation(); toggleAppSelected(app.id); }}
                        className={`px-3 py-2 whitespace-nowrap text-center font-bold text-sky-400 cursor-pointer select-none ${
                          app.id === appIdToSync ? 'border-l-4 border-sky-400' : ''
                        }`}
                        title="클릭하여 선택 (삭제용)"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={selectedAppIds.has(app.id)}
                            readOnly
                            className="w-4 h-4 accent-red-500 pointer-events-none align-middle"
                            aria-label={`'${app.receipt_no}' 선택`}
                          />
                          {app.queue_slot}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-200 font-mono align-top w-36 max-w-[9rem] overflow-hidden">
                        {app.id === appIdToSync && (
                          <span className="block text-[9px] leading-none text-sky-300 font-semibold mb-0.5">
                            작업중
                          </span>
                        )}
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span
                            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                              receiptStatuses[app.receipt_no] === null
                                ? 'bg-yellow-400 animate-pulse'
                                : receiptStatuses[app.receipt_no] === true
                                ? 'bg-green-400'
                                : 'bg-red-500'
                            }`}
                            title={
                              receiptStatuses[app.receipt_no] === null
                                ? 'KTL 조회 중...'
                                : receiptStatuses[app.receipt_no] === true
                                ? `KTL 등록된 접수번호: ${app.receipt_no}`
                                : `KTL 미등록 접수번호: "${app.receipt_no}"`
                            }
                          />
                          {app.receipt_no}
                        </span>
                        {ktlDetails[app.receipt_no] && (ktlDetails[app.receipt_no]?.companyName || ktlDetails[app.receipt_no]?.representativeName) && (
                          <div
                            className="text-[10px] text-slate-400 mt-0.5 font-sans leading-tight font-normal break-words max-w-[9rem]"
                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                            title={`${ktlDetails[app.receipt_no]?.companyName || ''}${ktlDetails[app.receipt_no]?.representativeName ? ` (${ktlDetails[app.receipt_no]?.representativeName})` : ''}`}
                          >
                            {ktlDetails[app.receipt_no]?.companyName || ''}
                            {ktlDetails[app.receipt_no]?.representativeName ? ` (${ktlDetails[app.receipt_no]?.representativeName})` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-64 max-w-[16rem] overflow-hidden">
                        <div className="break-words text-xs leading-tight" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={app.site_name}>{app.site_name}</div>

                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-28 max-w-[7.5rem] overflow-hidden">
                        <div className="flex items-start gap-1">
                          <span className="break-words min-w-0 text-xs leading-tight" title={app.representative_name}>{app.representative_name}</span>
                          {/* 🔍 역검색: 수질=현장·주소·대표자·대표전화 전부 / 먹는물(세부순번 -N)=대표자·대표전화만 */}
                          {true && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCompanyLookup(app, e); }}
                              disabled={lookupId === app.id}
                              className="shrink-0 p-1 text-sky-400 hover:text-sky-300 rounded-full transition-colors hover:bg-sky-600/30 disabled:opacity-50"
                              title="현장명으로 대표전화·대표자 역검색 (확인용)"
                              aria-label="회사 정보 역검색"
                            >
                              {lookupId === app.id ? (
                                <Spinner size="sm" />
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.35-5.4a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                        {lookupOpenId === app.id && lookupResult[app.id] && createPortal(
                          <div
                            className="fixed inset-0 z-[9998]"
                            onClick={() => setLookupOpenId(null)}  /* 바깥 탭 → 닫기 */
                            style={lookupAnchor ? { background: 'transparent' } : { background: 'rgba(2,6,23,0.55)' }}
                          >
                          <div
                            className={`fixed z-[9999] bg-slate-900 border border-slate-600 rounded-lg shadow-2xl p-3 text-left font-sans normal-case whitespace-normal max-h-[75vh] overflow-y-auto ${lookupAnchor ? 'w-80 max-w-[92vw]' : 'w-[94vw] sm:w-96'}`}
                            style={lookupAnchor
                              ? { top: lookupAnchor.top, left: lookupAnchor.left, WebkitOverflowScrolling: 'touch' }
                              : { left: '50%', bottom: 10, transform: 'translateX(-50%)', WebkitOverflowScrolling: 'touch' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                                🔍 역검색 결과 (확인용){lookupId === app.id && <Spinner size="sm" />}
                              </span>
                              <button onClick={() => setLookupOpenId(null)} className="text-slate-400 hover:text-white text-base px-2 py-0.5 -my-0.5">✕</button>
                            </div>
                            <p className="text-[10px] text-amber-400 mb-2 leading-tight">
                              현장명 “{app.site_name}” 기준. <b>적용</b>을 누르면 바로 덮어쓰기(저장). {isEatWaterReceipt(app.receipt_no) ? <>먹는물(세부 {app.receipt_no.split('-').pop()})이라 <b>대표자·대표전화만</b> — 주소·현장은 직접 확인.</> : <>현장·주소·대표자·대표전화.</>} (신청인/휴대폰은 변경 안 함)
                            </p>
                            {/* 🗺️ 카카오 vs 구글 대조 — 일치하면 신뢰↑, 불일치면 확인 필요. 외부페이지 안 열림, 데이터만 비교. */}
                            {(() => {
                              const r = lookupResult[app.id];
                              const cs = r?.consensus?.consensus;
                              const kk = r?.consensus?.sources?.kakao;
                              const gg = r?.consensus?.sources?.google;
                              const nn = r?.consensus?.sources?.naver;
                              return (
                                <div className="mb-2 rounded-md border border-slate-700 bg-slate-800/40 p-2">
                                  <div className="text-[11px] text-slate-300 mb-1 font-semibold">🗺️ 지도 3사 대조 (합의) {cs?.note && <span className="font-normal text-slate-500">— {cs.note}</span>}</div>
                                  {r?.consensusLoading ? (
                                    <div className="text-[11px] text-slate-500">대조 중…</div>
                                  ) : !r?.consensus ? (
                                    <div className="text-[11px] text-slate-500">대조 결과 없음</div>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {/* 주소 대조 */}
                                      <div>
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <span className="text-[10px] text-slate-400">주소</span>
                                          <span className={`text-[9px] px-1 rounded ${cs!.addressAgree ? 'bg-emerald-700/50 text-emerald-200' : 'bg-amber-700/50 text-amber-200'}`}>{cs!.addressAgree ? '일치 ✓' : '불일치 ⚠'}</span>
                                          {cs!.address && !isEatWaterReceipt(app.receipt_no) && (
                                            <button onClick={() => saveAddressToLocation(app, cs!.address)} className="ml-auto shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline" title="위치 도우미에 저장">주소 적용 ↩</button>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-300">📍 카카오: {kk?.address || '—'}{(kk as any)?.jibun && <span className="text-slate-500"> · 구주소(지번): {(kk as any).jibun}</span>}</div>
                                        <div className="text-[10px] text-slate-300">📍 네이버: {nn?.address || '—'}</div>
                                        <div className="text-[10px] text-slate-300">📍 구글: {gg?.address || '—'}</div>
                                      </div>
                                      {/* 전화 대조 */}
                                      <div className="border-t border-slate-700/60 pt-1">
                                        <div className="flex items-center gap-1 mb-0.5">
                                          <span className="text-[10px] text-slate-400">대표전화</span>
                                          <span className={`text-[9px] px-1 rounded ${cs!.phoneAgree ? 'bg-emerald-700/50 text-emerald-200' : 'bg-amber-700/50 text-amber-200'}`}>{cs!.phoneAgree ? '일치 ✓' : ((kk?.phone || nn?.phone) && gg?.phone ? '불일치 ⚠' : '한쪽만')}</span>
                                          {cs!.phone && (
                                            <button onClick={() => applyField(app, 'representative_phone', cs!.phone)} className="ml-auto shrink-0 text-[11px] text-sky-300 hover:text-sky-200 underline" title="대표전화에 덮어쓰기">대표전화 적용 ↩</button>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-300">📞 카카오: {kk?.phone || '—'}</div>
                                        <div className="text-[10px] text-slate-300">📞 네이버: {nn?.phone || '—'}</div>
                                        <div className="text-[10px] text-slate-300">📞 구글: {gg?.phone || '—'}</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* 카카오 = 현장 위치(주소)·대표전화. 대표전화칸에만 적용, 신청인 휴대폰칸엔 절대 안 씀. */}
                            <div className="mb-2">
                              <div className="text-[11px] text-slate-400 mb-1">📍 위치·대표전화 (카카오 등록)</div>
                              {lookupResult[app.id].kakao.length === 0 ? (
                                <div className="text-[11px] text-slate-500">{lookupId === app.id ? '조회 중…' : '검색 결과 없음'}</div>
                              ) : (
                                lookupResult[app.id].kakao.map((k, i) => (
                                  <div key={i} className="py-1 border-b border-slate-800 last:border-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] text-slate-200 truncate">{k.place_name}</span>
                                      {k.place_name && !isEatWaterReceipt(app.receipt_no) && (
                                        <button onClick={() => applyField(app, 'site_name', k.place_name)}
                                          className="shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline" title="현장(현장명)에 덮어쓰기">현장 적용 ↩</button>
                                      )}
                                    </div>
                                    {!isEatWaterReceipt(app.receipt_no) && (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-slate-400 truncate">📍 {k.road_address_name || k.address_name || '주소 없음'}</span>
                                      {(k.road_address_name || k.address_name) && (
                                        <button onClick={() => saveAddressToLocation(app, k.road_address_name || k.address_name)}
                                          className="shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline" title="위치 도우미에 이 주소로 저장">주소 적용 ↩</button>
                                      )}
                                    </div>
                                    )}
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-slate-400">📞 {k.phone || '번호 없음'}</span>
                                      {k.phone && (
                                        <button onClick={() => applyField(app, 'representative_phone', k.phone)}
                                          className="shrink-0 text-[11px] text-sky-300 hover:text-sky-200 underline" title="대표전화에 덮어쓰기">대표전화 적용 ↩</button>
                                      )}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                            {/* AI = 대표자 추정(확인 필수) */}
                            <div className="border-t border-slate-700 pt-2">
                              <div className="text-[11px] text-slate-400 mb-1">🤖 AI 종합 판정 (지도 3사 대조 근거 · ⚠️ 확인 필수)</div>
                              {lookupResult[app.id].error && !lookupResult[app.id].ai ? (
                                <div className="text-[11px] text-rose-400">{lookupResult[app.id].error}</div>
                              ) : lookupResult[app.id].ai ? (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-slate-300">대표자: <b className="text-slate-100">{lookupResult[app.id].ai!.representative || '—'}</b></span>
                                    {lookupResult[app.id].ai!.representative && (
                                      <button
                                        onClick={() => applyField(app, 'representative_name', lookupResult[app.id].ai!.representative)}
                                        className="shrink-0 text-[11px] text-sky-300 hover:text-sky-200 underline"
                                        title="대표자에 덮어쓰기"
                                      >대표자 적용 ↩</button>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-slate-300">대표전화: <b className="text-slate-100">{lookupResult[app.id].ai!.phone ? formatKoreanPhone(lookupResult[app.id].ai!.phone) : '—'}</b></span>
                                    {lookupResult[app.id].ai!.phone && (
                                      <button
                                        onClick={() => applyField(app, 'representative_phone', lookupResult[app.id].ai!.phone)}
                                        className="shrink-0 text-[11px] text-sky-300 hover:text-sky-200 underline"
                                        title="대표전화에 덮어쓰기"
                                      >대표전화 적용 ↩</button>
                                    )}
                                  </div>
                                  {!isEatWaterReceipt(app.receipt_no) && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-slate-300">주소: <b className="text-slate-100 break-words">{lookupResult[app.id].ai!.address ? enforceFullRegionPrefix(lookupResult[app.id].ai!.address) : '—'}</b></span>
                                    {lookupResult[app.id].ai!.address && (
                                      <button onClick={() => saveAddressToLocation(app, enforceFullRegionPrefix(lookupResult[app.id].ai!.address))}
                                        className="shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline" title="위치 도우미에 이 주소로 저장">주소 적용 ↩</button>
                                    )}
                                  </div>
                                  )}
                                  {lookupResult[app.id].ai!.companyName && (
                                    <div className="text-[10px] text-slate-500">법인: {lookupResult[app.id].ai!.companyName}</div>
                                  )}
                                  <div className="text-[10px] text-slate-500">신뢰도: {lookupResult[app.id].ai!.confidence}</div>
                                  {lookupResult[app.id].ai!.note && (
                                    <div className="text-[10px] text-amber-500/80 leading-tight">※ {lookupResult[app.id].ai!.note}</div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500">{lookupId === app.id ? '조회 중…' : '추정 결과 없음'}</div>
                              )}
                            </div>
                            {/* 검증 후 전체 적용 — 대표자·대표전화·주소 한 번에 저장(현장명은 개별) */}
                            <button
                              onClick={() => applyAllFromLookup(app)}
                              disabled={lookupId === app.id}
                              className="mt-3 w-full py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[12px] font-semibold"
                              title="대표자·대표전화·주소를 한 번에 저장"
                            >✅ 검증 후 전체 적용 (대표자·대표전화·주소)</button>
                          </div>
                          </div>,
                          document.body,
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-28 max-w-[7rem] overflow-hidden">
                        <div className="truncate text-xs leading-tight" title={app.representative_phone || ''}>{app.representative_phone || <span className="text-slate-600">—</span>}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-[5.5rem] max-w-[5.5rem] overflow-hidden">
                        <div className="truncate text-xs leading-tight" title={app.applicant_name}>{app.applicant_name}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-28 max-w-[7rem] overflow-hidden">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs leading-tight min-w-0" title={app.applicant_phone}>{app.applicant_phone}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendKakao(app);
                            }}
                            disabled={kakaoSendingId === app.id}
                            className="shrink-0 p-1 text-yellow-400 hover:text-yellow-300 rounded-full transition-colors hover:bg-yellow-600/30 disabled:opacity-50"
                            aria-label={`'${app.applicant_name}'에게 카카오톡 보내기`}
                          >
                            {kakaoSendingId === app.id ? (
                              <Spinner size="sm" />
                            ) : (
                              <SendIcon className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top w-40 max-w-[10rem] overflow-hidden">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs leading-tight min-w-0" title={app.applicant_email}>{app.applicant_email}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmailModalApp(app);
                            }}
                            className="shrink-0 p-1 text-cyan-400 hover:text-cyan-300 rounded-full transition-colors hover:bg-cyan-600/30 disabled:opacity-50"
                            aria-label={`'${app.applicant_name}'에게 이메일 보내기`}
                          >
                            <EmailIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      {CHECK_COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap text-center">
                          <input
                            type="checkbox"
                            checked={!!app[c.key]}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleCheckChange(app.id, c.key, e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-sky-600 focus:ring-sky-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(app);
                          }}
                          className="p-1.5 text-sky-400 hover:text-white rounded-full transition-colors hover:bg-sky-600"
                          aria-label={`'${app.receipt_no}' 수정`}
                        >
                          <EditIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteApplication(app.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded-full transition-colors hover:bg-slate-700"
                          aria-label={`'${app.receipt_no}' 삭제`}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ),
                )
              )}
              {isAddingNew && (
                <tr className="bg-green-900/30">
                  <td className="p-1">
                    <input
                      name="queue_slot"
                      type="number"
                      value={newApplicationData.queue_slot ?? ''}
                      onChange={handleNewDataChange}
                      className={`w-16 text-center ${editInputClass}`}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="receipt_no"
                      value={newApplicationData.receipt_no ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                      required
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="site_name"
                      value={newApplicationData.site_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                      required
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="representative_name"
                      value={newApplicationData.representative_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1 min-w-[8rem]">
                    <input
                      name="representative_phone"
                      value={newApplicationData.representative_phone ?? ''}
                      onChange={handleNewDataChange}
                      placeholder="대표전화"
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_name"
                      value={newApplicationData.applicant_name ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_phone"
                      value={newApplicationData.applicant_phone ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      name="applicant_email"
                      value={newApplicationData.applicant_email ?? ''}
                      onChange={handleNewDataChange}
                      className={editInputClass}
                    />
                  </td>
                  {CHECK_COLUMNS.map((c) => (
                    <td key={c.key} className="p-1 text-center">
                      <input
                        type="checkbox"
                        name={c.key}
                        checked={!!newApplicationData[c.key]}
                        onChange={handleNewDataChange}
                        className="h-4 w-4 rounded"
                      />
                    </td>
                  ))}
                  <td className="p-1 whitespace-nowrap text-center">
                    <button
                      onClick={handleSaveNewApplication}
                      disabled={isProcessing}
                      className="p-1.5 text-green-400 hover:text-white rounded-full transition-colors hover:bg-green-600"
                      aria-label="저장"
                    >
                      <SaveIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelAdding}
                      disabled={isProcessing}
                      className="p-1.5 text-slate-400 hover:text-white rounded-full transition-colors hover:bg-slate-600"
                      aria-label="취소"
                    >
                      <CancelIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {applications.length > 4 && (
          <button
            onClick={() => setIsTableExpanded(prev => !prev)}
            className="w-full mt-1 py-1 text-xs text-slate-400 hover:text-sky-300 hover:bg-slate-700/40 rounded-md transition-colors"
          >
            {isTableExpanded ? '▲ 접기' : `▼ 더 보기 (${applications.length - 4}개 더)`}
          </button>
        )}
      </div>
      {emailModalApp && (
        <EmailModal
          isOpen={!!emailModalApp}
          onClose={() => setEmailModalApp(null)}
          application={emailModalApp}
          userName={userName}
          onSendSuccess={handleEmailSentSuccess}
        />
      )}

    </div>
  );
};

export default ApplicationOcrSection;
