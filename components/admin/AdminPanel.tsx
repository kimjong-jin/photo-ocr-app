import React, { useState, useEffect, useCallback } from 'react';
import { UserRole } from '../UserNameInput';
import { ActionButton } from '../ActionButton';

const ACTIVE_SESSIONS_KEY = 'photoLogApp_ActiveSessions';
const ADMIN_PANEL_REFRESH_INTERVAL = 10000; // 10 seconds

interface ActiveSessionEntry {
  role: UserRole;
  sessionId: string;
  lastSeen: number;
  forceLogoutReason?: string;
}
type ActiveSessions = Record<string, ActiveSessionEntry>;

interface UserToList {
  name: string;
  role: UserRole;
  lastSeen: number;
}

interface AdminPanelProps {
  adminUserName: string;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ adminUserName }) => {
  const [usersToList, setUsersToList] = useState<UserToList[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveUsers = useCallback(() => {
    try {
      const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (!activeSessionsRaw) {
        setUsersToList([]);
        return;
      }
      const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
      const now = Date.now();
      const STALE_SESSION_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      const loadedUsers: UserToList[] = Object.entries(activeSessions)
        .filter(([name, sessionData]) => {
            // Filter out the admin themselves
            if (name === adminUserName) return false;
            // Filter out stale sessions (e.g., browser closed without logout)
            if (now - sessionData.lastSeen > STALE_SESSION_THRESHOLD) {
                // Optionally, could also trigger a cleanup of this stale session from ACTIVE_SESSIONS_KEY here
                // but that's more complex if multiple admin tabs are open.
                // For now, just don't display it.
                return false;
            }
            return true;
        })
        .map(([name, sessionData]) => ({
          name,
          role: sessionData.role,
          lastSeen: sessionData.lastSeen,
        }))
        .sort((a,b) => b.lastSeen - a.lastSeen); // Show most recent first

      setUsersToList(loadedUsers);
      setError(null);
    } catch (e) {
      console.error("Error fetching or parsing active sessions:", e);
      setError("활성 사용자 목록을 가져오는 중 오류가 발생했습니다.");
      setUsersToList([]);
    }
  }, [adminUserName]);

  useEffect(() => {
    fetchActiveUsers(); // Initial fetch
    const intervalId = setInterval(fetchActiveUsers, ADMIN_PANEL_REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, [fetchActiveUsers]);

  const handleForceLogout = useCallback((userNameToLogout: string) => {
    if (window.confirm(`${userNameToLogout} 사용자를 강제로 로그아웃하시겠습니까?`)) {
      try {
        const activeSessionsRaw = localStorage.getItem(ACTIVE_SESSIONS_KEY);
        if (!activeSessionsRaw) {
          setError("활성 세션 데이터를 찾을 수 없습니다.");
          return;
        }
        const activeSessions: ActiveSessions = JSON.parse(activeSessionsRaw);
        if (activeSessions[userNameToLogout]) {
          activeSessions[userNameToLogout].sessionId = self.crypto.randomUUID() + '_forced_logout';
          activeSessions[userNameToLogout].forceLogoutReason = "관리자에 의해 강제 로그아웃되었습니다.";
          localStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions));
          fetchActiveUsers(); // Refresh list immediately
          alert(`${userNameToLogout} 사용자의 세션이 무효화되었습니다. 해당 사용자는 다음 활동 시 로그아웃됩니다.`);
        } else {
          setError(`${userNameToLogout} 사용자를 활성 세션 목록에서 찾을 수 없습니다.`);
        }
      } catch (e) {
        console.error("Error forcing logout:", e);
        setError("강제 로그아웃 처리 중 오류가 발생했습니다.");
      }
    }
  }, [fetchActiveUsers]);

  return (
    <div className="w-full max-w-3xl mt-6 p-4 bg-slate-700/50 rounded-lg shadow-md border border-slate-600/50">
      <h3 className="text-xl font-semibold text-sky-300 mb-3 border-b border-slate-600 pb-2">
        관리자 패널: 활성 사용자 관리
      </h3>
      {error && <p className="text-red-400 text-sm mb-2" role="alert">{error}</p>}
      {usersToList.length === 0 && !error && (
        <p className="text-slate-400 text-sm">현재 다른 활성 사용자가 없습니다.</p>
      )}
      {usersToList.length > 0 && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {usersToList.map(user => (
            <div key={user.name} className="flex items-center justify-between p-2.5 bg-slate-600 rounded-md shadow">
              <div>
                <span className="font-medium text-slate-100">{user.name}</span>
                <span className="text-xs text-slate-400 ml-2">({user.role})</span>
                <p className="text-xs text-slate-500">
                  마지막 활동: {new Date(user.lastSeen).toLocaleString()}
                </p>
              </div>
              <ActionButton
                onClick={() => handleForceLogout(user.name)}
                variant="danger"
                className="text-xs px-2.5 py-1 h-auto"
              >
                강제 로그아웃
              </ActionButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
