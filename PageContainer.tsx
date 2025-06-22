import React, { useState } from 'react';
import PhotoLogPage from './PhotoLogPage';
import StructuralCheckPage from './StructuralCheckPage';
import { Header } from './components/Header';
import { Footer } from './components/Footer';

type Page = 'photoLog' | 'structuralCheck';

interface PageContainerProps {
  userName: string;
  onLogout: () => void; // ✅ 로그아웃 콜백 받음
}

const PageContainer: React.FC<PageContainerProps> = ({ userName, onLogout }) => {
  const [activePage, setActivePage] = useState<Page>('photoLog');

  const navButtonBaseStyle =
    "px-4 py-2 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500";
  const activeNavButtonStyle = "bg-sky-500 text-white";
  const inactiveNavButtonStyle = "bg-slate-700 hover:bg-slate-600 text-slate-300";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-[Inter] relative">
      
      <button
        onClick={onLogout}
        className="absolute top-4 right-4 text-sm text-slate-400 hover:text-red-400 transition"
      >
        로그아웃
      </button>

      <Header />
      <nav className="w-full max-w-3xl mb-6 flex justify-center space-x-2 sm:space-x-4 p-2 bg-slate-800 rounded-lg shadow-md">
        <button
          onClick={() => setActivePage('photoLog')}
          className={`${navButtonBaseStyle} ${activePage === 'photoLog' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'photoLog'}
        >
          사진 기록 (Page 1)
        </button>
        <button
          onClick={() => setActivePage('structuralCheck')}
          className={`${navButtonBaseStyle} ${activePage === 'structuralCheck' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'structuralCheck'}
        >
          구조부 확인 (Page 2)
        </button>
      </nav>

      {activePage === 'photoLog' && <PhotoLogPage userName={userName} />}
      {activePage === 'structuralCheck' && <StructuralCheckPage userName={userName} />}

      <Footer />
    </div>
  );
};

export default PageContainer;
