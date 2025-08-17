import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import PageContainer from './PageContainer';
import UserNameInput, { UserRole } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData_CurrentTab'; 
const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions'; 
const SESSION_VALIDATION_INTERVAL = 5000; 
const ACTIVE_SESSION_HEARTBEAT_INTERVAL = 30000; 

interface StoredUserData {
  name: string;
  role: UserRole;
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
        if (savedUserData.name && savedUserData.role && savedUserData.sessionId) {
          setCurrentUserData(savedUserData);
        } else {
          sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
        }
      } catch (error) {
        console.error("Error parsing saved user data for current tab:", error);
        sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole) => {
    const newSessionId = self.crypto.randomUUID();
    const userDataForTab: StoredUserData = { name, role, sessionId: newSessionId };

    setCurrentUserData(userDataForTab);
    sessionStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userDataForTab));

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
    sessionStorage.removeItem(LOGGED_IN_USER_DATA_KEY);

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
    if (isForced && reason) {
      alert(reason);
    }
  }, [currentUserData?.name]);

  useEffect(() => {
    let validationIntervalId: number | undefined;
    let heartbeatIntervalId: number | undefined;

    if (currentUserData?.sessionId && currentUserData.name) {
      const currentTabSessionId = currentUserData.sessionId;
      const currentUserName = currentUserData.name;

      validationIntervalId = window.setInterval(() => {
        const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (!activeSessionsRaw) {
          handleLogout(true, "세션 정보를 찾을 수 없어 로그아웃됩니다.");
          return;
        }
        try {
          const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
          const sessionInfoForCurrentUser = activeSessions[currentUserName];

          if (!sessionInfoForCurrentUser) {
            handleLogout(true, "세션이 만료되었거나 다른 위치에서 로그아웃되었습니다.");
          } else if (sessionInfoForCurrentUser.sessionId !== currentTabSessionId) {
            handleLogout(true, sessionInfoForCurrentUser.forceLogoutReason || "다른 위치에서 로그인하여 현재 세션이 종료되었습니다.");
          }
        } catch (e) {
          console.error("Error validating session from ACTIVE_SESSIONS_KEY:", e);
          handleLogout(true, "세션 검증 중 오류가 발생하여 로그아웃됩니다.");
        }
      }, SESSION_VALIDATION_INTERVAL);

      heartbeatIntervalId = window.setInterval(() => {
        const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (activeSessionsRaw) {
            try {
                const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
                if (activeSessions[currentUserName]) {
                    activeSessions[currentUserName].lastSeen = Date.now();
                    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
                }
            } catch (e) {
                console.error("Error updating lastSeen in heartbeat:", e);
            }
        }
      }, ACTIVE_SESSION_HEARTBEAT_INTERVAL);
    }

    return () => {
      if (validationIntervalId) clearInterval(validationIntervalId);
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    };
  }, [currentUserData, handleLogout]);

  if (isLoadingSession) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center" />
    );
  }

  if (!currentUserData) {
    return <UserNameInput onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <PageContainer userName={currentUserData.name} userRole={currentUserData.role} onLogout={() => handleLogout(false)} />
  );
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);

