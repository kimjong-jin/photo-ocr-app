import React, { useState, useCallback } from 'react';
import { ActionButton } from './ActionButton';
import { isMobileDevice } from '../shared/utils';

export type UserRole = 'user';

interface UserCredential {
  password?: string;
  role: UserRole;
}

export const USER_CREDENTIALS: Record<string, UserCredential> = {
  "김종진": { password: "1212", role: "user" },
  "김성대": { password: "3621", role: "user" },
  "정진욱": { password: "2543", role: "user" },
  "권민경": { password: "7315", role: "user" },
  "정슬기": { password: "6357", role: "user" },
  "김수철": { password: "0821", role: "user" },
  "강준": { password: "6969", role: "user" },
  "게스트": { password: "ktl", role: "user" }
};

interface UserNameInputProps {
  onLoginSuccess: (name: string, role: UserRole) => void;
}

const UserNameInput: React.FC<UserNameInputProps> = ({ onLoginSuccess }) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPassword = password.trim();

    if (trimmedName === '') {
      setError('ID을 입력해주세요.');
      return;
    }

    if (trimmedName === "게스트") {
      const currentDate = new Date();
      // 게스트 로그인 만료일 로직은 유지하되, 필요시 수정/제거 가능
      const cutoffDate = new Date(2025, 5, 28); // 2025년 6월 28일
      cutoffDate.setHours(0, 0, 0, 0);

      if (currentDate.getTime() >= cutoffDate.getTime()) {
        setError('게스트 로그인은 2025년 6월 27일까지만 가능합니다.');
        return;
      }

      if (!isMobileDevice()) {
        setError('게스트 로그인은 모바일 기기에서만 가능합니다.');
        return;
      }
    }

    const userDetail = USER_CREDENTIALS[trimmedName];

    if (userDetail && userDetail.password === trimmedPassword) {
      setError(null);
      onLoginSuccess(trimmedName, userDetail.role);
    } else {
      setError('ID 또는 비밀번호가 올바르지 않습니다.');
    }
  }, [name, password, onLoginSuccess]);

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-95 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-50 font-[Inter]">
      <div className="bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300 mb-3">
          로그인
        </h1>
        <p className="text-slate-400 mb-6 text-sm">
          ID와 비밀번호를 입력해주세요.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="user-name" className="sr-only">
              ID
            </label>
            <input
              type="text"
              id="user-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="ID"
              required
              aria-describedby={error ? "login-error" : undefined}
              className="block w-full p-3 bg-slate-700 border border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-500 text-sm transition-colors"
            />
          </div>
          <div>
            <label htmlFor="user-password" className="sr-only">
              비밀번호
            </label>
            <input
              type="password"
              id="user-password"
              value={password}
              onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
              }}
              placeholder="비밀번호"
              aria-describedby={error ? "login-error" : undefined}
              className="block w-full p-3 bg-slate-700 border border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-500 text-sm transition-colors"
            />
          </div>
          {error && (
            <p id="login-error" className="text-red-400 text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="pt-2">
            <ActionButton type="submit" fullWidth>
              로그인
            </ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserNameInput;