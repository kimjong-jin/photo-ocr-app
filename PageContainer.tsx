import React, { useState } from 'react';
import PhotoLogPage from './PhotoLogPage';
import DrinkingWaterPage from './DrinkingWaterPage';
import FieldCountPage from './FieldCountPage';
import StructuralCheckPage from './StructuralCheckPage'; 
import { KakaoTalkPage } from './KakaoTalkPage';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ActionButton } from './components/ActionButton';
import { UserRole } from './components/UserNameInput';
import AdminPanel from './components/admin/AdminPanel';

type Page = 'photoLog' | 'drinkingWater' | 'fieldCount' | 'structuralCheck' | 'kakaoTalk';

interface PageContainerProps {
  userName: string;
  userRole: UserRole;
  userContact: string;
  onLogout: () => void;
}

const LogoutIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props} className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3-3l-3 3m0 0l3 3m-3-3h12.75" />
  </svg>
);


const PageContainer: React.FC<PageContainerProps> = ({ userName, userRole, userContact, onLogout }) => {
  const [activePage, setActivePage] = useState<Page>('photoLog');

  const navButtonBaseStyle = "px-3 py-2 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs sm:text-sm flex-grow sm:flex-grow-0";
  const activeNavButtonStyle = "bg-sky-500 text-white";
  const inactiveNavButtonStyle = "bg-slate-700 hover:bg-slate-600 text-slate-300";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-[Inter]">
      <Header />

      <div className="w-full max-w-3xl mb-4 flex flex-col sm:flex-row justify-between items-center bg-slate-800/50 p-3 rounded-lg shadow">
        <div className="text-sm text-sky-300 mb-2 sm:mb-0">
          환영합니다, <span className="font-semibold">{userName}</span>님!
        </div>
        <ActionButton
          onClick={onLogout}
          variant="secondary"
          className="bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white text-xs px-3 py-1.5 h-auto"
          icon={<LogoutIcon />}
        >
          로그아웃
        </ActionButton>
      </div>
      
      <nav className="w-full max-w-4xl mb-6 flex justify-center space-x-1 sm:space-x-2 p-2 bg-slate-800 rounded-lg shadow-md">
        <button
          onClick={() => setActivePage('photoLog')}
          className={`${navButtonBaseStyle} ${activePage === 'photoLog' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'photoLog'}
        >
          수질 분석 (P1)
        </button>
        <button
          onClick={() => setActivePage('fieldCount')}
          className={`${navButtonBaseStyle} ${activePage === 'fieldCount' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'fieldCount'}
        >
          현장 계수 (P2)
        </button>
         <button
          onClick={() => setActivePage('drinkingWater')}
          className={`${navButtonBaseStyle} ${activePage === 'drinkingWater' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'drinkingWater'}
        >
          물 분석 (P3)
        </button>
        <button
          onClick={() => setActivePage('structuralCheck')}
          className={`${navButtonBaseStyle} ${activePage === 'structuralCheck' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'structuralCheck'}
        >
          구조 확인 (P4)
        </button>
        <button
          onClick={() => setActivePage('kakaoTalk')}
          className={`${navButtonBaseStyle} ${activePage === 'kakaoTalk' ? activeNavButtonStyle : inactiveNavButtonStyle}`}
          aria-pressed={activePage === 'kakaoTalk'}
        >
          카톡 전송 (P5)
        </button>
      </nav>
      
      {activePage === 'photoLog' && <PhotoLogPage userName={userName} />}
      {activePage === 'drinkingWater' && <DrinkingWaterPage userName={userName} />}
      {activePage === 'fieldCount' && <FieldCountPage userName={userName} />}
      {activePage === 'structuralCheck' && <StructuralCheckPage userName={userName} />}
      {activePage === 'kakaoTalk' && <KakaoTalkPage userName={userName} userContact={userContact} />}
      
      {userRole === 'admin' && <AdminPanel adminUserName={userName} />}

      <Footer />
    </div>
  );
};

export default PageContainer;