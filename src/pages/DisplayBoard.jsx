import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getFacilityByCode } from '../api.js';
import { subscribeToFacility } from '../socket.js';
import { playChime } from '../useAudioAlert.js';

export default function DisplayBoard() {
  const { code } = useParams();

  const [state, setState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [lastCalledId, setLastCalledId] = useState(null);

  const fetchDisplayData = async () => {
    try {
      const res = await getFacilityByCode(code);
      setState(res);
    } catch (err) {
      console.error('Failed to load display data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDisplayData();

    // Clock ticker every second
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    // Socket subscription
    let unsubscribe = () => {};
    if (state?.facility?.id) {
      unsubscribe = subscribeToFacility(state.facility.id, (fresh) => {
        setState(prev => ({
          ...prev,
          ...fresh
        }));

        // Detect newly called token
        if (fresh.calledTokens && fresh.calledTokens.length > 0) {
          const newest = fresh.calledTokens[fresh.calledTokens.length - 1];
          setLastCalledId(newest.id);
          if (audioEnabled) {
            playChime();
          }
        }
      });
    }

    const polling = setInterval(fetchDisplayData, 8000);

    return () => {
      clearInterval(timer);
      clearInterval(polling);
      unsubscribe();
    };
  }, [code, state?.facility?.id, audioEnabled]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const enableAudio = () => {
    playChime();
    setAudioEnabled(true);
  };

  if (isLoading) {
    return (
      <div className="display-screen-container loading">
        <div className="spinner"></div>
        <h2>Loading Display Board...</h2>
      </div>
    );
  }

  if (!state || !state.facility) {
    return (
      <div className="display-screen-container error">
        <h2>Display Unavailable</h2>
        <p>No facility with code {code}</p>
        <Link to="/" className="btn btn-outline">Back to Home</Link>
      </div>
    );
  }

  const { facility, waitingTokens, calledTokens, servingTokens } = state;

  // Active tokens serving or called
  const activeTokens = [...calledTokens, ...servingTokens];
  const nextWaiting = (waitingTokens || []).slice(0, 5);

  const countersArray = Array.from({ length: facility.active_counters || 1 }, (_, i) => i + 1);

  return (
    <div className="display-board-screen">
      {/* TV Header Bar */}
      <header className="display-header">
        <div className="display-brand">
          <span className="brand-dot"></span>
          <div>
            <h1>{facility.name}</h1>
            <span className="facility-type-pill">{facility.type} • Queue Board</span>
          </div>
        </div>

        <div className="display-controls">
          {!audioEnabled && (
            <button onClick={enableAudio} className="btn-audio-enable" title="Click to enable sound chimes">
              🔔 Enable Chimes
            </button>
          )}
          <button onClick={toggleFullscreen} className="btn-fs" title="Toggle Fullscreen">
            ⛶
          </button>
          <div className="digital-clock">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      {/* Main Dual-Panel View */}
      <main className="display-main-grid">
        {/* Left Side: Huge Now Serving Cards */}
        <section className="now-serving-section">
          <div className="display-section-title">
            <span className="live-pulse-badge">● NOW SERVING</span>
            {facility.status === 'paused' && (
              <span className="display-paused-badge">⏸ QUEUE PAUSED: {facility.pause_reason}</span>
            )}
          </div>

          <div className="counters-display-grid">
            {countersArray.map((counterNum) => {
              const tokenAtCounter = activeTokens.find(t => (t.counter_no || 1) === counterNum);
              const isPulsing = tokenAtCounter && tokenAtCounter.id === lastCalledId;

              return (
                <div
                  key={counterNum}
                  className={`display-counter-card ${tokenAtCounter ? 'active' : 'idle'} ${isPulsing ? 'called-flash' : ''}`}
                >
                  <div className="counter-title">COUNTER {counterNum}</div>

                  {tokenAtCounter ? (
                    <div className="counter-token-hero">
                      <div
                        className="counter-token-number"
                        style={{ color: tokenAtCounter.priority_color || '#3b82f6' }}
                      >
                        {tokenAtCounter.display_number}
                      </div>

                      <div className="counter-customer-name">
                        {tokenAtCounter.customer_name}
                      </div>

                      <div className="counter-call-status">
                        {tokenAtCounter.status === 'CALLED' ? (
                          <span className="status-calling">🚨 PLEASE PROCEED</span>
                        ) : (
                          <span className="status-serving">IN SERVICE</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="counter-idle-state">
                      <div className="idle-indicator">READY</div>
                      <p>Next customer will be called here</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Side: Next 5 in Waiting Line */}
        <aside className="up-next-section">
          <div className="display-section-title">
            <span>UP NEXT ({waitingTokens.length} waiting)</span>
          </div>

          <div className="up-next-list">
            {nextWaiting.length === 0 ? (
              <div className="up-next-empty">
                <span>No customers currently in waiting line</span>
              </div>
            ) : (
              nextWaiting.map((token, index) => (
                <div key={token.id} className="up-next-item">
                  <div className="up-next-rank">#{index + 1}</div>
                  <div className="up-next-info">
                    <span className="up-next-token" style={{ color: token.priority_color }}>
                      {token.display_number}
                    </span>
                    <span className="up-next-name">{token.customer_name}</span>
                  </div>
                  <span
                    className="up-next-badge"
                    style={{ backgroundColor: token.priority_color }}
                  >
                    {token.priority_label}
                  </span>
                </div>
              ))
            )}
          </div>

          {waitingTokens.length > 5 && (
            <div className="up-next-more">
              + {waitingTokens.length - 5} more customers waiting in line
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
