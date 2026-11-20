import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { createFacility } from '../api.js';

const TYPE_OPTIONS = [
  'Clinic',
  'Therapist',
  'HR Desk',
  'Bank',
  'Government office',
  'Salon',
  'Other'
];

const INITIAL_PRIORITIES = [
  { rank: 1, prefix: 'E', label: 'Emergency', color: '#ef4444', needs_verification: true, description: 'Immediate medical / critical attention' },
  { rank: 2, prefix: 'S', label: 'Senior citizen / Disabled / Pregnant', color: '#f59e0b', needs_verification: true, description: 'Priority access for seniors, persons with disabilities, or pregnant individuals' },
  { rank: 3, prefix: 'A', label: 'Appointment', color: '#3b82f6', needs_verification: false, description: 'Pre-booked scheduled appointment' },
  { rank: 4, prefix: 'R', label: 'Regular', color: '#10b981', needs_verification: false, description: 'Standard walk-in customer' }
];

export default function CreateFacility() {
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState('Clinic');
  const [customType, setCustomType] = useState('');
  const [defaultServiceMinutes, setDefaultServiceMinutes] = useState(10);
  const [activeCounters, setActiveCounters] = useState(1);
  const [staffPin, setStaffPin] = useState('');
  const [agingMinutes, setAgingMinutes] = useState(20);
  const [graceMinutes, setGraceMinutes] = useState(3);
  const [priorities, setPriorities] = useState(INITIAL_PRIORITIES);

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const handlePriorityChange = (index, field, value) => {
    const updated = [...priorities];
    updated[index] = { ...updated[index], [field]: value };
    setPriorities(updated);
  };

  const handleAddPriority = () => {
    const nextRank = priorities.length + 1;
    setPriorities([
      ...priorities,
      {
        rank: nextRank,
        prefix: 'C',
        label: `Category ${nextRank}`,
        color: '#8b5cf6',
        needs_verification: false,
        description: 'Custom priority level'
      }
    ]);
  };

  const handleRemovePriority = (index) => {
    if (priorities.length <= 1) return;
    const updated = priorities.filter((_, i) => i !== index).map((p, idx) => ({
      ...p,
      rank: idx + 1
    }));
    setPriorities(updated);
  };

  const validate = () => {
    const errs = {};
    if (!name.trim()) errs.name = 'Facility name is required.';
    if (selectedType === 'Other' && !customType.trim()) {
      errs.type = 'Please specify your facility type.';
    }
    if (!staffPin || !/^\d{4}$/.test(staffPin.trim())) {
      errs.staffPin = 'Staff PIN must be exactly 4 digits.';
    }
    if (Number(defaultServiceMinutes) < 1) {
      errs.serviceMinutes = 'Service minutes must be at least 1 minute.';
    }
    if (Number(activeCounters) < 1) {
      errs.counters = 'Active counters must be at least 1.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const facilityType = selectedType === 'Other' ? customType.trim() : selectedType;
      const res = await createFacility({
        name: name.trim(),
        type: facilityType,
        default_service_minutes: Number(defaultServiceMinutes),
        active_counters: Number(activeCounters),
        staff_pin: staffPin.trim(),
        aging_minutes: Number(agingMinutes),
        no_show_grace_minutes: Number(graceMinutes),
        priorities: priorities.map(p => ({
          ...p,
          needs_verification: Boolean(p.needs_verification)
        }))
      });

      setCreatedResult(res);
    } catch (err) {
      setErrors({ form: err.message || 'Failed to create facility' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinUrl = createdResult
    ? `${window.location.origin}/join/${createdResult.facility.code}`
    : '';

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch (err) {
      console.warn('Copy failed', err);
    }
  };

  // SUCCESS STATE
  if (createdResult) {
    const { facility } = createdResult;
    return (
      <div className="page-container success-page">
        <div className="success-card">
          <div className="success-icon-badge">🎉</div>
          <h2>Queue Created Successfully!</h2>
          <p className="success-sub">
            Your facility <strong>{facility.name}</strong> is live and ready for customers.
          </p>

          <div className="code-display-box">
            <span className="code-label">FACILITY CODE</span>
            <div className="code-value">{facility.code}</div>
            <button
              onClick={() => copyToClipboard(facility.code, 'code')}
              className="btn btn-sm btn-outline"
            >
              {copiedCode ? '✓ Copied' : 'Copy Code'}
            </button>
          </div>

          <div className="qr-container">
            <h4>Customer Join QR Code</h4>
            <p className="text-muted">Place this on your front door, desk, or reception screen:</p>
            <div className="qr-box">
              <QRCodeSVG value={joinUrl} size={180} level="H" includeMargin={true} />
            </div>
            <div className="join-url-row">
              <input type="text" readOnly value={joinUrl} className="input-readonly" />
              <button
                onClick={() => copyToClipboard(joinUrl, 'link')}
                className="btn btn-secondary"
              >
                {copiedLink ? '✓ Copied' : 'Copy Link'}
              </button>
            </div>
          </div>

          <div className="next-steps-grid">
            <div className="step-card">
              <h4>1. Customer Access</h4>
              <p>Test joining your queue just like a customer would.</p>
              <Link to={`/join/${facility.code}`} className="btn btn-primary btn-block">
                Open Join Screen
              </Link>
            </div>

            <div className="step-card">
              <h4>2. Staff Dashboard</h4>
              <p>Call, start, complete tokens, and manage queues (PIN: {facility.staff_pin}).</p>
              <Link to={`/staff/${facility.code}`} className="btn btn-secondary btn-block">
                Open Staff Dashboard
              </Link>
            </div>

            <div className="step-card">
              <h4>3. TV Display Screen</h4>
              <p>Fullscreen display for wall monitors showing live turn calls.</p>
              <Link to={`/display/${facility.code}`} target="_blank" rel="noreferrer" className="btn btn-dark btn-block">
                Open Display Screen ↗
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // CREATION FORM
  return (
    <div className="page-container">
      <div className="form-card">
        <div className="form-header">
          <Link to="/" className="back-link">← Back</Link>
          <h2>Create a New Digital Queue</h2>
          <p className="text-muted">
            Configure your facility parameters, active counters, and priority hierarchy.
          </p>
        </div>

        {errors.form && <div className="alert alert-danger">{errors.form}</div>}

        <form onSubmit={handleSubmit}>
          {/* Facility Details */}
          <div className="form-section">
            <h3>1. Facility Details</h3>

            <div className="form-group">
              <label htmlFor="facility-name">Facility / Desk Name *</label>
              <input
                id="facility-name"
                type="text"
                placeholder="e.g. Apex Health Clinic, HR Consultation Desk, Metro Bank"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={errors.name ? 'input-error' : ''}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="facility-type">Facility Type *</label>
                <select
                  id="facility-type"
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {selectedType === 'Other' && (
                <div className="form-group">
                  <label htmlFor="custom-type">Specify Custom Type *</label>
                  <input
                    id="custom-type"
                    type="text"
                    placeholder="e.g. DMV Office, Legal Aid"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                    className={errors.type ? 'input-error' : ''}
                  />
                  {errors.type && <span className="field-error">{errors.type}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Service Parameters */}
          <div className="form-section">
            <h3>2. Counters & Queue Settings</h3>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="active-counters">Active Service Counters</label>
                <input
                  id="active-counters"
                  type="number"
                  min="1"
                  max="20"
                  value={activeCounters}
                  onChange={(e) => setActiveCounters(e.target.value)}
                />
                <span className="field-hint">Parallel service bays (Counter 1, Counter 2...)</span>
              </div>

              <div className="form-group">
                <label htmlFor="service-minutes">Default Service Time (minutes)</label>
                <input
                  id="service-minutes"
                  type="number"
                  min="1"
                  max="120"
                  value={defaultServiceMinutes}
                  onChange={(e) => setDefaultServiceMinutes(e.target.value)}
                />
                <span className="field-hint">Initial estimate before live data collects</span>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="aging-minutes">Priority Aging (minutes)</label>
                <input
                  id="aging-minutes"
                  type="number"
                  min="0"
                  max="120"
                  value={agingMinutes}
                  onChange={(e) => setAgingMinutes(e.target.value)}
                />
                <span className="field-hint">Wait time before regular tokens gain priority (0 = off)</span>
              </div>

              <div className="form-group">
                <label htmlFor="grace-minutes">No-Show Grace Period (minutes)</label>
                <input
                  id="grace-minutes"
                  type="number"
                  min="1"
                  max="30"
                  value={graceMinutes}
                  onChange={(e) => setGraceMinutes(e.target.value)}
                />
                <span className="field-hint">Wait time after 2nd recall before auto-marking No-Show</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="staff-pin">Staff Access PIN (4 digits) *</label>
              <input
                id="staff-pin"
                type="password"
                maxLength={4}
                placeholder="e.g. 1234"
                value={staffPin}
                onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, ''))}
                className={errors.staffPin ? 'input-error' : ''}
              />
              {errors.staffPin && <span className="field-error">{errors.staffPin}</span>}
              <span className="field-hint">Protects staff call & dashboard actions</span>
            </div>
          </div>

          {/* Priority Categories */}
          <div className="form-section">
            <div className="section-title-row">
              <div>
                <h3>3. Priority Categories</h3>
                <p className="text-muted">Rank 1 is always served first. Aging never overtakes Rank 1.</p>
              </div>
              <button
                type="button"
                onClick={handleAddPriority}
                className="btn btn-sm btn-outline"
              >
                + Add Category
              </button>
            </div>

            <div className="priorities-editor-list">
              {priorities.map((p, idx) => (
                <div key={idx} className="priority-edit-card">
                  <div className="priority-rank-badge">Rank {p.rank}</div>

                  <div className="priority-inputs-row">
                    <div className="input-p-prefix">
                      <label>Prefix</label>
                      <input
                        type="text"
                        maxLength={1}
                        value={p.prefix}
                        onChange={(e) => handlePriorityChange(idx, 'prefix', e.target.value.toUpperCase())}
                      />
                    </div>

                    <div className="input-p-label">
                      <label>Label</label>
                      <input
                        type="text"
                        value={p.label}
                        onChange={(e) => handlePriorityChange(idx, 'label', e.target.value)}
                      />
                    </div>

                    <div className="input-p-color">
                      <label>Color</label>
                      <input
                        type="color"
                        value={p.color}
                        onChange={(e) => handlePriorityChange(idx, 'color', e.target.value)}
                      />
                    </div>

                    <div className="input-p-verify">
                      <label>Proof Check</label>
                      <div className="checkbox-wrap">
                        <input
                          type="checkbox"
                          checked={Boolean(p.needs_verification)}
                          onChange={(e) => handlePriorityChange(idx, 'needs_verification', e.target.checked)}
                        />
                        <span>Requires Verification</span>
                      </div>
                    </div>

                    {priorities.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePriority(idx)}
                        className="btn-remove-priority"
                        title="Delete category"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="priority-desc-row">
                    <input
                      type="text"
                      placeholder="Category instructions/description displayed to customer"
                      value={p.description || ''}
                      onChange={(e) => handlePriorityChange(idx, 'description', e.target.value)}
                      className="input-subtle"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="form-submit-row">
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary btn-lg btn-block"
            >
              {isSubmitting ? 'Creating Facility...' : 'Launch Digital Queue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
