import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import ApiKeyChecker from './components/ApiKeyChecker';
import PageContainer from './PageContainer';
import UserNameInput, { UserRole } from './components/UserNameInput';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");

const LOGGED_IN_USER_DATA_KEY = 'photoLogAppUserData_CurrentTab';

interface StoredUserData {
  name: string;
  role: UserRole;
  contact: string;
}

const AppWrapper: React.FC = () => {
  const [currentUserData, setCurrentUserData] = useState<StoredUserData | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(true);

  // 앱 마운트 시 localStorage에서 로그인 상태 복원
  useEffect(() => {
    const savedUserDataRaw = localStorage.getItem(LOGGED_IN_USER_DATA_KEY);
    if (savedUserDataRaw) {
      try {
        const savedUserData = JSON.parse(savedUserDataRaw) as StoredUserData;
        if (savedUserData.name && savedUserData.role && savedUserData.contact) {
          setCurrentUserData(savedUserData);
        } else {
          localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
        }
      } catch {
        localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
      }
    }
    setIsLoadingSession(false);
  }, []);

  const handleLoginSuccess = useCallback((name: string, role: UserRole, contact: string) => {
    const userData: StoredUserData = { name, role, contact };
    setCurrentUserData(userData);
    localStorage.setItem(LOGGED_IN_USER_DATA_KEY, JSON.stringify(userData));

    // ktl_session_id 통일: 로그인 시 새 세션 ID 발급 → PageContainer heartbeat이 이 ID로 서버와 통신
    const newSessionId = self.crypto.randomUUID();
    localStorage.setItem('ktl_session_id', newSessionId);

    // 서버 세션 등록 (1회)
    fetch('/api/sessions', { method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sessionId: newSessionId, userName: name }) }).catch(() => {});
  }, []);

  const handleLogout = useCallback((isForced: boolean = false, reason?: string) => {
    const sidToLogout = localStorage.getItem('ktl_session_id');
    setCurrentUserData(null);
    localStorage.removeItem(LOGGED_IN_USER_DATA_KEY);
    localStorage.removeItem('ktl_session_id');

    if (sidToLogout) {
      fetch('/api/sessions', { method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId: sidToLogout }) }).catch(() => {});
    }
    if (isForced && reason) alert(reason);
  }, []);

  // ── Heartbeat / 세션 관리는 PageContainer.tsx에 단일화 (L249-298) ──
  // index.tsx에서 중복 heartbeat을 돌리면 세션 ID가 이중화되어
  // 모바일 Safari 리로드 시 서버에 2개 세션이 등록 → 혼란 유발.

  if (isLoadingSession) {
    return <div className="fixed inset-0 bg-slate-900 flex items-center justify-center" />;
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
