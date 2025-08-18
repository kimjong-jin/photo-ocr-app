import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import ApiKeyChecker from './components/ApiKeyChecker';
import PageContainer from './PageContainer';
import UserNameInput, { UserRole } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData_CurrentTab'; // current tab only
const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions'; // cross-tab
const SESSION_VALIDATION_INTERVAL = 5000; // 5s
const ACTIVE_SESSION_HEARTBEAT_INTERVAL = 30000; // 30s

interface StoredUserData {
  name: string;
  role: UserRole;
  contact: string;
  sessionId: string; // tab/instance session id
}

interface ActiveSessionEntry {
  role: UserRole;
  sessionId: string; // master session id per user
  lastSeen: number;
  forceLogoutReason?: string;
}
type ActiveSessions = Record<string, ActiveSessionEntry>;

const AppWrapper: React.FC = () => {
  const [currentUserData, setCurrentUserData] = useState<StoredUserData | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(true);

  // Load this tab's session on mount
  useEffect(() => {
    const raw = sessionStorage.getItem(LOGGED_IN_USER_DATA_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredUserData;
        if (parsed?.name && parsed?.role && parsed?.sessionId && parsed?.contact) {
          setCurrentUserData(parsed);
        } else {
          sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
        }
      } catch (e) {
        console.error('Error parsing saved user data for current tab:', e);
        sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole, contact: string) => {
    const newSessionId = self.crypto.randomUUID();
    const userDataForTab: StoredUserData = { name, role, contact, sessionId: newSessionId };

    // save to this tab
    setCurrentUserData(userDataForTab);
    sessionStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userDataForTab));

    // update global
    const activeRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    const active: ActiveSessions = activeRaw ? JSON.parse(activeRaw) : {};
    active[name] = {
      role,
      sessionId: newSessionId,
      lastSeen: Date.now(),
      forceLogoutReason: undefined,
    };
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(active));
  }, []);

  const handleLogout = useCallback((isForced = false, reason?: string) => {
    const name = currentUserData?.name;

    setCurrentUserData(null);
    sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);

    if (name) {
      const activeRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (activeRaw) {
        const active: ActiveSessions = JSON.parse(activeRaw);
        // If self-logout, remove from global; if forced, keep whatever admin set
        if (!isForced) {
          delete active[name];
          localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(active));
        }
      }
    }
    if (isForced && reason) {
      alert(reason);
    }
  }, [currentUserData?.name]);

  // Cross-tab sync: listen to ACTIVE_SESSIONS updates (admin/other tab actions)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVE_SESSIONS_KEY || !currentUserData) return;
      try {
        const active: ActiveSessions = e.newValue ? JSON.parse(e.newValue) : {};
        const entry = active[currentUserData.name];
        if (!entry) {
          // entry removed → forced logout
          handleLogout(true, '세션이 만료되었거나 다른 관리자에 의해 종료되었습니다.');
          return;
        }
        if (entry.sessionId !== currentUserData.sessionId) {
          // session replaced by another login
          handleLogout(true, entry.forceLogoutReason || '다른 위치에서 로그인하여 현재 세션이 종료되었습니다.');
        }
      } catch (err) {
        console.error('Error reacting to storage change:', err);
        handleLogout(true, '세션 검증 중 오류가 발생하여 로그아웃됩니다.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentUserData, handleLogout]);

  // Session validation + heartbeat
  useEffect(() => {
    let validationIntervalId: number | undefined;
    let heartbeatIntervalId: number | undefined;

    if (currentUserData?.sessionId && currentUserData.name) {
      const currentTabSessionId = currentUserData.sessionId;
      const currentUserName = currentUserData.name;

      // periodic validation from localStorage
      validationIntervalId = window.setInterval(() => {
        const activeRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (!activeRaw) {
          handleLogout(true, '세션 정보를 찾을 수 없어 로그아웃됩니다.');
          return;
        }
        try {
          const active: ActiveSessions = JSON.parse(activeRaw);
          const entry = active[currentUserName];
          if (!entry) {
            handleLogout(true, '세션이 만료되었거나 다른 관리자에 의해 종료되었습니다.');
          } else if (entry.sessionId !== currentTabSessionId) {
            handleLogout(true, entry.forceLogoutReason || '다른 위치에서 로그인하여 현재 세션이 종료되었습니다.');
          }
        } catch (e) {
          console.error('Error validating session from ACTIVE_SESSIONS_KEY:', e);
          handleLogout(true, '세션 검증 중 오류가 발생하여 로그아웃됩니다.');
        }
      }, SESSION_VALIDATION_INTERVAL);

      // heartbeat to update lastSeen
      heartbeatIntervalId = window.setInterval(() => {
        const activeRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (!activeRaw) return;
        try {
          const active: ActiveSessions = JSON.parse(activeRaw);
          if (active[currentUserName]) {
            active[currentUserName].lastSeen = Date.now();
            localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(active));
          }
        } catch (e) {
          console.error('Error updating lastSeen in heartbeat:', e);
        }
      }, ACTIVE_SESSION_HEARTBEAT_INTERVAL);
    }

    return () => {
      if (validationIntervalId) clearInterval(validationIntervalId);
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    };
  }, [currentUserData, handleLogout]);

  // Clean up this tab's session on tab close (optional)
  useEffect(() => {
    const onBeforeUnload = () => {
      const name = currentUserData?.name;
      if (!name) return;
      // do not remove if another tab already took over (sessionId changed)
      const activeRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (!activeRaw) return;
      try {
        const active: ActiveSessions = JSON.parse(activeRaw);
        const entry = active[name];
        if (entry && entry.sessionId === currentUserData?.sessionId) {
          delete active[name];
          localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(active));
        }
      } catch {
        // ignore
      }
      sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [currentUserData]);

  if (isLoadingSession) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center" />
    );
  }

  if (!currentUserData) {
    return <UserNameInput onLoginSuccess={handleLoginSuccess} />;
  }

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
