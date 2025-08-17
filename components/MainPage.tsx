import React from "react";

interface MainPageProps {
  userName: string | null;
  userRole: string | null;
}

const MainPage: React.FC<MainPageProps> = ({ userName, userRole }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold mb-4">환영합니다, {userName}님!</h2>
      <p className="text-slate-400 mb-2">권한: {userRole}</p>
      <p className="text-slate-300">이곳에서 수분석 결과 전송 등 주요 기능을 사용할 수 있습니다.</p>
    </div>
  );
};

export default MainPage; 