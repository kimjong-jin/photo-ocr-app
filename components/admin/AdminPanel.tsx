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
  // 관리자 재인증: 세션 목록은 민감(이름·IP·위치)하므로 관리자 비번 확인 후 표시
  const [adminPass, setAdminPass] = useState<string>('');
  const [verified, setVerified] = useState<boolean>(false);
  const [passInput, setPassInput] = useState<string>('');

  // pass 를 헤더로 보내 서버 세션 조회. 401 이면 false 반환(게이트로 복귀).
  const fetchActiveUsers = useCallback(async (pass: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin-sessions', { headers: { 'x-admin-pass': pass } });
      if (res.status === 401) {
        setVerified(false);
        setAdminPass('');
        setError('관리자 비밀번호가 올바르지 않습니다.');
        setUsersToList([]);
        return false;
      }
      if (!res.ok) {
        setUsersToList([]);
        return true;
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
      return true;
    } catch (e) {
      console.error("Error fetching active sessions from server:", e);
      setError("활성 사용자 목록을 가져오는 중 오류가 발생했습니다.");
      setUsersToList([]);
      return true;
    }
  }, [adminUserName]);

  const handleUnlock = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const pass = passInput.trim();
    if (!pass) return;
    const ok = await fetchActiveUsers(pass);
    if (ok) {
      setAdminPass(pass);
      setVerified(true);
    }
    setPassInput('');
  }, [passInput, fetchActiveUsers]);

  useEffect(() => {
    if (!verified || !adminPass) return;
    fetchActiveUsers(adminPass);
    const intervalId = setInterval(() => fetchActiveUsers(adminPass), ADMIN_PANEL_REFRESH_INTERVAL);
    return () => clearInterval(intervalId);
  }, [verified, adminPass, fetchActiveUsers]);

  const handleForceLogout = useCallback(async (userNameToLogout: string) => {
    if (!window.confirm(`${userNameToLogout} 사용자를 강제로 로그아웃하시겠습니까?`)) return;
    try {
      const res = await fetch('/api/admin-sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
        body: JSON.stringify({ userName: userNameToLogout }),
      });
      if (res.ok) {
        alert(`${userNameToLogout} 사용자의 세션이 종료 요청되었습니다.`);
        fetchActiveUsers(adminPass);
      } else if (res.status === 401) {
        setVerified(false);
        setAdminPass('');
        setError('관리자 인증이 필요합니다. 다시 로그인하세요.');
      } else {
        setError('강제 로그아웃 요청 실패');
      }
    } catch (e) {
      console.error("Error forcing logout:", e);
      setError("강제 로그아웃 처리 중 오류가 발생했습니다.");
    }
  }, [adminPass, fetchActiveUsers]);

  return (
    <div className="w-full max-w-3xl mt-6 p-4 bg-slate-700/50 rounded-lg shadow-md border border-slate-600/50">
      <h3 className="text-xl font-semibold text-sky-300 mb-3 border-b border-slate-600 pb-2">
        관리자 패널: 활성 사용자 관리
      </h3>
      {!verified ? (
        <form onSubmit={handleUnlock} className="space-y-2">
          <p className="text-slate-400 text-sm">활성 세션을 보려면 관리자 비밀번호를 입력하세요.</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={passInput}
              onChange={(e) => { setPassInput(e.target.value); if (error) setError(null); }}
              placeholder="관리자 비밀번호"
              className="flex-1 p-2.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
            <ActionButton type="submit" className="text-sm px-4">확인</ActionButton>
          </div>
          {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}
        </form>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};

export default AdminPanel;
