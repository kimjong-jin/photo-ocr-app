import React, { useState } from 'react';
import PageContainer from './PageContainer';
import UserNameInput, { ALLOWED_USER_NAMES } from './components/UserNameInput';

const App: React.FC = () => {
  const [userName, setUserName] = useState<string | null>(null);

  const handleNameSubmit = (name: string) => {
    const trimmed = name.trim();
    if (ALLOWED_USER_NAMES.includes(trimmed)) {
      setUserName(trimmed);
    } else {
      alert("허용되지 않은 사용자입니다.");
    }
  };

  const handleLogout = () => {
    setUserName(null); 
  };

  if (!userName) {
    return <UserNameInput onNameSubmit={handleNameSubmit} />;
  }

  return <PageContainer userName={userName} onLogout={handleLogout} />;
};

export default App;
