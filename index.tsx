import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import ApiKeyChecker from './components/ApiKeyChecker';
import PageContainer from './PageContainer'; 
import UserNameInput, { ALLOWED_USER_NAMES } from './components/UserNameInput'; // Import ALLOWED_USER_NAMES

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const USER_NAME_LOCAL_STORAGE_KEY = 'photoLogAppUserName';

const AppWrapper: React.FC = () => {
  const [userName, setUserName] = useState<string>('');
  const [isUserNameSet, setIsUserNameSet] = React.useState<boolean>(false);
  const [isLoadingUserName, setIsLoadingUserName] = useState<boolean>(true);


  useEffect(() => {
    const savedUserName = localStorage.getItem(USER_NAME_LOCAL_STORAGE_KEY);
    if (savedUserName && ALLOWED_USER_NAMES.includes(savedUserName)) {
      setUserName(savedUserName);
      setIsUserNameSet(true);
    }
    setIsLoadingUserName(false);
  }, []);

  const handleNameSubmit = useCallback((name: string) => {
    if (name.trim() && ALLOWED_USER_NAMES.includes(name.trim())) { // Ensure submitted name is also allowed
      const trimmedName = name.trim();
      localStorage.setItem(USER_NAME_LOCAL_STORAGE_KEY, trimmedName);
      setUserName(trimmedName);
      setIsUserNameSet(true);
    } else {
      // This case should be handled within UserNameInput (displaying error if not allowed),
      // but as a fallback or if somehow bypassed:
      alert("유효한 이름을 입력하거나 선택해주세요.");
      localStorage.removeItem(USER_NAME_LOCAL_STORAGE_KEY); // Clear invalid stored name
    }
  }, []);

  if (isLoadingUserName) {
    // Optional: add a loading spinner or minimal UI here if desired
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        {/* Placeholder for a loading indicator if needed */}
      </div>
    );
  }

  if (!isUserNameSet) {
    return <UserNameInput onNameSubmit={handleNameSubmit} />;
  }

  return (
    <ApiKeyChecker>
      <PageContainer userName={userName} />
    </ApiKeyChecker>
  );
};


const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);