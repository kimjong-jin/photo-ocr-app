import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import ApiKeyChecker from './components/ApiKeyChecker';
import PageContainer from './PageContainer';
import UserNameInput, { UserRole } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");

const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData_CurrentTab';
const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions';
const SESSION_VALIDATION_INTERVAL = 5000;
const ACTIVE_SESSION_HEARTBEAT_INTERVAL = 10000; // 10초마다 (강제 로그아웃 빠른 반응)

interface StoredUserData {
  name: string;
  role: UserRole;
  contact: string;
  sessionId: string;
}

interface ActiveSessionEntry {
  role: UserRole;
  sessionId: string;
  lastSeen: number;
  forceLogoutReason?: string;
}
type ActiveSessions = Record<string, ActiveSessionEntry>;

const AppWrapper: React.FC = () => {
  const [currentUserData, setCurrentUserData] = useState<StoredUserData | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(true);

  useEffect(() => {
    const savedUserDataRaw = sessionStorage.getItem(LOGGED_IN_USER_DATA_KEY);
    if (savedUserDataRaw) {
      try {
        const savedUserData = JSON.parse(savedUserDataRaw) as StoredUserData;
        if (savedUserData.name && savedUserData.role && savedUserData.sessionId && savedUserData.contact) {
          setCurrentUserData(savedUserData);
        } else {
          sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
        }
      } catch {
        sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole, contact: string) => {
    const newSessionId = self.crypto.randomUUID();
    const userDataForTab: StoredUserData = { name, role, contact, sessionId: newSessionId };
    setCurrentUserData(userDataForTab);
    sessionStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userDataForTab));

    const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    const activeSessions: ActiveSessions = activeSessionsRaw ? JSON.parse(activeSessionsRaw) : {};
    activeSessions[name] = { role, sessionId: newSessionId, lastSeen: Date.now(), forceLogoutReason: undefined };
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));

    // 서버 세션 등록
    fetch('/api/sessions', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: newSessionId, userName: name }) }).catch(() => {});
  }, []);

  const handleLogout = useCallback((isForced: boolean = false, reason?: string) => {
    const nameToLogout = currentUserData?.name;
    const sidToLogout = currentUserData?.sessionId;
    setCurrentUserData(null);
    sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);

    if (sidToLogout) {
      fetch('/api/sessions', { method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId: sidToLogout }) }).catch(() => {});
    }
    if (nameToLogout) {
      const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (activeSessionsRaw) {
        const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
        if (!isForced) {
          delete activeSessions[nameToLogout];
          localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
        }
      }
    }
    if (isForced && reason) alert(reason);
  }, [currentUserData?.name, currentUserData?.sessionId]);

  // handleLogout 최신 참조 유지 (closure 버그 방지)
  const handleLogoutRef = useRef(handleLogout);
  useEffect(() => { handleLogoutRef.current = handleLogout; }, [handleLogout]);

  useEffect(() => {
    let heartbeatIntervalId: number | undefined;

    if (currentUserData?.sessionId && currentUserData.name) {
      const currentTabSessionId = currentUserData.sessionId;
      const currentUserName = currentUserData.name;

      // [제거] localStorage 기반 자가 로그아웃 검사.
      // 같은 브라우저(모바일 사파리 등)의 다른 탭/재접속이 공유 localStorage의 sessionId를
      // 덮어쓰면 "다른 위치에서 로그인"으로 오인해 스스로 튕기던 버그의 원인이었음.
      // → 같은 기기 멀티탭 허용. 실제 강제 종료는 아래 heartbeat의 서버 forceLogout만으로 처리.

      heartbeatIntervalId = window.setInterval(async () => {
        const raw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (raw) {
          try {
            const sessions: ActiveSessions = JSON.parse(raw);
            if (sessions[currentUserName]) {
              sessions[currentUserName].lastSeen = Date.now();
              localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(sessions));
            }
          } catch {}
        }
        // 서버에 heartbeat ping + 강제 로그아웃 체크
        try {
          const r = await fetch('/api/sessions', { method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ sessionId: currentTabSessionId, userName: currentUserName }) });
          if (r.ok) {
            const d = await r.json();
            if (d.forceLogout) handleLogoutRef.current(true, '관리자에 의해 세션이 종료되었습니다.');
          }
        } catch {}
      }, ACTIVE_SESSION_HEARTBEAT_INTERVAL);
    }

    return () => {
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    };
  }, [currentUserData, handleLogout]);

  if (isLoadingSession) {
    return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center" />;
  }

  if (!currentUserData) {
    return <UserNameInput onLoginSuccess={handleLoginSuccess} />;
  }

  // ✅ 중복된 AI 토글 UI 제거. (Header/PageContainer 내부 토글만 사용)
  return (
    <ApiKeyChecker>
      <PageContainer
        userName={currentUserData.name}
        userRole={currentUserData.role}
        userContact={currentUserData.contact}
        onLogout={() => handleLogout(false)}
      />
    </ApiKeyChecker>
  );
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
