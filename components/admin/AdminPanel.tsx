import React, { useState, useEffect, useCallback } from 'react';
import { UserRole } from '../UserNameInput';
import { ActionButton } from '../ActionButton';

const ADMIN_PANEL_REFRESH_INTERVAL = 15000; // 15초

interface ServerSession {
  session_id: string;
  user_name: string;
  ip: string;
  user_agent: string;
  last_seen: number;
  created_at: number;
  force_logout: number;
  location: string;
}

interface UserToList {
  name: string;
  role: UserRole;
  lastSeen: number;
  location: string;
  sessionCount: number;
}

interface AdminPanelProps {
  adminUserName: string;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ adminUserName }) => {
  const [usersToList, setUsersToList] = useState<UserToList[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveUsers = useCallback(async () => {
    try {
      // 서버에서 실제 세션 목록을 가져옴 (localStorage 의존 제거)
      const res = await fetch('/api/admin-sessions');
      if (!res.ok) {
        // 관리자 API 미구현 또는 권한 부족 시 빈 목록
        setUsersToList([]);
        return;
      }
      const sessions: ServerSession[] = await res.json();
      const now = Date.now();
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5분

      // 사용자별 그룹핑 (동일 사용자 멀티 세션 → 1행)
      const userMap = new Map<string, UserToList>();
      for (const s of sessions) {
        if (s.user_name === adminUserName) continue;
        if (now - s.last_seen > STALE_THRESHOLD) continue;

        const existing = userMap.get(s.user_name);
        if (existing) {
          existing.sessionCount++;
          if (s.last_seen > existing.lastSeen) {
            existing.lastSeen = s.last_seen;
            existing.location = s.location || '';
          }
        } else {
          userMap.set(s.user_name, {
            name: s.user_name,
            role: 'user',
            lastSeen: s.last_seen,
            location: s.location || '',
            sessionCount: 1,
          });
        }
      }

      setUsersToList(Array.from(userMap.values()).sort((a, b) => b.lastSeen - a.lastSeen));
      setError(null);
    } catch (e) {
      console.error("Error fetching active sessions from server:", e);
      setError("활성 사용자 목록을 가져오는 중 오류가 발생했습니다.");
      setUsersToList([]);
    }
  }, [adminUserName]);

  useEffect(() => {
    fetchActiveUsers();
    const intervalId = setInterval(fetchActiveUsers, ADMIN_PANEL_REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, [fetchActiveUsers]);

  const handleForceLogout = useCallback(async (userNameToLogout: string) => {
    if (!window.confirm(`${userNameToLogout} 사용자를 강제로 로그아웃하시겠습니까?`)) return;
    try {
      const res = await fetch('/api/admin-sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: userNameToLogout }),
      });
      if (res.ok) {
        alert(`${userNameToLogout} 사용자의 세션이 종료 요청되었습니다.`);
        fetchActiveUsers();
      } else {
        setError('강제 로그아웃 요청 실패');
      }
    } catch (e) {
      console.error("Error forcing logout:", e);
      setError("강제 로그아웃 처리 중 오류가 발생했습니다.");
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
                {user.location && <span className="text-xs text-slate-400 ml-2">{user.location}</span>}
                <p className="text-xs text-slate-500">
                  마지막 활동: {new Date(user.lastSeen).toLocaleString()}
                  {user.sessionCount > 1 && ` · ${user.sessionCount}개 세션`}
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
