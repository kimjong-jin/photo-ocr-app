import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import UserNameInput from "./UserNameInput";
import { Header } from "./Header";
import MainPage from "./MainPage";

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [userName, setUserName] = React.useState<string | null>(null);
  const [userRole, setUserRole] = React.useState<string | null>(null);

  return (
    <BrowserRouter>
      <Header
        title="내부망 데이터 전송 시스템"
        description="수분석 자료 및 카카오톡 알림을 간편하게 전송합니다."
      />
      <Routes>
        <Route
          path="/login"
          element={
            <UserNameInput
              onLoginSuccess={(name, role) => {
                setIsLoggedIn(true);
                setUserName(name);
                setUserRole(role);
              }}
            />
          }
        />
        <Route
          path="/main"
          element={
            isLoggedIn ? (
              <MainPage userName={userName} userRole={userRole} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;