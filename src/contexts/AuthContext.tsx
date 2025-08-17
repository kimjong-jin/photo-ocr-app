import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { USER_CREDENTIALS } from '../constants/credentials';
import { User } from '../types';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  isOnline: boolean;
  login: (name: string, pass: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'intranet-data-uploader-session';
const LOCAL_STORAGE_KEY = 'intranet-data-uploader-active-session';
const SESSION_VALIDATION_INTERVAL = 2000;

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const syncLogout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  useEffect(() => {
    try {
      const storedUser = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (storedUser) {
        const parsedUser: User = JSON.parse(storedUser);
        const activeSession = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (activeSession && activeSession === parsedUser.sessionId) {
          setUser(parsedUser);
        } else {
          syncLogout();
        }
      }
    } catch {
      // ignore parsing errors
    } finally {
      setIsLoading(false);
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY && !event.newValue) {
        syncLogout();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [syncLogout]);

   useEffect(() => {
    if (!user) return;

    const intervalId = setInterval(() => {
      const activeSessionId = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (activeSessionId !== user.sessionId) {
        alert("다른 탭/창에서 로그인하여 현재 세션이 종료되었습니다.");
        syncLogout();
      }
    }, SESSION_VALIDATION_INTERVAL);

    return () => clearInterval(intervalId);
  }, [user, syncLogout]);


  const login = useCallback(async (name: string, pass: string): Promise<void> => {
    const trimmedName = name.trim();
    const userDetail = USER_CREDENTIALS[trimmedName];

    if (!userDetail) {
      throw new Error('ID 또는 비밀번호가 올바르지 않습니다.');
    }

    if (userDetail.role === 'guest') {
        const currentDate = new Date();
        const cutoffDate = new Date(2025, 5, 28); // Month is 0-indexed, so 5 is June
        if (currentDate >= cutoffDate) {
            throw new Error('게스트 로그인은 2025년 6월 27일까지만 가능합니다.');
        }
    }
    
    if (userDetail.password !== pass.trim()) {
      throw new Error('ID 또는 비밀번호가 올바르지 않습니다.');
    }

    const sessionId = self.crypto.randomUUID();
    const newUser: User = { name: trimmedName, role: userDetail.role, sessionId };
    
    setUser(newUser);
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newUser));
    localStorage.setItem(LOCAL_STORAGE_KEY, sessionId); 
  }, []);

  const logout = useCallback(() => {
    syncLogout();
    localStorage.removeItem(LOCAL_STORAGE_KEY); 
  }, [syncLogout]);

  const value = {
    isAuthenticated: !!user,
    user,
    isLoading,
    isOnline,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};