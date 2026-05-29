

import React from 'react';

const AlertTriangleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="48"
    height="48"
    viewBox="0 0 24 24"
    className="w-16 h-16 mb-4 text-red-500" // currentColor will be red
    {...props}
  >
    {/* Triangle body - filled with currentColor (red) */}
    <path
      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      fill="currentColor"
    />
    {/* Exclamation mark lines - explicitly set stroke to white for contrast */}
    <line
      x1="12"
      y1="9"
      x2="12"
      y2="13"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line
      x1="12"
      y1="17"
      x2="12.01"
      y2="17"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);


interface ApiKeyCheckerProps {
  children: React.ReactNode;
}

// ✅ 보안 강화: API 키는 서버(Vercel Serverless)에서만 관리됩니다.
// 클라이언트에서 VITE_API_KEY를 체크할 필요가 없습니다.
const ApiKeyChecker: React.FC<ApiKeyCheckerProps> = ({ children }) => {
  return <>{children}</>;
};

export default ApiKeyChecker;
