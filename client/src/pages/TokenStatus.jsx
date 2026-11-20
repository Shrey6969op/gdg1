import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getTokenStatus,
  checkinToken,
  cancelToken,
  rejoinToken
} from '../api.js';
import { subscribeToToken } from '../socket.js';
import {
  triggerTurnAlert,
  playChime,
  stopTitleFlash,
  requestNotificationPermission
} from '../useAudioAlert.js';

export default function TokenStatus() {
  const { id } = useParams();

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // In-app alert notification
  const [activeAlert, setActiveAlert] = useState(null);

  const fetchToken = async () => {
    try {
      const res = await getTokenStatus(id);
      setData(res);
      setLastUpdated(new Date());

      // Save to localStorage
      try {
        localStorage.setItem(
          'queueease_last_token',
          JSON.stringify({
            id: res.token.id,
            displayNumber: res.token.display_number,
            facilityCode: res.facility.code,
            savedAt: new Date().toISOString()
          })
        );
      } catch (e) {
        // ignore
      }
    } catch (err) {
      setErrorMessage(err.message || 'Token not found');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchToken();

    // Subscribe to realtime socket events for this token
    const unsubscribe = subscribeToToken(
      id,
      (freshData) => {
        setData(prev => ({
          ...prev,
          ...freshData
        }));
        setLastUpdated(new Date());
      },
      (notif) => {
        // Handle incoming notification
        setActiveAlert(notif);

        if (notif.type === 'CALLED' || notif.type === 'RECALLED') {
          triggerTurnAlert(notif.message, notif.counterNo);
        } else if (notif.type === 'NEAR') {
          playChime();
        }
      }
    );

    // 10-second polling fallback
    const interval = setInterval(fetchToken, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
      stopTitleFlash();
    };
  }, [id]);

  // Appointment checkin
  const handleCheckin = async () => {
    setActionLoading(true);
    setActionSuccess('');
    try {
      const res = await checkinToken(id);
      setActionSuccess('Checked in successfully! You are now in the active queue.');
      fetchToken();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to check in.');
    } finally {
      setActionLoading(false);
    }
  };

  // Rejoin queue after no-show
  const handleRejoin = async () => {
    setActionLoading(true);
    setActionSuccess('');
    try {
      const res = await rejoinToken(id);
      if (res.newToken) {
        window.location.href = `/token/${res.newToken.id}`;
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to rejoin queue.');
      setActionLoading(false);
    }
  };

  // Cancel token
  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel your token? You will lose your spot in line.')) {
      return;
    }
    setActionLoading(true);
    try {
      await cancelToken(id);
      setActionSuccess('Your token has been cancelled.');
      fetchToken();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to cancel token.');
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container loading-page">
        <div className="spinner"></div>
        <p>Retrieving your ticket...</p>
      </div>
    );
  }

  if (errorMessage && !data) {
    return (
      <div className="page-container error-page">
        <div className="error-card">
          <h2>Token Not Found</h2>
          <p>{errorMessage}</p>
          <Link to="/" className="btn btn-primary">Go to Home</Link>
        </div>
      </div>
    );
  }

  const { token, facility, position, peopleAhead, waitEstimate, servingTokens } = data;

  // Appointment check-in eligibility
  const now = new Date();
  const scheduledTime = token.appointment_time ? new Date(token.appointment_time) : null;
  const canCheckInNow = scheduledTime ? now.getTime() >= (scheduledTime.getTime() - 15 * 60 * 1000) : false;

  const isCalled = token.status === 'CALLED';
  const isServing = token.status === 'SERVING';
  const isWaiting = token.status === 'WAITING';
  const isBooked = token.status === 'BOOKED';
  const isNoShow = token.status === 'NO_SHOW';
  const isCompleted = token.status === 'COMPLETED';
  const isCancelled = token.status === 'CANCELLED';

  return (
    <div className="page-container token-status-page">
      {/* Realtime Notification Banner */}
      {activeAlert && (
        <div className={`alert-banner ${activeAlert.type.toLowerCase()}`}>
          <div className="banner-content">
            <span className="banner-icon">🔔</span>
            <div className="banner-text">
              <strong>{activeAlert.type}:</strong> {activeAlert.message}
            </div>
          </div>
          <button
            onClick={() => {
              setActiveAlert(null);
              stopTitleFlash();
            }}
            className="btn-dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* CALLED Call-to-action Banner */}
      {isCalled && (
        <div className="urgent-called-banner">
          <div className="called-pulse-icon">🚨</div>
          <div className="called-info">
            <h2>IT'S YOUR TURN!</h2>
            <p>Please proceed to <strong>COUNTER {token.counter_no}</strong> immediately.</p>
          </div>
          <button
            onClick={() => stopTitleFlash()}
            className="btn btn-sm btn-dark"
          >
            Acknowledge
          </button>
        </div>
      )}

      <div className="ticket-card">
        {/* Ticket Header */}
        <div className="ticket-header">
          <div className="facility-brand">
            <span className="fac-type">{facility.type}</span>
            <h3>{facility.name}</h3>
          </div>
          <span className={`status-badge-lg ${token.status.toLowerCase()}`}>
            {token.status}
          </span>
        </div>

        {/* Display Number */}
        <div className="token-hero">
          <span className="token-label">YOUR TOKEN</span>
          <div
            className="token-number"
            style={{ color: token.priority_color || 'var(--primary)' }}
          >
            {token.display_number}
          </div>
          <div className="token-priority-pill" style={{ backgroundColor: token.priority_color }}>
            {token.priority_label}
          </div>
          <div className="token-customer-name">Holder: {token.customer_name}</div>
        </div>

        {/* Action messages */}
        {actionSuccess && (
          <div className="alert alert-success">{actionSuccess}</div>
        )}
        {errorMessage && (
          <div className="alert alert-danger">{errorMessage}</div>
        )}

        {/* Dynamic Status Display */}
        {isWaiting && (
          <div className="queue-status-dashboard">
            <div className="status-metric-grid">
              <div className="metric-box">
                <span className="metric-label">Queue Position</span>
                <span className="metric-value">#{position || 1}</span>
                <span className="metric-sub">
                  {peopleAhead === 0
                    ? 'You are next in line!'
                    : `${peopleAhead} person(s) ahead`}
                </span>
              </div>

              <div className="metric-box">
                <span className="metric-label">Estimated Wait</span>
                <span className="metric-value">
                  {facility.status === 'paused' ? 'Paused' : waitEstimate?.displayText || 'Calculating...'}
                </span>
                <span className="metric-sub">
                  {waitEstimate?.expectedClockTime && facility.status !== 'paused'
                    ? `Estimated: ${new Date(waitEstimate.expectedClockTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : facility.status === 'paused'
                    ? facility.pause_reason || 'Queue on pause'
                    : 'Dynamic estimate'}
                </span>
              </div>
            </div>

            {/* Now Serving Live Strip */}
            <div className="now-serving-strip">
              <div className="strip-label">NOW SERVING AT FACILITY:</div>
              {servingTokens && servingTokens.length > 0 ? (
                <div className="serving-tokens-list">
                  {servingTokens.map((st) => (
                    <span key={st.id} className="serving-pill">
                      Counter {st.counter_no}: <strong>{st.display_number}</strong>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-muted">No counters actively serving at this moment</span>
              )}
            </div>
          </div>
        )}

        {isBooked && (
          <div className="appointment-card-info">
            <div className="appt-icon">📅</div>
            <h4>Scheduled Appointment</h4>
            <div className="appt-date">
              {scheduledTime?.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </div>
            <div className="appt-time">
              {scheduledTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>

            <div className="checkin-action-area">
              {canCheckInNow ? (
                <button
                  onClick={handleCheckin}
                  disabled={actionLoading}
                  className="btn btn-primary btn-lg btn-block"
                >
                  {actionLoading ? 'Checking in...' : "📍 I've Arrived (Check-in Now)"}
                </button>
              ) : (
                <div className="checkin-locked-notice">
                  Self check-in unlocks 15 minutes before your scheduled appointment time.
                </div>
              )}
            </div>
          </div>
        )}

        {isServing && (
          <div className="serving-in-progress">
            <div className="spinner pulse"></div>
            <h4>You are currently being served!</h4>
            <p>Counter <strong>#{token.counter_no}</strong></p>
          </div>
        )}

        {isNoShow && (
          <div className="noshow-card-info">
            <div className="noshow-icon">⚠️</div>
            <h4>You Were Marked as No-Show</h4>
            <p>
              Your token was called and the grace period expired. You can rejoin the queue once today.
            </p>
            {token.rejoined === 1 ? (
              <div className="alert alert-warning">
                You have already used your 1 rejoin ticket for today.
              </div>
            ) : (
              <button
                onClick={handleRejoin}
                disabled={actionLoading}
                className="btn btn-primary btn-lg"
              >
                {actionLoading ? 'Rejoining...' : '🔄 Rejoin Queue Now'}
              </button>
            )}
          </div>
        )}

        {isCompleted && (
          <div className="completed-card-info">
            <div className="comp-icon">✅</div>
            <h4>Service Completed</h4>
            <p>Thank you for using QueueEase. We hope you had a smooth experience!</p>
          </div>
        )}

        {isCancelled && (
          <div className="cancelled-card-info">
            <div className="cancel-icon">✕</div>
            <h4>Token Cancelled</h4>
            <p>This token has been cancelled and is no longer active.</p>
          </div>
        )}

        {/* Ticket Footer Actions */}
        <div className="ticket-footer">
          <div className="update-status">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>

          <div className="footer-actions">
            {(isWaiting || isBooked || isCalled) && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="btn btn-sm btn-outline-danger"
              >
                Cancel Token
              </button>
            )}
            <Link to={`/join/${facility.code}`} className="btn btn-sm btn-outline">
              New Token
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
