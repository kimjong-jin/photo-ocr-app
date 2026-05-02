import React from 'react';
import type { ApiMode } from '../PageContainer';

interface HeaderProps {
  apiMode: ApiMode;
  onApiModeChange: (mode: ApiMode) => void;
}

export const Header: React.FC<HeaderProps> = ({ apiMode, onApiModeChange }) => {
  const handleToggle = () => {
    onApiModeChange(apiMode === 'gemini' ? 'vllm' : 'gemini');
  };

  const buttonText = apiMode === 'gemini' ? '전환 → 내부 AI' : '전환 → 외부 AI';
  const buttonColor = 'bg-green-500 hover:bg-green-600';

  return (
    <header className="w-full max-w-3xl mb-6 sm:mb-8 text-center">
      {/* 분석 모드 표시 영역 */}
      <div className="flex justify-between items-center w-full mb-4 px-1">
        <span className="text-slate-300 font-semibold text-sm">
          분석 : {apiMode === 'gemini' ? '외부 AI' : '내부 AI'}
        </span>
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 text-xs font-bold text-white rounded-lg shadow-md transition-colors ${buttonColor}`}
        >
          {buttonText}
        </button>
      </div>

      {/* 아이콘 및 제목 */}
      <div className="inline-block p-3 bg-sky-500/20 rounded-full mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
          strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-sky-400">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 18.375a9.75 9.75 0 007.966-4.624.5.5 0 000-.502A9.75 9.75 0 0012 8.625a9.75 9.75 0 00-7.966 4.624.5.5 0 000 .502A9.75 9.75 0 0012 18.375z" />
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 15.375a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </div>

      <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
        시험·검사 분석
      </h1>
      <p className="text-slate-400 mt-2 text-md sm:text-lg px-2">
        데이터를 분석하고 관련 정보를 기록 및 관리합니다.
      </p>
    </header>
  );
};
