
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import ApiKeyChecker from './components/ApiKeyChecker';
import PageContainer from './PageContainer';
import UserNameInput, { UserRole, USER_CREDENTIALS } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData_CurrentTab'; // For current tab's session
const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions'; // Global list of active sessions
const SESSION_VALIDATION_INTERVAL = 5000; // 5 seconds
const ACTIVE_SESSION_HEARTBEAT_INTERVAL = 30000; // 30 seconds to update lastSeen

interface StoredUserData {
  name: string;
  role: UserRole;
  sessionId: string; // Session ID for this specific tab/instance
}

interface ActiveSessionEntry {
  role: UserRole;
  sessionId: string; // The "master" session ID for this user
  lastSeen: number;
  forceLogoutReason?: string;
}

type ActiveSessions = Record<string, ActiveSessionEntry>;

const AppWrapper: React.FC = () => {
  const [currentUserData, setCurrentUserData] = useState<StoredUserData | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(true);

  // Load current tab's session data on initial mount
  useEffect(() => {
    const savedUserDataRaw = localStorage.getItem(LOGGED_IN_USER_DATA_KEY);
    if (savedUserDataRaw) {
      try {
        const savedUserData = JSON.parse(savedUserDataRaw) as StoredUserData;
        // Basic validation of stored data
        if (savedUserData.name && savedUserData.role && savedUserData.sessionId) {
          setCurrentUserData(savedUserData);
        } else {
          localStorage.removeItem(LOGGED_IN_USER_DATA_KEY); // Clear corrupted data
        }
      } catch (error) {
        console.error("Error parsing saved user data for current tab:", error);
        localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole) => {
    const newSessionId = self.crypto.randomUUID();
    const userDataForTab: StoredUserData = { name, role, sessionId: newSessionId };

    setCurrentUserData(userDataForTab);
    localStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userDataForTab));

    // Update global active sessions list
    const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
    const activeSessions: ActiveSessions = activeSessionsRaw ? JSON.parse(activeSessionsRaw) : {};
    
    activeSessions[name] = { 
      role, 
      sessionId: newSessionId, // This new login defines the current valid sessionId for this user
      lastSeen: Date.now(),
      forceLogoutReason: undefined // Clear any previous force logout reason
    };
    localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
  }, []);

  const handleLogout = useCallback((isForced: boolean = false, reason?: string) => {
    const nameToLogout = currentUserData?.name;

    setCurrentUserData(null);
    localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);

    if (nameToLogout) {
      const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (activeSessionsRaw) {
        const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
        // Only remove if this logout is not forced by admin invalidating the session ID
        // If it was forced, the admin already changed the sessionId in ACTIVE_SESSIONS_KEY
        // and this logout is a consequence. If it's a self-logout, then remove.
        // A more robust way: if this is a "self-initiated" logout, remove from active list.
        // If it's due to session mismatch (which could be self or admin), the current mechanism handles it.
        // For simplicity, let's assume `handleLogout` called without `isForced` means user initiated.
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


  // Session Validation and Heartbeat Effect
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
            // User no longer in active sessions list (e.g., admin removed, or stale and cleaned up by another mechanism not yet implemented)
            handleLogout(true, "세션이 만료되었거나 다른 관리자에 의해 종료되었습니다.");
          } else if (sessionInfoForCurrentUser.sessionId !== currentTabSessionId) {
            // Session ID mismatch - means another login for this user occurred, or admin forced logout
            handleLogout(true, sessionInfoForCurrentUser.forceLogoutReason || "다른 위치에서 로그인하여 현재 세션이 종료되었습니다.");
          }
          // If session is valid, it continues. Heartbeat updates lastSeen.
        } catch (e) {
          console.error("Error validating session from ACTIVE_SESSIONS_KEY:", e);
          handleLogout(true, "세션 검증 중 오류가 발생하여 로그아웃됩니다.");
        }
      }, SESSION_VALIDATION_INTERVAL);

      // Heartbeat: update lastSeen for the current user
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
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        {/* Placeholder for a loading indicator if needed */}
      </div>
    );
  }

  if (!currentUserData) {
    return <UserNameInput onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <ApiKeyChecker>
      <PageContainer userName={currentUserData.name} userRole={currentUserData.role} onLogout={() => handleLogout(false)} />
    </ApiKeyChecker>
  );
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
