import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { ApiKeyChecker } from './components/ApiKeyChecker';
import { PageContainer } from './PageContainer';
import { UserNameInput, UserRole } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// All session data stored in localStorage for persistence across tabs
const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData';
const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions';

const SESSION_VALIDATION_INTERVAL = 5000;
const ACTIVE_SESSION_HEARTBEAT_INTERVAL = 30000;

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
    const savedUserDataRaw = localStorage.getItem(LOGGED_IN_USER_DATA_KEY);
    if (savedUserDataRaw) {
      try {
        const savedUserData = JSON.parse(savedUserDataRaw) as StoredUserData;
        if (savedUserData.name && savedUserData.role && savedUserData.sessionId && savedUserData.contact) {
          setCurrentUserData(savedUserData);
        } else {
          localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
        }
      } catch (error) {
        console.error("Error parsing saved user data:", error);
        localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole, contact: string) => {
    const newSessionId = self.crypto.randomUUID();
    const userDataForApp: StoredUserData = { name, role, contact, sessionId: newSessionId };

    setCurrentUserData(userDataForApp);
    localStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userDataForApp));

    const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    const activeSessions: ActiveSessions = activeSessionsRaw ? JSON.parse(activeSessionsRaw) : {};
    
    activeSessions[name] = { 
      role, 
      sessionId: newSessionId,
      lastSeen: Date.now(),
      forceLogoutReason: undefined
    };
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
  }, []);

  const handleLogout = useCallback((isForced: boolean = false, reason?: string) => {
    const nameToLogout = currentUserData?.name;
    setCurrentUserData(null);
    localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);

    if (nameToLogout && !isForced) {
      const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (activeSessionsRaw) {
        const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
        delete activeSessions[nameToLogout];
        localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
      }
    }
    if (isForced && reason) {
      alert(reason);
    }
  }, [currentUserData?.name]);

  // Session Validation and Heartbeat Effect
  useEffect(() => {
    let validationIntervalId: number | undefined;
    let heartbeatIntervalId: number | undefined;

    const validateAndHeartbeat = () => {
      if (!currentUserData?.sessionId || !currentUserData.name) {
        return;
      }

      const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (!activeSessionsRaw) {
        handleLogout(true, "세션 정보를 찾을 수 없어 로그아웃됩니다.");
        return;
      }
      try {
        const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
        const sessionInfoForCurrentUser = activeSessions[currentUserData.name];

        if (!sessionInfoForCurrentUser) {
          handleLogout(true, "세션이 만료되었거나 다른 관리자에 의해 종료되었습니다.");
          return;
        } else if (sessionInfoForCurrentUser.sessionId !== currentUserData.sessionId) {
          handleLogout(true, sessionInfoForCurrentUser.forceLogoutReason || "다른 위치에서 로그인하여 현재 세션이 종료되었습니다.");
          return;
        }

        // If the session is valid, send a heartbeat
        const heartbeat = activeSessions[currentUserData.name];
        if (heartbeat) {
          heartbeat.lastSeen = Date.now();
          localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
        }
      } catch (e) {
        console.error("Error validating session or sending heartbeat:", e);
        handleLogout(true, "세션 검증 중 오류가 발생하여 로그아웃됩니다.");
      }
    };

    if (currentUserData) {
      // Initial check
      validateAndHeartbeat();
      // Set intervals for periodic check
      validationIntervalId = window.setInterval(validateAndHeartbeat, SESSION_VALIDATION_INTERVAL);
    }

    return () => {
      if (validationIntervalId) clearInterval(validationIntervalId);
    };
  }, [currentUserData, handleLogout]);

  if (isLoadingSession) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div>로그인 세션을 확인 중입니다...</div>
      </div>
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
