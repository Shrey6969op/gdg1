import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getFacilityByCode,
  staffCallNext,
  staffRecall,
  staffStartServing,
  staffComplete,
  staffNoShow,
  staffChangePriority,
  staffCancelToken,
  staffCheckin,
  staffWalkIn,
  staffPauseQueue,
  staffResumeQueue,
  staffSetCounters,
  staffResetDay,
  staffSimulate,
  updateFacility
} from '../api.js';
import { subscribeToFacility } from '../socket.js';
import { playChime } from '../useAudioAlert.js';

export default function StaffDashboard() {
  const { code } = useParams();

  // PIN authentication state
  const sessionPinKey = `queueease_pin_${code}`;
  const [pin, setPin] = useState(() => sessionStorage.getItem(sessionPinKey) || '');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(sessionStorage.getItem(sessionPinKey)));

  const [state, setState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Modals state
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInPriorityId, setWalkInPriorityId] = useState('');

  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseReason, setPauseReason] = useState('Staff meeting in progress');

  const [showPriorityModal, setShowPriorityModal] = useState(false);
  const [targetTokenForPriority, setTargetTokenForPriority] = useState(null);
  const [newPriorityId, setNewPriorityId] = useState('');

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editCounters, setEditCounters] = useState(1);
  const [editDefaultService, setEditDefaultService] = useState(10);
  const [editAgingMinutes, setEditAgingMinutes] = useState(20);
  const [editGraceMinutes, setEditGraceMinutes] = useState(3);

  // Fetch queue data
  const fetchData = async (targetPin = pin) => {
    try {
      const res = await getFacilityByCode(code);
      setState(res);
      setEditCounters(res.facility.active_counters);
      setEditDefaultService(res.facility.default_service_minutes);
      setEditAgingMinutes(res.facility.aging_minutes);
      setEditGraceMinutes(res.facility.no_show_grace_minutes);
      if (res.priorities && res.priorities.length > 0 && !walkInPriorityId) {
        const def = res.priorities.find(p => p.prefix === 'R') || res.priorities[0];
        setWalkInPriorityId(def.id);
      }
    } catch (err) {
      setActionError(err.message || 'Failed to load facility data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    let unsubscribe = () => {};
    if (state?.facility?.id) {
      unsubscribe = subscribeToFacility(state.facility.id, (fresh) => {
        setState(prev => ({
          ...prev,
          ...fresh
        }));
      });
    }

    const interval = setInterval(() => fetchData(), 10000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [code, state?.facility?.id]);

  // Handle PIN submission
  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (!pinInput || pinInput.length !== 4) {
      setPinError('Please enter a 4-digit PIN.');
      return;
    }
    // Check against facility staff_pin
    if (state && String(state.facility.staff_pin).trim() !== String(pinInput).trim()) {
      setPinError('Incorrect PIN. Please try again.');
      return;
    }

    sessionStorage.setItem(sessionPinKey, pinInput);
    setPin(pinInput);
    setIsAuthenticated(true);
    setPinError('');
  };

  const handleLogout = () => {
    sessionStorage.removeItem(sessionPinKey);
    setPin('');
    setIsAuthenticated(false);
  };

  // Safe wrapper for API calls with PIN
  const executeStaffAction = async (actionFn, successMsg) => {
    setActionError('');
    setActionSuccess('');
    try {
      await actionFn();
      if (successMsg) setActionSuccess(successMsg);
      fetchData();
    } catch (err) {
      setActionError(err.message || 'Action failed.');
    }
  };

  // Staff action handlers
  const handleCallNext = (counterNo = 1) => {
    executeStaffAction(
      () => staffCallNext(code, pin, counterNo),
      `Called next waiting customer to Counter ${counterNo}.`
    );
  };

  const handleRecall = (tokenId) => {
    executeStaffAction(
      () => staffRecall(code, pin, tokenId),
      'Customer recalled with notification alert.'
    );
  };

  const handleStartServing = (tokenId) => {
    executeStaffAction(
      () => staffStartServing(code, pin, tokenId),
      'Customer status updated to SERVING.'
    );
  };

  const handleComplete = (tokenId) => {
    executeStaffAction(
      () => staffComplete(code, pin, tokenId),
      'Customer service COMPLETED.'
    );
  };

  const handleNoShow = (tokenId) => {
    executeStaffAction(
      () => staffNoShow(code, pin, tokenId),
      'Customer marked as NO_SHOW.'
    );
  };

  const handleOpenPriorityModal = (token) => {
    setTargetTokenForPriority(token);
    setNewPriorityId(token.priority_id);
    setShowPriorityModal(true);
  };

  const handleSavePriorityChange = () => {
    if (!targetTokenForPriority || !newPriorityId) return;
    executeStaffAction(
      () => staffChangePriority(code, pin, targetTokenForPriority.id, newPriorityId),
      `Priority updated for ${targetTokenForPriority.display_number}.`
    );
    setShowPriorityModal(false);
  };

  const handleStaffCancel = (tokenId) => {
    if (!window.confirm('Are you sure you want to cancel this token?')) return;
    executeStaffAction(
      () => staffCancelToken(code, pin, tokenId),
      'Token cancelled by staff.'
    );
  };

  const handleStaffCheckin = (tokenId) => {
    executeStaffAction(
      () => staffCheckin(code, pin, tokenId),
      'Appointment checked in successfully.'
    );
  };

  const handleWalkInSubmit = (e) => {
    e.preventDefault();
    if (!walkInName.trim()) return;

    executeStaffAction(
      () => staffWalkIn(code, pin, {
        customer_name: walkInName.trim(),
        phone: walkInPhone.trim() || null,
        priority_id: walkInPriorityId
      }),
      'Walk-in customer added to queue.'
    );

    setShowWalkInModal(false);
    setWalkInName('');
    setWalkInPhone('');
  };

  const handleTogglePause = () => {
    if (state.facility.status === 'open') {
      setShowPauseModal(true);
    } else {
      executeStaffAction(
        () => staffResumeQueue(code, pin),
        'Queue has resumed normal operations.'
      );
    }
  };

  const handleConfirmPause = () => {
    executeStaffAction(
      () => staffPauseQueue(code, pin, pauseReason),
      'Queue is now paused.'
    );
    setShowPauseModal(false);
  };

  const handleSimulate = () => {
    executeStaffAction(
      () => staffSimulate(code, pin),
      'Added 5 simulation demo customers across Emergency, Senior, Appointment, and Regular categories!'
    );
  };

  const handleResetDay = () => {
    if (!window.confirm('DANGER: This will cancel all currently active tokens and reset the queue for the day. Proceed?')) {
      return;
    }
    executeStaffAction(
      () => staffResetDay(code, pin),
      'Day reset completed.'
    );
  };

  const handleSaveSettings = () => {
    executeStaffAction(
      () => updateFacility(code, pin, {
        active_counters: Number(editCounters),
        default_service_minutes: Number(editDefaultService),
        aging_minutes: Number(editAgingMinutes),
        no_show_grace_minutes: Number(editGraceMinutes)
      }),
      'Facility settings updated.'
    );
    setShowSettingsModal(false);
  };

  if (isLoading) {
    return (
      <div className="page-container loading-page">
        <div className="spinner"></div>
        <p>Loading staff console...</p>
      </div>
    );
  }

  if (!state || !state.facility) {
    return (
      <div className="page-container error-page">
        <div className="error-card">
          <h2>Facility Not Found</h2>
          <p>No facility registered with code <strong>{code}</strong>.</p>
          <Link to="/" className="btn btn-primary">Return Home</Link>
        </div>
      </div>
    );
  }

  // PIN GATE SCREEN
  if (!isAuthenticated) {
    return (
      <div className="page-container pin-gate-page">
        <div className="pin-card">
          <div className="pin-icon">🔒</div>
          <h2>Staff Access Gate</h2>
          <p className="text-muted">
            Enter the 4-digit PIN for <strong>{state.facility.name}</strong> ({state.facility.code}).
          </p>

          {pinError && <div className="alert alert-danger">{pinError}</div>}

          <form onSubmit={handlePinSubmit} className="pin-form">
            <input
              type="password"
              maxLength={4}
              placeholder="••••"
              value={pinInput}
              autoFocus
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
              className="input-pin-box"
            />
            <button type="submit" className="btn btn-primary btn-lg btn-block">
              Unlock Dashboard
            </button>
          </form>

          <div className="pin-hint">
            Tip: For demo facilities (DEMO01, DEMO02), the default PIN is <strong>1234</strong>.
          </div>
        </div>
      </div>
    );
  }

  const { facility, priorities, stats, waitingTokens, calledTokens, servingTokens, bookedTokens } = state;
  const isPaused = facility.status === 'paused';

  // Group active counter tokens (CALLED or SERVING)
  const activeTokensByCounter = {};
  [...calledTokens, ...servingTokens].forEach((t) => {
    activeTokensByCounter[t.counter_no || 1] = t;
  });

  const countersArray = Array.from({ length: facility.active_counters || 1 }, (_, i) => i + 1);

  return (
    <div className="page-container staff-page">
      {/* Top Facility Control Header */}
      <div className="staff-header-card">
        <div className="facility-identity">
          <div className="fac-meta-row">
            <span className="type-badge">{facility.type}</span>
            <span className="code-pill">CODE: {facility.code}</span>
            <span className={`status-pill ${facility.status}`}>
              {facility.status === 'open' ? '● Open' : '⏸ Paused'}
            </span>
          </div>
          <h1>{facility.name}</h1>
          {isPaused && (
            <div className="pause-reason-alert">
              ⏸ Paused: <strong>{facility.pause_reason}</strong>
            </div>
          )}
        </div>

        <div className="staff-control-actions">
          <button
            onClick={handleTogglePause}
            className={`btn btn-sm ${isPaused ? 'btn-success' : 'btn-outline-warning'}`}
          >
            {isPaused ? '▶ Resume Queue' : '⏸ Pause Queue'}
          </button>

          <button
            onClick={() => setShowWalkInModal(true)}
            className="btn btn-sm btn-outline"
          >
            + Add Walk-In
          </button>

          <button
            onClick={handleSimulate}
            className="btn btn-sm btn-outline-info"
            title="Adds 5 demo customers with mixed priorities"
          >
            ⚡ Simulate Customers
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="btn btn-sm btn-outline"
          >
            ⚙️ Settings
          </button>

          <Link
            to={`/display/${facility.code}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm btn-dark"
          >
            TV Display ↗
          </Link>

          <button
            onClick={handleLogout}
            className="btn btn-sm btn-outline-danger"
            title="Lock staff screen"
          >
            Lock 🔒
          </button>
        </div>
      </div>

      {/* Global Action Feedback Alerts */}
      {actionSuccess && (
        <div className="alert alert-success alert-dismissible">
          <span>✓ {actionSuccess}</span>
          <button onClick={() => setActionSuccess('')} className="close-btn">✕</button>
        </div>
      )}
      {actionError && (
        <div className="alert alert-danger alert-dismissible">
          <span>⚠️ {actionError}</span>
          <button onClick={() => setActionError('')} className="close-btn">✕</button>
        </div>
      )}

      {/* Realtime Stats Bar */}
      <div className="stats-bar-grid">
        <div className="stat-card">
          <div className="stat-label">Waiting in Line</div>
          <div className="stat-value">{stats?.waitingCount || 0}</div>
          <div className="stat-sub">Active waiting tokens</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Currently Serving</div>
          <div className="stat-value">{stats?.servingCount || 0}</div>
          <div className="stat-sub">{stats?.calledCount || 0} called</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Booked Appointments</div>
          <div className="stat-value">{stats?.bookedCount || 0}</div>
          <div className="stat-sub">Upcoming scheduled</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Avg Service Time</div>
          <div className="stat-value">{stats?.avgServiceMinutes || facility.default_service_minutes}m</div>
          <div className="stat-sub">Dynamic rolling average</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Served Today</div>
          <div className="stat-value">{stats?.servedTodayCount || 0}</div>
          <div className="stat-sub">{stats?.noShowTodayCount || 0} no-shows</div>
        </div>
      </div>

      {/* NOW SERVING COUNTER BAYS */}
      <section className="counter-bays-section">
        <div className="section-header">
          <h2>Active Service Counters</h2>
          <span className="text-muted">{facility.active_counters} bays configured</span>
        </div>

        <div className="counters-grid">
          {countersArray.map((counterNum) => {
            const activeToken = activeTokensByCounter[counterNum];

            return (
              <div key={counterNum} className={`counter-bay-card ${activeToken ? 'occupied' : 'vacant'}`}>
                <div className="counter-bay-header">
                  <h3>COUNTER #{counterNum}</h3>
                  <span className={`bay-status-badge ${activeToken ? activeToken.status.toLowerCase() : 'vacant'}`}>
                    {activeToken ? activeToken.status : 'Vacant'}
                  </span>
                </div>

                {activeToken ? (
                  <div className="counter-occupied-content">
                    <div className="active-token-hero">
                      <span className="display-num" style={{ color: activeToken.priority_color }}>
                        {activeToken.display_number}
                      </span>
                      <span className="p-pill" style={{ backgroundColor: activeToken.priority_color }}>
                        {activeToken.priority_label}
                      </span>
                    </div>

                    <div className="customer-info-line">
                      <strong>{activeToken.customer_name}</strong>
                      {activeToken.phone && <span className="text-muted"> • {activeToken.phone}</span>}
                    </div>

                    <div className="call-info-line">
                      Calls made: <strong>{activeToken.call_count} / 3</strong>
                      {activeToken.called_at && (
                        <span> • Called at {new Date(activeToken.called_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>

                    <div className="bay-actions-grid">
                      {activeToken.status === 'CALLED' && (
                        <>
                          <button
                            onClick={() => handleRecall(activeToken.id)}
                            disabled={activeToken.call_count >= 3}
                            className="btn btn-sm btn-outline-warning"
                          >
                            🔔 Recall ({activeToken.call_count}/3)
                          </button>
                          <button
                            onClick={() => handleStartServing(activeToken.id)}
                            className="btn btn-sm btn-primary"
                          >
                            ▶ Start Serving
                          </button>
                          <button
                            onClick={() => handleNoShow(activeToken.id)}
                            className="btn btn-sm btn-outline-danger"
                          >
                            No-Show
                          </button>
                        </>
                      )}

                      {activeToken.status === 'SERVING' && (
                        <button
                          onClick={() => handleComplete(activeToken.id)}
                          className="btn btn-sm btn-success btn-block"
                        >
                          ✓ Complete Service
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="counter-vacant-content">
                    <div className="vacant-illustration">🪑 Available</div>
                    <button
                      onClick={() => handleCallNext(counterNum)}
                      disabled={waitingTokens.length === 0}
                      className="btn btn-primary btn-block"
                    >
                      Call Next Customer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* DYNAMIC WAITING QUEUE */}
      <section className="waiting-queue-section">
        <div className="section-header-row">
          <div>
            <h2>Dynamic Waiting Queue ({waitingTokens.length})</h2>
            <p className="text-muted">
              Dynamically sorted by Effective Rank (Priority Rank - Aging), Arrival Time, and Sequence.
            </p>
          </div>

          <div className="queue-header-actions">
            <button
              onClick={() => handleCallNext(1)}
              disabled={waitingTokens.length === 0}
              className="btn btn-primary"
            >
              ⚡ Call Next (Counter 1)
            </button>
          </div>
        </div>

        {waitingTokens.length === 0 ? (
          <div className="empty-queue-box">
            <div className="empty-icon">☕</div>
            <h3>Queue is empty</h3>
            <p>No customers currently waiting. You can add walk-ins or run a simulation.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="staff-queue-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Token</th>
                  <th>Customer Name</th>
                  <th>Priority Category</th>
                  <th>Waited</th>
                  <th>Effective Rank</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {waitingTokens.map((t, idx) => (
                  <tr key={t.id} className={idx === 0 ? 'top-priority-row' : ''}>
                    <td>
                      <span className="queue-position-badge">#{t.position}</span>
                    </td>
                    <td>
                      <strong className="token-code" style={{ color: t.priority_color }}>
                        {t.display_number}
                      </strong>
                    </td>
                    <td>
                      <div className="customer-cell">
                        <span className="customer-name">{t.customer_name}</span>
                        {t.phone && <span className="customer-phone">{t.phone}</span>}
                        {t.is_appointment === 1 && <span className="badge-appt">Appt</span>}
                      </div>
                    </td>
                    <td>
                      <span className="priority-chip" style={{ backgroundColor: t.priority_color }}>
                        {t.priority_label}
                      </span>
                    </td>
                    <td>{t.minutes_waited || 0}m</td>
                    <td>
                      <span className="eff-rank-tag">
                        Rank {t.effective_rank}
                        {t.effective_rank < t.priority_rank && (
                          <span className="aged-bonus" title="Aged up due to wait time"> ⬆ (Aged)</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          onClick={() => handleCallNext(1)}
                          className="btn btn-xs btn-primary"
                          title="Call to Counter 1"
                        >
                          Call
                        </button>
                        <button
                          onClick={() => handleOpenPriorityModal(t)}
                          className="btn btn-xs btn-outline"
                          title="Change Priority Category"
                        >
                          Change Priority
                        </button>
                        <button
                          onClick={() => handleStaffCancel(t.id)}
                          className="btn btn-xs btn-outline-danger"
                          title="Cancel token"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* BOOKED APPOINTMENTS SECTION */}
      {bookedTokens && bookedTokens.length > 0 && (
        <section className="booked-appts-section">
          <div className="section-header">
            <h2>Booked Appointments ({bookedTokens.length})</h2>
            <p className="text-muted">Customers holding future scheduled slots</p>
          </div>

          <div className="booked-cards-grid">
            {bookedTokens.map((bt) => {
              const apptDate = bt.appointment_time ? new Date(bt.appointment_time) : null;
              return (
                <div key={bt.id} className="booked-card">
                  <div className="booked-card-header">
                    <span className="booked-token">{bt.display_number}</span>
                    <span className="booked-time">
                      {apptDate?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <h4>{bt.customer_name}</h4>
                  <div className="booked-sub">
                    {apptDate?.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {bt.phone && ` • ${bt.phone}`}
                  </div>
                  <button
                    onClick={() => handleStaffCheckin(bt.id)}
                    className="btn btn-sm btn-outline-primary btn-block"
                  >
                    Staff Check-In Override
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Danger Zone: Reset Day */}
      <section className="danger-zone-section">
        <div className="danger-card">
          <div>
            <h4>Reset Day Queue</h4>
            <p className="text-muted">Clears all active tokens for today. Use at closing time.</p>
          </div>
          <button onClick={handleResetDay} className="btn btn-outline-danger">
            Reset Day
          </button>
        </div>
      </section>

      {/* MODAL: ADD WALK-IN CUSTOMER */}
      {showWalkInModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Add Walk-In Customer</h3>
              <button onClick={() => setShowWalkInModal(false)} className="modal-close">✕</button>
            </div>
            <form onSubmit={handleWalkInSubmit}>
              <div className="form-group">
                <label>Customer Name *</label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Phone Number (Optional)</label>
                <input
                  type="tel"
                  placeholder="e.g. +1 555-0123"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Priority Category *</label>
                <select
                  value={walkInPriorityId}
                  onChange={(e) => setWalkInPriorityId(e.target.value)}
                >
                  {priorities.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.prefix} - {p.label} (Rank {p.rank})
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="btn btn-outline"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add to Waiting Line
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PAUSE QUEUE */}
      {showPauseModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Pause Queue</h3>
              <button onClick={() => setShowPauseModal(false)} className="modal-close">✕</button>
            </div>
            <div className="form-group">
              <label>Reason for Pause</label>
              <input
                type="text"
                value={pauseReason}
                placeholder="e.g. Staff break, Shift handover, System maintenance"
                onChange={(e) => setPauseReason(e.target.value)}
              />
              <span className="field-hint">Customers will see this reason on their ticket screens.</span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowPauseModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPause}
                className="btn btn-warning"
              >
                Confirm Pause
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CHANGE PRIORITY */}
      {showPriorityModal && targetTokenForPriority && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Change Priority for {targetTokenForPriority.display_number}</h3>
              <button onClick={() => setShowPriorityModal(false)} className="modal-close">✕</button>
            </div>
            <p>Customer: <strong>{targetTokenForPriority.customer_name}</strong></p>
            <div className="form-group">
              <label>Select New Category</label>
              <select
                value={newPriorityId}
                onChange={(e) => setNewPriorityId(e.target.value)}
              >
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.prefix} - {p.label} (Rank {p.rank})
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowPriorityModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePriorityChange}
                className="btn btn-primary"
              >
                Update Priority
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SETTINGS */}
      {showSettingsModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Facility Queue Settings</h3>
              <button onClick={() => setShowSettingsModal(false)} className="modal-close">✕</button>
            </div>
            <div className="form-group">
              <label>Active Counters</label>
              <input
                type="number"
                min="1"
                max="20"
                value={editCounters}
                onChange={(e) => setEditCounters(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Default Service Minutes</label>
              <input
                type="number"
                min="1"
                max="120"
                value={editDefaultService}
                onChange={(e) => setEditDefaultService(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Priority Aging (minutes, 0 = off)</label>
              <input
                type="number"
                min="0"
                max="120"
                value={editAgingMinutes}
                onChange={(e) => setEditAgingMinutes(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>No-Show Grace Period (minutes)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={editGraceMinutes}
                onChange={(e) => setEditGraceMinutes(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="btn btn-primary"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
