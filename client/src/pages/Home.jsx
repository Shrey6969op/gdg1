import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getFacilities } from '../api.js';

export default function Home() {
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchList = async () => {
    try {
      const data = await getFacilities();
      setFacilities(data);
    } catch (err) {
      console.error('Failed to load facilities:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // 10s polling fallback
    const interval = setInterval(fetchList, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    const clean = joinCode.trim().toUpperCase();
    if (!clean) {
      setJoinError('Please enter a 6-character facility code.');
      return;
    }
    setJoinError('');
    navigate(`/join/${clean}`);
  };

  const filteredFacilities = facilities.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="page-container home-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-badge">Smart Queue & Appointment Manager</div>
          <h1>Never wait in physical lines again.</h1>
          <p>
            QueueEase enables clinics, therapists, HR desks, banks, salons, and offices to run dynamic digital queues with live estimated waiting times and intelligent priority categories.
          </p>

          <div className="hero-actions">
            <Link to="/create" className="btn btn-primary btn-lg">
              ✨ Create My Queue
            </Link>

            <form onSubmit={handleJoinSubmit} className="join-code-form">
              <input
                type="text"
                placeholder="Enter 6-char code (e.g. DEMO01)"
                value={joinCode}
                maxLength={6}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="input-code"
              />
              <button type="submit" className="btn btn-secondary">
                Join Queue
              </button>
            </form>
          </div>
          {joinError && <div className="form-error inline-error">{joinError}</div>}
        </div>
      </section>

      {/* Demo Facilities Showcase */}
      <section className="demo-showcase">
        <h2>⚡ Quick Demo Facilities (Pre-loaded with Seed Data)</h2>
        <p className="section-subtitle">Jump straight into testing both staff management and customer flows:</p>

        <div className="demo-cards-grid">
          <div className="demo-card">
            <div className="demo-header">
              <span className="demo-tag clinic">🏥 Clinic</span>
              <span className="code-badge">DEMO01</span>
            </div>
            <h3>City Clinic</h3>
            <p>2 Active Counters • Aging Enabled (20m) • PIN: <strong>1234</strong></p>
            <div className="demo-links">
              <Link to="/join/DEMO01" className="btn btn-sm btn-outline">Customer Join</Link>
              <Link to="/staff/DEMO01" className="btn btn-sm btn-primary">Staff Dashboard</Link>
              <Link to="/display/DEMO01" className="btn btn-sm btn-dark">TV Display</Link>
            </div>
          </div>

          <div className="demo-card">
            <div className="demo-header">
              <span className="demo-tag therapist">🧠 Therapist</span>
              <span className="code-badge">DEMO02</span>
            </div>
            <h3>Mind Wellness Therapy</h3>
            <p>1 Counter Bay • 20m Consultations • PIN: <strong>1234</strong></p>
            <div className="demo-links">
              <Link to="/join/DEMO02" className="btn btn-sm btn-outline">Customer Join</Link>
              <Link to="/staff/DEMO02" className="btn btn-sm btn-primary">Staff Dashboard</Link>
              <Link to="/display/DEMO02" className="btn btn-sm btn-dark">TV Display</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Facility Directory */}
      <section className="directory-section">
        <div className="directory-header">
          <div>
            <h2>Active Service Facilities</h2>
            <p className="text-muted">Browse public service queues in your organization</p>
          </div>

          <div className="search-box">
            <input
              type="text"
              placeholder="Search by name, type, or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-search"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading available queues...</p>
          </div>
        ) : filteredFacilities.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏢</div>
            <h3>No facilities match your search</h3>
            <p>Try a different keyword or create your own digital queue right now.</p>
            <Link to="/create" className="btn btn-primary">Create Facility Queue</Link>
          </div>
        ) : (
          <div className="facility-grid">
            {filteredFacilities.map((fac) => (
              <div key={fac.id} className="facility-card">
                <div className="card-top">
                  <span className={`status-pill ${fac.status}`}>
                    {fac.status === 'open' ? '● Open' : '⏸ Paused'}
                  </span>
                  <span className="facility-code">{fac.code}</span>
                </div>

                <h3 className="facility-name">{fac.name}</h3>
                <div className="facility-type-tag">Category: {fac.type}</div>

                <div className="facility-stats-row">
                  <div className="stat-pill">
                    <span className="stat-num">{fac.waitingCount || 0}</span>
                    <span className="stat-lbl">Waiting</span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-num">{fac.servingCount || 0}</span>
                    <span className="stat-lbl">Serving</span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-num">{fac.active_counters}</span>
                    <span className="stat-lbl">Counters</span>
                  </div>
                </div>

                <div className="card-footer-actions">
                  <Link to={`/join/${fac.code}`} className="btn btn-primary btn-block">
                    Join Queue
                  </Link>
                  <div className="secondary-links">
                    <Link to={`/staff/${fac.code}`}>Staff Portal</Link>
                    <span>•</span>
                    <Link to={`/display/${fac.code}`} target="_blank" rel="noreferrer">Display Board</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
