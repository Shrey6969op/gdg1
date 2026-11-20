import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import LiveIndicator from './LiveIndicator.jsx';

export default function Navbar() {
  const location = useLocation();
  const [activeToken, setActiveToken] = useState(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('queueease_last_token');
      if (stored) {
        setActiveToken(JSON.parse(stored));
      }
    } catch (e) {
      // ignore
    }
  }, [location]);

  return (
    <header className="app-navbar">
      <div className="nav-container">
        <Link to="/" className="brand-logo">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">QueueEase</span>
        </Link>

        <nav className="nav-links">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
            Home
          </Link>
          <Link to="/create" className={location.pathname === '/create' ? 'active' : ''}>
            Create Queue
          </Link>
          {activeToken && !location.pathname.startsWith('/token') && (
            <Link to={`/token/${activeToken.id}`} className="my-token-chip" title="View your active token">
              <span>🎟️</span>
              <strong>{activeToken.displayNumber}</strong>
            </Link>
          )}
        </nav>

        <div className="nav-actions">
          <LiveIndicator />
        </div>
      </div>
    </header>
  );
}
