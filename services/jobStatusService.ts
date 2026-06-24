/**
 * jobStatusService.ts
 *
 * 접수번호별 P1~P5 Claydox 전송 완료 상태를 Mac Studio SQLite에 저장/조회.
 * 서버 미연결 시 localStorage 폴백.
 */

const API_BASE = '/api/job-status';
const LS_KEY = 'ktl_job_status_v1';

export interface JobStatusEntry {
  receiptNo: string;
  userName: string;
  itemName?: string;  // TOC, TN, TP, SS, pH, DO, TU, Cl 등
  p1Sent: boolean;
  p2Sent: boolean;
  p3Sent: boolean;
  p4Sent: boolean;
  p5Sent: boolean;
  updatedAt: number;
  siteName?: string;
  siteOverride?: string;     // 관리자가 작업관리에서 명시한 현장명 — 공통정보보다 우선
  siteOverrideAt?: number;
}

export type PageKey = 'p1Sent' | 'p2Sent' | 'p3Sent' | 'p4Sent' | 'p5Sent';

// ── localStorage 폴백 ────────────────────────────────────
function lsGetAll(): JobStatusEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function lsSave(entries: JobStatusEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {}
}

// ── 서버 가용성 체크 (캐싱) ──────────────────────────────
let _serverOk: boolean | null = null;
async function isServerOk(): Promise<boolean> {
  if (_serverOk !== null) return _serverOk;
  try {
    const res = await fetch(API_BASE, { method: 'GET', signal: AbortSignal.timeout(3000) });
    _serverOk = res.ok;
  } catch {
    _serverOk = false;
  }
  setTimeout(() => { _serverOk = null; }, 15_000);
  return _serverOk;
}

// ── 공개 API ─────────────────────────────────────────────

/** 전체 상태 목록 조회 (userName 빈 문자열이면 전체) */
export async function getAllJobStatuses(userName: string): Promise<JobStatusEntry[]> {
  if (await isServerOk()) {
    try {
      const url = userName
        ? `${API_BASE}?user_name=${encodeURIComponent(userName)}`
        : API_BASE;
      const res = await fetch(url);
      if (!res.ok) throw new Error('server error');
      return await res.json() as JobStatusEntry[];
    } catch {
      _serverOk = false;
    }
  }
  // 폴백: localStorage (userName 필터 선택적)
  const all = lsGetAll();
  return userName ? all.filter(e => e.userName === userName) : all;
}

/** 단일 접수번호 상태 저장 (upsert) */
export async function saveJobStatus(entry: JobStatusEntry): Promise<void> {
  if (await isServerOk()) {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error('server error');
      return;
    } catch {
      _serverOk = false;
    }
  }
  // 폴백: localStorage
  const all = lsGetAll();
  const idx = all.findIndex(e => e.receiptNo === entry.receiptNo);
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  lsSave(all);
}

/** 관리자 현장명 override 설정/해제 (빈 문자열 = 해제 → 다시 공통정보 우선).
 *  자동 저장 경로와 분리된 별도 필드라, 항목 토글 등 일반 저장에 영향받지 않음. */
export async function setSiteOverride(receiptNo: string, siteName: string, userName = ''): Promise<boolean> {
  const body = { receiptNo, userName, action: 'site-override', siteName };
  if (await isServerOk()) {
    try {
      const res = await fetch(API_BASE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) return true;
    } catch { _serverOk = false; }
  }
  // 폴백: localStorage
  const all = lsGetAll();
  const idx = all.findIndex(e => e.receiptNo === receiptNo);
  if (idx >= 0) all[idx] = { ...all[idx], siteOverride: siteName, siteOverrideAt: Date.now() };
  else all.push({ receiptNo, userName, p1Sent:false, p2Sent:false, p3Sent:false, p4Sent:false, p5Sent:false, updatedAt: Date.now(), siteOverride: siteName, siteOverrideAt: Date.now() });
  lsSave(all);
  return true;
}

/** 접수번호 삭제 */
export async function deleteJobStatus(receiptNo: string): Promise<void> {
  if (await isServerOk()) {
    try {
      const res = await fetch(`${API_BASE}?receiptNo=${encodeURIComponent(receiptNo)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('server error');
      return;
    } catch {
      _serverOk = false;
    }
  }
  lsSave(lsGetAll().filter(e => e.receiptNo !== receiptNo));
}

/** 특정 페이지 전송 완료 표시 */
export async function markPageSent(
  receiptNo: string,
  userName: string,
  page: PageKey,
  allStatuses: JobStatusEntry[],
  siteName?: string,
  itemName?: string,
): Promise<JobStatusEntry> {
  const existing = allStatuses.find(e => e.receiptNo === receiptNo) ?? {
    receiptNo,
    userName,
    p1Sent: false, p2Sent: false, p3Sent: false, p4Sent: false, p5Sent: false,
    updatedAt: Date.now(),
  };
  const updated: JobStatusEntry = {
    ...existing,
    [page]: true,
    updatedAt: Date.now(),
    ...(siteName  ? { siteName }  : {}),
    ...(itemName  ? { itemName }  : {}),
  };
  await saveJobStatus(updated);
  return updated;
}
