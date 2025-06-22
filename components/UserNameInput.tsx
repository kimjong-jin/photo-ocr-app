
import React, { useState, useCallback } from 'react';
import { ActionButton } from './ActionButton'; // Assuming ActionButton is in the same folder

interface UserNameInputProps {
  onNameSubmit: (name: string) => void;
}

const UserIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

export const ALLOWED_USER_NAMES = [ // Exporting the list
  "김종진", "권민경", "김성대", "김수철", "정슬기", "강준", "정진욱", "백경동"
];

const UserNameInput: React.FC<UserNameInputProps> = ({ onNameSubmit }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('이름을 입력해주세요.');
      return;
    }
    if (!ALLOWED_USER_NAMES.includes(trimmedName)) {
      setError('허용되지 않는 이름입니다. 목록에 있는 이름을 사용해주세요.');
      return;
    }
    setError(null);
    onNameSubmit(trimmedName); // AppWrapper will handle localStorage saving
  }, [name, onNameSubmit]);

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-95 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-50 font-[Inter]">
      <div className="bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-md text-center">
        <div className="inline-block p-3 bg-sky-500/20 rounded-full mb-4">
          <UserIcon className="w-10 h-10 text-sky-400" />
        </div>
        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300 mb-3">
          사용자 이름 입력
        </h1>
        <p className="text-slate-400 mb-6 text-sm">
          KTL 전송 시 사용될 이름을 입력해주세요.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="user-name" className="sr-only">
              이름
            </label>
            <input
              type="text"
              id="user-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="허용된 이름을 입력하세요"
              required
              aria-describedby={error ? "name-error" : undefined}
              className="block w-full p-3 bg-slate-700 border border-slate-600 rounded-lg shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-500 text-sm transition-colors"
            />
            {error && (
              <p id="name-error" className="text-red-400 text-xs mt-1.5 text-left">
                {error}
              </p>
            )}
          </div>
          <ActionButton type="submit" fullWidth>
            애플리케이션 시작
          </ActionButton>
        </form>
        {/* Removed the <details> section for allowed names list */}
      </div>
    </div>
  );
};

export default UserNameInput;