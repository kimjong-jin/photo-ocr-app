import React from 'react';

export const Header: React.FC = () => (
  <header className="w-full max-w-3xl mb-6 sm:mb-8 text-center">
    <div className="inline-block p-3 bg-sky-500/20 rounded-full mb-4">
      {/* Icon can be updated if a more specific one is desired, current one is generic enough */}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 text-sky-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.375a9.75 9.75 0 007.966-4.624.5.5 0 000-.502A9.75 9.75 0 0012 8.625a9.75 9.75 0 00-7.966 4.624.5.5 0 000 .502A9.75 9.75 0 0012 18.375z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.375a3 3 0 100-6 3 3 0 000 6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5h16.5M3.75 9.75h16.5M3.75 15h16.5M3.75 20.25h16.5" />
      </svg>
    </div>
    <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">
      사진 기록
    </h1>
    <p className="text-slate-400 mt-2 text-md sm:text-lg px-2">
      사진을 업로드하고 관련 정보를 기록 및 관리합니다.
    </p>
  </header>
);