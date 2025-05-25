import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// import './index.css'; // ❌ index.css 파일이 없다면 이 줄은 주석처리하거나 삭제해야 합니다

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
