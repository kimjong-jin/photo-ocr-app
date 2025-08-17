import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Header } from '../components/Header';
import { ActionButton } from '../components/ActionButton';
import WaterAnalysisPage from '../pages/WaterAnalysisPage';
import KakaoTalkPage from '../pages/KakaoTalkPage';
import { LogoutIcon } from '../components/icons';

type Page = 'dataSubmission' | 'kakaoTalk';

const MainLayout: React.FC = () => {
  const { user, logout, isOnline } = useAuth();
  const [activePage, setActivePage] = useState<Page>('dataSubmission');

  const getNavButtonStyle = (page: Page) => {
    const baseStyle = "w-full py-2.5 text-sm font-semibold transition-colors duration-200 border-b-2 focus:outline-none focus:bg-slate-700/50";
    if (activePage === page) {
      return `${baseStyle} text-sky-400 border-sky-400`;
    }
    return `${baseStyle} text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-500`;
  };
  
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-4 sm:p-8">
      <Header
        title="내부망 데이터 전송 시스템"
        description="수분석 자료 및 카카오톡 알림을 간편하게 전송합니다."
      />
      
      {!isOnline && (
        <div className="w-full max-w-4xl text-center bg-red-800/50 border border-red-600/50 text-red-300 p-2 rounded-lg mb-4 text-sm shadow-lg">
          🔴 오프라인 상태입니다. 일부 기능이 제한될 수 있습니다.
        </div>
      )}

      <div className="w-full max-w-4xl mb-4 flex flex-col sm:flex-row justify-between items-center bg-slate-800/50 p-3 rounded-lg shadow">
        <div className="text-sm text-sky-300 mb-2 sm:mb-0">
          환영합니다, <span className="font-semibold">{user?.name}</span>님!
        </div>
        <ActionButton
          onClick={logout}
          variant="secondary"
          className="py-1.5 px-3 text-xs"
          icon={<LogoutIcon className="w-3.5 h-3.5" />}
        >
          로그아웃
        </ActionButton>
      </div>
      
      <nav className="w-full max-w-4xl mb-6 flex justify-center bg-slate-800 rounded-lg shadow-md overflow-hidden">
        <button
          onClick={() => setActivePage('dataSubmission')}
          className={getNavButtonStyle('dataSubmission')}
          aria-pressed={activePage === 'dataSubmission'}
        >
          수분석 자료 전송
        </button>
        <button
          onClick={() => setActivePage('kakaoTalk')}
          className={getNavButtonStyle('kakaoTalk')}
          aria-pressed={activePage === 'kakaoTalk'}
        >
          카카오톡 전송
        </button>
      </nav>
      
      <main className="w-full flex justify-center">
        {activePage === 'dataSubmission' && <WaterAnalysisPage isOnline={isOnline} />}
        {activePage === 'kakaoTalk' && <KakaoTalkPage isOnline={isOnline} />}
      </main>
      
    </div>
  );
};

export default MainLayout;