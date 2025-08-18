
import React, { useState, useCallback } from 'react';
import { ActionButton } from './ActionButton';

export type UserRole = 'user' | 'admin';

interface UserCredential {
  password?: string;
  role: UserRole;
  contact: string;
}

export const USER_CREDENTIALS: Record<string, UserCredential> = {
  "김종진": { password: "1212", role: "user", contact: "010-8412-8602" },
  "김성대": { password: "3621", role: "user", contact: "010-5325-9074" },
  "정진욱": { password: "2543", role: "user", contact: "010-4480-3262" },
  "권민경": { password: "7315", role: "user", contact: "010-8898-8272" },
  "정슬기": { password: "6357", role: "user", contact: "010-9911-3837" },
  "김수철": { password: "0821", role: "user", contact: "010-9980-0529" },
  "강준": { password: "6969", role: "user", contact: "010-4192-2600" },
};

interface UserNameInputProps {
  onLoginSuccess: (name: string, role: UserRole, contact: string) => void;
}

const UserIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const LockClosedIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);


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
    
    if (trimmedPassword === '') {
      setError('비밀번호를 입력해주세요.');
      return;
    }

    const userDetail = USER_CREDENTIALS[trimmedName];

    if (userDetail && userDetail.password === trimmedPassword) {
      setError(null);
      onLoginSuccess(trimmedName, userDetail.role, userDetail.contact);
    } else {
      setError('ID 또는 비밀번호가 올바르지 않습니다.');
    }
  }, [name, password, onLoginSuccess]);

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-95 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-50 font-[Inter]">
      <div className="bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
        <div className="inline-block p-3 bg-sky-500/20 rounded-full mb-4">
          <UserIcon className="w-10 h-10 text-sky-400" />
        </div>
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
            <div className="relative">
                <input
                type="password"
                id="user-password"
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                }}
                placeholder="비밀번호"
                required
                aria-describedby={error ? "login-error" : undefined}
                className="block w-full p-3 pl-10 bg-slate-700 border border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-500 text-sm transition-colors"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockClosedIcon className="h-5 w-5 text-slate-400" />
                </div>
            </div>
          </div>
          {error && (
            <p id="login-error" className="text-red-400 text-xs mt-1.5 text-left">
              {error}
            </p>
          )}
          <ActionButton type="submit" fullWidth>
            로그인
          </ActionButton>
        </form>
      </div>
    </div>
  );
};

export default UserNameInput;
