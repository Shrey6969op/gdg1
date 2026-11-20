import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Home from './pages/Home.jsx';
import CreateFacility from './pages/CreateFacility.jsx';
import JoinQueue from './pages/JoinQueue.jsx';
import TokenStatus from './pages/TokenStatus.jsx';
import StaffDashboard from './pages/StaffDashboard.jsx';
import DisplayBoard from './pages/DisplayBoard.jsx';

function AppLayout({ children }) {
  const location = useLocation();
  const isDisplayBoard = location.pathname.startsWith('/display');

  return (
    <div className={`app-shell ${isDisplayBoard ? 'display-layout' : ''}`}>
      {!isDisplayBoard && <Navbar />}
      <main className="app-main-content">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<CreateFacility />} />
          <Route path="/join/:code" element={<JoinQueue />} />
          <Route path="/token/:id" element={<TokenStatus />} />
          <Route path="/staff/:code" element={<StaffDashboard />} />
          <Route path="/display/:code" element={<DisplayBoard />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
