import React, { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ActionButton } from '../components/ActionButton';
import { Header } from '../components/Header';

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(name, password);
      // On success, the AuthProvider will handle the state change and render MainLayout.
    } catch (err: any) {
      setError(err.message || '로그인에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [name, password, login]);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Header 
            title="내부망 데이터 전송 시스템"
            description="내부망 전용 데이터 전송 유틸리티"
        />
        <main className="bg-slate-800 p-6 sm:p-8 rounded-xl shadow-2xl w-full text-center">
            <h2 className="text-2xl font-bold text-sky-400 mb-3">
            로그인
            </h2>
            <p className="text-slate-400 mb-6 text-sm">
            ID와 비밀번호를 입력해주세요.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="user-name" className="sr-only">ID</label>
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
                <label htmlFor="user-password" className="sr-only">비밀번호</label>
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
                <ActionButton type="submit" fullWidth isLoading={isLoading}>
                로그인
                </ActionButton>
            </div>
            </form>
        </main>
      </div>
    </div>
  );
};

export default LoginPage;