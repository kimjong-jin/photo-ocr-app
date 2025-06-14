import React from 'react';

const AlertTriangleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-16 h-16 mb-4 text-red-500"
    {...props}
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface ApiKeyCheckerProps {
  children: React.ReactNode;
}

// ✅ Vite에서 환경 변수는 import.meta.env 사용
const API_KEY = import.meta.env.VITE_API_KEY;

const ApiKeyChecker: React.FC<ApiKeyCheckerProps> = ({ children }) => {
  if (!API_KEY) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-300 p-8">
        <AlertTriangleIcon />
        <h2 className="text-2xl font-bold mb-2 text-red-400">API 키 누락</h2>
        <p className="text-center max-w-md">
          Google Gemini API 키가 구성되지 않았습니다. 실행 환경에 <code>VITE_API_KEY</code> 환경 변수가 설정되어 있는지 확인하세요.
        </p>
        <p className="text-sm mt-4 text-slate-500">이 애플리케이션은 API 키 없이 작동할 수 없습니다.</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApiKeyChecker;
