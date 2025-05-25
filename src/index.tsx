import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ApiKeyChecker from './components/ApiKeyChecke'; // Corrected import path if needed, assuming ApiKeyChecke.tsx

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ApiKeyChecker>
      <App />
    </ApiKeyChecker>
  </React.StrictMode>
);