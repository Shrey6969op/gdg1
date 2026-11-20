import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFacilityByCode, joinQueue } from '../api.js';
import { subscribeToFacility } from '../socket.js';
import { requestNotificationPermission } from '../useAudioAlert.js';

export default function JoinQueue() {
  const { code } = useParams();
  const navigate = useNavigate();

  const [facilityData, setFacilityData] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedPriorityId, setSelectedPriorityId] = useState(null);
  const [isAppointment, setIsAppointment] = useState(false);
  const [appointmentTime, setAppointmentTime] = useState('');
  const [notifyAt, setNotifyAt] = useState(3);

  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch facility details
  const fetchFacility = async () => {
    try {
      const data = await getFacilityByCode(code);
      setFacilityData(data);
      // Default to regular or last priority
      if (!selectedPriorityId && data.priorities && data.priorities.length > 0) {
        const defaultP = data.priorities.find(p => p.prefix === 'R') || data.priorities[data.priorities.length - 1];
        setSelectedPriorityId(defaultP.id);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Facility not found');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFacility();

    // Subscribe to realtime updates for live queue preview
    let unsubscribe = () => {};
    if (facilityData?.facility?.id) {
      unsubscribe = subscribeToFacility(facilityData.facility.id, (fresh) => {
        setFacilityData(prev => ({
          ...prev,
          ...fresh
        }));
      });
    }

    // Polling fallback
    const interval = setInterval(fetchFacility, 10000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [code, facilityData?.facility?.id]);

  // Generate 15-minute appointment slots for the next 7 days
  const generateAppointmentSlots = () => {
    const slots = [];
    const now = new Date();

    for (let day = 0; day < 7; day++) {
      const d = new Date(now);
      d.setDate(now.getDate() + day);

      // Business hours: 9:00 AM to 5:00 PM (17:00)
      for (let hour = 9; hour < 17; hour++) {
        for (let minute of [0, 15, 30, 45]) {
          const slotDate = new Date(d);
          slotDate.setHours(hour, minute, 0, 0);

          // Only future slots
          if (slotDate.getTime() > now.getTime() + 15 * 60 * 1000) {
            slots.push(slotDate);
          }
        }
      }
    }
    return slots;
  };

  const slots = generateAppointmentSlots();

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setErrorMessage('Please enter your name.');
      return;
    }

    if (isAppointment && !appointmentTime) {
      setErrorMessage('Please select an appointment time slot.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const result = await joinQueue(code, {
        customer_name: customerName.trim(),
        phone: phone.trim() || null,
        priority_id: selectedPriorityId,
        is_appointment: isAppointment,
        appointment_time: isAppointment ? appointmentTime : null,
        notify_at: Number(notifyAt)
      });

      const token = result.token;
      // Save token in localStorage so status survives refresh
      try {
        const tokenInfo = {
          id: token.id,
          displayNumber: token.display_number,
          facilityCode: code,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem('queueease_last_token', JSON.stringify(tokenInfo));
      } catch (e) {
        // storage disabled
      }

      navigate(`/token/${token.id}`);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to join queue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container loading-page">
        <div className="spinner"></div>
        <p>Loading queue details...</p>
      </div>
    );
  }

  if (!facilityData || !facilityData.facility) {
    return (
      <div className="page-container error-page">
        <div className="error-card">
          <h2>Facility Not Found</h2>
          <p>We could not find any queue with code <strong>{code}</strong>.</p>
          <Link to="/" className="btn btn-primary">Return to Home</Link>
        </div>
      </div>
    );
  }

  const { facility, priorities, stats } = facilityData;
  const isPaused = facility.status === 'paused';

  // Calculate pre-join estimate
  const waitingCount = stats?.waitingCount || 0;
  const avgServiceTime = stats?.avgServiceMinutes || facility.default_service_minutes;
  const activeCounters = facility.active_counters || 1;
  const approxWait = waitingCount === 0
    ? '0-2 min'
    : `about ${Math.max(1, Math.round((waitingCount / activeCounters) * avgServiceTime))} min`;

  return (
    <div className="page-container join-page">
      <div className="join-card">
        {/* Facility Header */}
        <div className="facility-banner">
          <div className="facility-meta">
            <span className="type-badge">{facility.type}</span>
            <span className="code-pill">Code: {facility.code}</span>
          </div>
          <h2>{facility.name}</h2>

          {isPaused ? (
            <div className="pause-notice">
              ⚠️ <strong>Queue is temporarily paused:</strong> {facility.pause_reason || 'Staff break in progress'}
            </div>
          ) : (
            <div className="live-queue-preview">
              <div className="preview-stat">
                <span className="stat-label">Currently Waiting</span>
                <span className="stat-value">{waitingCount}</span>
              </div>
              <div className="preview-stat">
                <span className="stat-label">Active Counters</span>
                <span className="stat-value">{activeCounters}</span>
              </div>
              <div className="preview-stat highlight">
                <span className="stat-label">Estimated Wait</span>
                <span className="stat-value">{approxWait}</span>
              </div>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="alert alert-danger" role="alert">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="join-form">
          {/* Customer Name & Phone */}
          <div className="form-group">
            <label htmlFor="customer-name">Your Full Name *</label>
            <input
              id="customer-name"
              type="text"
              placeholder="e.g. Alex Morgan"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="customer-phone">Mobile Phone Number (Optional)</label>
            <input
              id="customer-phone"
              type="tel"
              placeholder="e.g. +1 555-0199"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <span className="field-hint">Note: Duplicate active tokens for the same phone are blocked.</span>
          </div>

          {/* Walk-in vs Appointment Switch */}
          <div className="form-group">
            <label>Service Type</label>
            <div className="toggle-segmented">
              <button
                type="button"
                className={`segment-btn ${!isAppointment ? 'active' : ''}`}
                onClick={() => setIsAppointment(false)}
              >
                🚶 Walk-in (Join Now)
              </button>
              <button
                type="button"
                className={`segment-btn ${isAppointment ? 'active' : ''}`}
                onClick={() => {
                  setIsAppointment(true);
                  // Auto-switch priority to Appointment if available
                  const apptP = priorities.find(p => p.prefix === 'A');
                  if (apptP) setSelectedPriorityId(apptP.id);
                }}
              >
                📅 Book Appointment
              </button>
            </div>
          </div>

          {/* Appointment Slot Picker */}
          {isAppointment && (
            <div className="form-group appt-picker-group">
              <label htmlFor="appointment-slot">Select 15-Minute Slot (Next 7 Days) *</label>
              <select
                id="appointment-slot"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                required={isAppointment}
              >
                <option value="">-- Choose an appointment slot --</option>
                {slots.map((slot) => {
                  const iso = slot.toISOString();
                  const label = slot.toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                  }) + ' at ' + slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <option key={iso} value={iso}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <span className="field-hint">
                You can self check-in from 15 minutes before your scheduled slot.
              </span>
            </div>
          )}

          {/* Priority Categories */}
          <div className="form-group">
            <label>Priority Category *</label>
            <div className="priority-cards-selector">
              {priorities.map((p) => {
                const isSelected = selectedPriorityId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPriorityId(p.id)}
                    className={`priority-select-card ${isSelected ? 'selected' : ''}`}
                    style={{ borderColor: isSelected ? p.color : undefined }}
                  >
                    <div className="priority-card-top">
                      <span
                        className="priority-prefix-badge"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.prefix}
                      </span>
                      <span className="priority-label">{p.label}</span>
                      <span className="priority-rank-tag">Rank {p.rank}</span>
                    </div>

                    {p.description && (
                      <p className="priority-desc">{p.description}</p>
                    )}

                    {p.needs_verification === 1 && (
                      <div className="verification-warning">
                        ⚠️ Carry proof, staff may change your priority
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Turn Notification Preference */}
          <div className="form-group">
            <label htmlFor="notify-at">Notify me in advance:</label>
            <select
              id="notify-at"
              value={notifyAt}
              onChange={(e) => setNotifyAt(e.target.value)}
            >
              <option value="1">When 1 person is ahead (Immediate next)</option>
              <option value="2">When 2 people are ahead</option>
              <option value="3">When 3 people are ahead (Recommended)</option>
              <option value="4">When 4 people are ahead</option>
              <option value="5">When 5 people are ahead</option>
            </select>
          </div>

          {/* Browser Notification Opt-In */}
          {notificationPermission !== 'granted' && (
            <div className="notification-permission-banner">
              <div>
                <strong>Enable browser turn notifications?</strong>
                <p className="text-muted">
                  Get notified with chime & vibration even when this tab is in the background.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRequestPermission}
                className="btn btn-sm btn-outline"
              >
                Allow Notifications
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary btn-lg btn-block"
          >
            {isSubmitting
              ? 'Securing your token...'
              : isAppointment
              ? 'Confirm Appointment Booking'
              : 'Get My Digital Token'}
          </button>
        </form>
      </div>
    </div>
  );
}
