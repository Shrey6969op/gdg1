import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  db,
  createDefaultPriorities,
  getNextSequence,
  isValidTransition
} from './db.js';
import {
  calculateEffectiveRank,
  computeAppointmentEffectiveTime,
  canCheckInAppointment,
  orderWaitingTokens
} from './queue.js';
import {
  calculateAverageServiceMinutes,
  estimateWaitTime
} from './estimate.js';
import {
  setSocketIO,
  sendNotification
} from './notify.js';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH']
  }
});
setSocketIO(io);

app.use(cors());
app.use(express.json());

// Consistent error handler helper
function errorResponse(res, status, message) {
  return res.status(status).json({ error: message });
}

// ==========================================
// Queue State & Broadcasting Engine
// ==========================================

export function getFacilityQueueState(facilityId, now = new Date()) {
  const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facilityId);
  if (!facility) return null;

  const priorities = db.prepare('SELECT * FROM priority_levels WHERE facility_id = ? ORDER BY rank ASC').all(facilityId);
  const priorityMap = new Map(priorities.map(p => [p.id, p]));

  // All active or today's tokens
  const tokens = db.prepare(`
    SELECT t.*, p.label AS priority_label, p.rank AS priority_rank, p.prefix AS priority_prefix, p.color AS priority_color
    FROM tokens t
    JOIN priority_levels p ON t.priority_id = p.id
    WHERE t.facility_id = ?
    ORDER BY t.created_at ASC
  `).all(facilityId);

  const waitingTokens = tokens.filter(t => t.status === 'WAITING');
  const calledTokens = tokens.filter(t => t.status === 'CALLED');
  const servingTokens = tokens.filter(t => t.status === 'SERVING');
  const bookedTokens = tokens.filter(t => t.status === 'BOOKED');
  const completedTokens = tokens.filter(t => t.status === 'COMPLETED');
  const noShowTokens = tokens.filter(t => t.status === 'NO_SHOW');

  // Order waiting tokens dynamically
  const orderedWaiting = orderWaitingTokens(waitingTokens, facility.aging_minutes, now);

  // Compute average service minutes from completed tokens today
  const todayStr = now.toISOString().slice(0, 10);
  const todayCompleted = completedTokens.filter(t => (t.completed_at || '').slice(0, 10) === todayStr);
  const avgServiceMinutes = calculateAverageServiceMinutes(todayCompleted, facility.default_service_minutes);

  const busyCount = calledTokens.length + servingTokens.length;

  // Add position, peopleAhead, wait estimate to each waiting token
  const enrichedWaiting = orderedWaiting.map((token, index) => {
    const position = index + 1;
    const peopleAhead = index;
    const waitEstimate = estimateWaitTime({
      waitingAheadCount: peopleAhead,
      busyCount,
      activeCounters: facility.active_counters,
      avgServiceMinutes,
      isPaused: facility.status === 'paused',
      currentTime: now
    });

    return {
      ...token,
      position,
      peopleAhead,
      waitEstimate
    };
  });

  return {
    facility,
    priorities,
    stats: {
      waitingCount: orderedWaiting.length,
      bookedCount: bookedTokens.length,
      servingCount: servingTokens.length,
      calledCount: calledTokens.length,
      servedTodayCount: todayCompleted.length,
      noShowTodayCount: noShowTokens.filter(t => (t.called_at || t.created_at || '').slice(0, 10) === todayStr).length,
      avgServiceMinutes,
      activeCounters: facility.active_counters
    },
    waitingTokens: enrichedWaiting,
    calledTokens,
    servingTokens,
    bookedTokens
  };
}

// Broadcasts updates to facility room and updates token rooms
export function broadcastQueueUpdate(facilityId) {
  const state = getFacilityQueueState(facilityId);
  if (!state) return;

  const { facility, priorities, stats, waitingTokens, calledTokens, servingTokens, bookedTokens } = state;

  // Emit to facility room (used by staff dashboard and public display)
  io.to(`facility:${facilityId}`).emit('queue:update', {
    facility,
    priorities,
    stats,
    waitingTokens,
    calledTokens,
    servingTokens,
    bookedTokens,
    timestamp: new Date().toISOString()
  });

  // Check near notifications for waiting tokens and broadcast to individual token rooms
  for (const token of waitingTokens) {
    // Near notification trigger: position <= notify_at (and near_notified = 0)
    if (token.position <= token.notify_at && token.near_notified === 0) {
      db.prepare('UPDATE tokens SET near_notified = 1 WHERE id = ?').run(token.id);
      token.near_notified = 1;
      const aheadMsg = token.peopleAhead === 0 ? 'You are next in line!' : `Only ${token.peopleAhead} person(s) ahead of you.`;
      sendNotification(token, 'NEAR', `Your turn is approaching! ${aheadMsg}`);
    }

    io.to(`token:${token.id}`).emit('token:update', {
      token,
      facility,
      position: token.position,
      peopleAhead: token.peopleAhead,
      waitEstimate: token.waitEstimate,
      servingTokens
    });
  }

  // Also push token:update to called, serving, and booked tokens
  const nonWaitingActive = [...calledTokens, ...servingTokens, ...bookedTokens];
  for (const token of nonWaitingActive) {
    io.to(`token:${token.id}`).emit('token:update', {
      token,
      facility,
      position: null,
      peopleAhead: null,
      waitEstimate: {
        isPaused: facility.status === 'paused',
        displayText: token.status === 'CALLED' ? `Proceed to Counter ${token.counter_no}` : token.status
      },
      servingTokens
    });
  }
}

// ==========================================
// Background No-Show Job (runs every 15s)
let noShowInterval = null;
if (process.env.NODE_ENV !== 'test') {
  noShowInterval = setInterval(() => {
  try {
    const nowMs = Date.now();
    // Query all CALLED tokens that have had at least 2 calls
    const candidates = db.prepare(`
      SELECT t.*, f.no_show_grace_minutes
      FROM tokens t
      JOIN facilities f ON t.facility_id = f.id
      WHERE t.status = 'CALLED' AND t.call_count >= 2
    `).all();

    const affectedFacilityIds = new Set();

    for (const token of candidates) {
      if (!token.called_at) continue;
      const calledMs = new Date(token.called_at).getTime();
      const graceMs = (token.no_show_grace_minutes || 3) * 60 * 1000;

      if (nowMs - calledMs > graceMs) {
        db.prepare(`UPDATE tokens SET status = 'NO_SHOW' WHERE id = ?`).run(token.id);
        sendNotification(token, 'NO_SHOW', 'You were marked as No-Show after final call grace period expired. You can rejoin once today.');
        affectedFacilityIds.add(token.facility_id);
      }
    }

    for (const facilityId of affectedFacilityIds) {
      broadcastQueueUpdate(facilityId);
    }
  } catch (err) {
    console.error('Error in background no-show job:', err);
  }
}, 15000);
}

// ==========================================
// Middleware: Staff PIN Verification
// ==========================================

function verifyStaffPin(req, res, next) {
  const { code } = req.params;
  const pin = req.headers['x-staff-pin'] || req.body.staff_pin;

  if (!pin) {
    return errorResponse(res, 401, 'Staff PIN required in x-staff-pin header.');
  }

  const facility = db.prepare('SELECT * FROM facilities WHERE code = ?').get(code);
  if (!facility) {
    return errorResponse(res, 404, 'Facility not found.');
  }

  if (String(facility.staff_pin).trim() !== String(pin).trim()) {
    return errorResponse(res, 403, 'Invalid staff PIN.');
  }

  req.facility = facility;
  next();
}

// ==========================================
// REST API ROUTES
// ==========================================

// 1. Facility Creation
app.post('/api/facilities', (req, res) => {
  try {
    const {
      name,
      type,
      default_service_minutes = 10,
      active_counters = 1,
      staff_pin,
      aging_minutes = 20,
      no_show_grace_minutes = 3,
      priorities
    } = req.body;

    if (!name || !name.trim()) {
      return errorResponse(res, 400, 'Facility name is required.');
    }
    if (!type || !type.trim()) {
      return errorResponse(res, 400, 'Facility type is required.');
    }
    if (!staff_pin || !/^\d{4}$/.test(String(staff_pin).trim())) {
      return errorResponse(res, 400, 'Staff PIN must be exactly 4 digits.');
    }

    // Generate unique 6-character code
    let code = '';
    let exists = true;
    while (exists) {
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const existing = db.prepare('SELECT id FROM facilities WHERE code = ?').get(code);
      if (!existing) exists = false;
    }

    const facilityId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const insertTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO facilities (
          id, code, name, type, default_service_minutes, active_counters,
          status, staff_pin, aging_minutes, no_show_grace_minutes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
      `).run(
        facilityId,
        code,
        name.trim(),
        type.trim(),
        Math.max(1, Number(default_service_minutes) || 10),
        Math.max(1, Number(active_counters) || 1),
        String(staff_pin).trim(),
        Number(aging_minutes) >= 0 ? Number(aging_minutes) : 20,
        Math.max(1, Number(no_show_grace_minutes) || 3),
        createdAt
      );

      if (Array.isArray(priorities) && priorities.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO priority_levels (facility_id, label, rank, prefix, color, needs_verification, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of priorities) {
          stmt.run(
            facilityId,
            p.label.trim(),
            Number(p.rank),
            p.prefix.trim().toUpperCase().slice(0, 1),
            p.color || '#3b82f6',
            p.needs_verification ? 1 : 0,
            p.description || ''
          );
        }
      } else {
        createDefaultPriorities(facilityId);
      }
    });

    insertTx();

    const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facilityId);
    const createdPriorities = db.prepare('SELECT * FROM priority_levels WHERE facility_id = ? ORDER BY rank ASC').all(facilityId);

    return res.status(201).json({ facility, priorities: createdPriorities });
  } catch (err) {
    console.error('Error creating facility:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 2. List Facilities (with summary)
app.get('/api/facilities', (req, res) => {
  try {
    const facilities = db.prepare('SELECT id, code, name, type, status, active_counters, default_service_minutes, created_at FROM facilities ORDER BY created_at DESC').all();

    const result = facilities.map(fac => {
      const waitingCount = db.prepare(`SELECT COUNT(*) AS count FROM tokens WHERE facility_id = ? AND status = 'WAITING'`).get(fac.id).count;
      const servingCount = db.prepare(`SELECT COUNT(*) AS count FROM tokens WHERE facility_id = ? AND status = 'SERVING'`).get(fac.id).count;
      return {
        ...fac,
        waitingCount,
        servingCount
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('Error fetching facilities:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 3. Get Facility by Code
app.get('/api/facilities/:code', (req, res) => {
  try {
    const { code } = req.params;
    const facility = db.prepare('SELECT * FROM facilities WHERE code = ?').get(code.toUpperCase());
    if (!facility) {
      return errorResponse(res, 404, 'Facility not found.');
    }

    const state = getFacilityQueueState(facility.id);
    return res.json(state);
  } catch (err) {
    console.error('Error fetching facility by code:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 4. Update Facility (Staff)
app.patch('/api/facilities/:code', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const {
      name,
      type,
      default_service_minutes,
      active_counters,
      aging_minutes,
      no_show_grace_minutes,
      priorities
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (type !== undefined) {
      updates.push('type = ?');
      params.push(type.trim());
    }
    if (default_service_minutes !== undefined) {
      updates.push('default_service_minutes = ?');
      params.push(Math.max(1, Number(default_service_minutes)));
    }
    if (active_counters !== undefined) {
      updates.push('active_counters = ?');
      params.push(Math.max(1, Number(active_counters)));
    }
    if (aging_minutes !== undefined) {
      updates.push('aging_minutes = ?');
      params.push(Math.max(0, Number(aging_minutes)));
    }
    if (no_show_grace_minutes !== undefined) {
      updates.push('no_show_grace_minutes = ?');
      params.push(Math.max(1, Number(no_show_grace_minutes)));
    }

    if (updates.length > 0) {
      params.push(facility.id);
      db.prepare(`UPDATE facilities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    // Optional priority update
    if (Array.isArray(priorities) && priorities.length > 0) {
      const updatePriorityTx = db.transaction(() => {
        db.prepare('DELETE FROM priority_levels WHERE facility_id = ?').run(facility.id);
        const insertStmt = db.prepare(`
          INSERT INTO priority_levels (facility_id, label, rank, prefix, color, needs_verification, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of priorities) {
          insertStmt.run(
            facility.id,
            p.label.trim(),
            Number(p.rank),
            p.prefix.trim().toUpperCase().slice(0, 1),
            p.color || '#3b82f6',
            p.needs_verification ? 1 : 0,
            p.description || ''
          );
        }
      });
      updatePriorityTx();
    }

    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facility.id);
    return res.json({ facility: updated });
  } catch (err) {
    console.error('Error updating facility:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 5. Customer Join Queue
app.post('/api/facilities/:code/tokens', (req, res) => {
  try {
    const { code } = req.params;
    const facility = db.prepare('SELECT * FROM facilities WHERE code = ?').get(code.toUpperCase());
    if (!facility) {
      return errorResponse(res, 404, 'Facility not found.');
    }

    const {
      customer_name,
      phone,
      priority_id,
      is_appointment = false,
      appointment_time,
      notify_at = 3
    } = req.body;

    if (!customer_name || !customer_name.trim()) {
      return errorResponse(res, 400, 'Customer name is required.');
    }

    // Duplicate active token check for the same phone in this facility
    const cleanPhone = phone ? phone.trim() : null;
    if (cleanPhone) {
      const activeExisting = db.prepare(`
        SELECT id, display_number, status
        FROM tokens
        WHERE facility_id = ?
          AND phone = ?
          AND status IN ('BOOKED', 'WAITING', 'CALLED', 'SERVING')
      `).get(facility.id, cleanPhone);

      if (activeExisting) {
        return errorResponse(
          res,
          409,
          `An active token (${activeExisting.display_number}) already exists for this phone number at this facility.`
        );
      }
    }

    // Priority verification
    const priority = db.prepare('SELECT * FROM priority_levels WHERE id = ? AND facility_id = ?').get(priority_id, facility.id);
    if (!priority) {
      return errorResponse(res, 400, 'Invalid priority category selected.');
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Sequence & display number generation
    const { seq, displayNumber } = getNextSequence(facility.id, priority.prefix, nowIso);
    const tokenId = crypto.randomUUID();

    const isAppt = Boolean(is_appointment && appointment_time);
    let initialStatus = isAppt ? 'BOOKED' : 'WAITING';
    let effectiveTime = isAppt ? new Date(appointment_time).toISOString() : nowIso;

    db.prepare(`
      INSERT INTO tokens (
        id, facility_id, priority_id, display_number, seq, customer_name, phone,
        is_appointment, appointment_time, effective_time, status, notify_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tokenId,
      facility.id,
      priority.id,
      displayNumber,
      seq,
      customer_name.trim(),
      cleanPhone,
      isAppt ? 1 : 0,
      isAppt ? new Date(appointment_time).toISOString() : null,
      effectiveTime,
      initialStatus,
      Math.min(5, Math.max(1, Number(notify_at) || 3)),
      nowIso
    );

    broadcastQueueUpdate(facility.id);

    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
    return res.status(201).json({ token });
  } catch (err) {
    console.error('Error joining queue:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 6. Get Token Status (Used by /token/:id)
app.get('/api/tokens/:id', (req, res) => {
  try {
    const { id } = req.params;
    const token = db.prepare(`
      SELECT t.*, p.label AS priority_label, p.rank AS priority_rank, p.prefix AS priority_prefix, p.color AS priority_color, p.description AS priority_description
      FROM tokens t
      JOIN priority_levels p ON t.priority_id = p.id
      WHERE t.id = ?
    `).get(id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }

    const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(token.facility_id);
    const state = getFacilityQueueState(token.facility_id);

    // If waiting, find position in ordered list
    let position = null;
    let peopleAhead = null;
    let waitEstimate = null;

    if (token.status === 'WAITING' && state) {
      const matchIndex = state.waitingTokens.findIndex(t => t.id === token.id);
      if (matchIndex !== -1) {
        position = matchIndex + 1;
        peopleAhead = matchIndex;
        waitEstimate = state.waitingTokens[matchIndex].waitEstimate;
      }
    } else {
      waitEstimate = {
        isPaused: facility.status === 'paused',
        displayText: token.status === 'CALLED' ? `Proceed to Counter ${token.counter_no}` : token.status
      };
    }

    return res.json({
      token,
      facility,
      position,
      peopleAhead,
      waitEstimate,
      servingTokens: state ? state.servingTokens : []
    });
  } catch (err) {
    console.error('Error fetching token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 7. Customer Appointment Check-In ("I've arrived")
app.post('/api/tokens/:id/checkin', (req, res) => {
  try {
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }

    if (token.status !== 'BOOKED') {
      return errorResponse(res, 400, `Cannot check in token with status "${token.status}".`);
    }

    if (!token.appointment_time) {
      return errorResponse(res, 400, 'This token is not an appointment.');
    }

    const now = new Date();
    if (!canCheckInAppointment(token.appointment_time, now)) {
      return errorResponse(res, 400, 'Self check-in is only available starting 15 minutes before your scheduled appointment.');
    }

    const effectiveTime = computeAppointmentEffectiveTime(token.appointment_time, now);

    db.prepare(`
      UPDATE tokens
      SET status = 'WAITING', checked_in_at = ?, effective_time = ?
      WHERE id = ?
    `).run(now.toISOString(), effectiveTime, token.id);

    broadcastQueueUpdate(token.facility_id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error checking in token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 8. Customer Cancel Token
app.post('/api/tokens/:id/cancel', (req, res) => {
  try {
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }

    if (!isValidTransition(token.status, 'CANCELLED')) {
      return errorResponse(res, 400, `Cannot cancel token with status "${token.status}".`);
    }

    db.prepare(`UPDATE tokens SET status = 'CANCELLED' WHERE id = ?`).run(token.id);

    broadcastQueueUpdate(token.facility_id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error cancelling token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// 9. Rejoin Queue (NO_SHOW customer, allowed once per day)
app.post('/api/tokens/:id/rejoin', (req, res) => {
  try {
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(id);
    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }

    if (token.status !== 'NO_SHOW') {
      return errorResponse(res, 400, 'Only no-show tokens can rejoin the queue.');
    }

    if (token.rejoined === 1) {
      return errorResponse(res, 400, 'You have already rejoined the queue today. Only one rejoin is allowed per day.');
    }

    const priority = db.prepare('SELECT * FROM priority_levels WHERE id = ?').get(token.priority_id);
    const nowIso = new Date().toISOString();
    const { seq, displayNumber } = getNextSequence(token.facility_id, priority.prefix, nowIso);
    const newTokenId = crypto.randomUUID();

    const rejoinTx = db.transaction(() => {
      // Mark old token rejoined
      db.prepare('UPDATE tokens SET rejoined = 1 WHERE id = ?').run(token.id);

      // Create new token
      db.prepare(`
        INSERT INTO tokens (
          id, facility_id, priority_id, display_number, seq, customer_name, phone,
          is_appointment, appointment_time, effective_time, status, notify_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'WAITING', ?, ?)
      `).run(
        newTokenId,
        token.facility_id,
        token.priority_id,
        displayNumber,
        seq,
        token.customer_name,
        token.phone,
        nowIso,
        token.notify_at || 3,
        nowIso
      );
    });

    rejoinTx();

    broadcastQueueUpdate(token.facility_id);
    const newToken = db.prepare('SELECT * FROM tokens WHERE id = ?').get(newTokenId);
    return res.json({ success: true, newToken });
  } catch (err) {
    console.error('Error rejoining queue:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// ==========================================
// STAFF ROUTES (Protected by PIN)
// ==========================================

// Staff: Call Next Token (Transaction protected against concurrent staff clicks)
app.post('/api/staff/:code/call-next', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { counter_no = 1 } = req.body;
    const counterNum = Math.max(1, Number(counter_no) || 1);
    const nowIso = new Date().toISOString();

    let calledToken = null;

    // Concurrency safe transaction with IMMEDIATE lock
    const callTx = db.transaction(() => {
      // Fetch all waiting tokens
      const waitingTokens = db.prepare(`
        SELECT t.*, p.rank AS priority_rank, p.prefix AS priority_prefix
        FROM tokens t
        JOIN priority_levels p ON t.priority_id = p.id
        WHERE t.facility_id = ? AND t.status = 'WAITING'
      `).all(facility.id);

      if (waitingTokens.length === 0) {
        return null;
      }

      // Dynamic sorting
      const ordered = orderWaitingTokens(waitingTokens, facility.aging_minutes, new Date());
      const nextToken = ordered[0];

      // Atomic update
      const updateResult = db.prepare(`
        UPDATE tokens
        SET status = 'CALLED',
            counter_no = ?,
            called_at = ?,
            call_count = call_count + 1
        WHERE id = ? AND status = 'WAITING'
      `).run(counterNum, nowIso, nextToken.id);

      if (updateResult.changes === 0) {
        // Race condition: another staff called this token just now
        return null;
      }

      return db.prepare('SELECT * FROM tokens WHERE id = ?').get(nextToken.id);
    });

    calledToken = callTx();

    if (!calledToken) {
      return errorResponse(res, 404, 'No waiting customers in queue.');
    }

    sendNotification(calledToken, 'CALLED', `Your turn! Please proceed to Counter ${counterNum}.`, { counterNo: counterNum });
    broadcastQueueUpdate(facility.id);

    return res.json({ success: true, token: calledToken });
  } catch (err) {
    console.error('Error calling next token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Recall a CALLED token (Max 2 recalls / 3 total calls)
app.post('/api/staff/:code/tokens/:id/recall', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (token.status !== 'CALLED') {
      return errorResponse(res, 400, 'Only CALLED tokens can be recalled.');
    }
    if (token.call_count >= 3) {
      return errorResponse(res, 400, 'Maximum 2 recalls reached for this customer.');
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE tokens
      SET call_count = call_count + 1, called_at = ?
      WHERE id = ?
    `).run(nowIso, token.id);

    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    sendNotification(updated, 'RECALLED', `Reminder: Please proceed to Counter ${token.counter_no}! (Call ${updated.call_count})`, { counterNo: token.counter_no });
    broadcastQueueUpdate(facility.id);

    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error recalling token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Start Serving (CALLED -> SERVING)
app.post('/api/staff/:code/tokens/:id/start', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (!isValidTransition(token.status, 'SERVING')) {
      return errorResponse(res, 400, `Cannot transition from ${token.status} to SERVING.`);
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE tokens
      SET status = 'SERVING', started_at = ?
      WHERE id = ?
    `).run(nowIso, token.id);

    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error starting service:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Complete Service (SERVING -> COMPLETED)
app.post('/api/staff/:code/tokens/:id/complete', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (!isValidTransition(token.status, 'COMPLETED')) {
      return errorResponse(res, 400, `Cannot transition from ${token.status} to COMPLETED.`);
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE tokens
      SET status = 'COMPLETED', completed_at = ?
      WHERE id = ?
    `).run(nowIso, token.id);

    sendNotification(token, 'COMPLETED', 'Thank you! Your service has been completed.');
    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error completing service:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Mark No-Show (CALLED -> NO_SHOW)
app.post('/api/staff/:code/tokens/:id/no-show', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (!isValidTransition(token.status, 'NO_SHOW')) {
      return errorResponse(res, 400, `Cannot transition from ${token.status} to NO_SHOW.`);
    }

    db.prepare(`UPDATE tokens SET status = 'NO_SHOW' WHERE id = ?`).run(token.id);

    sendNotification(token, 'NO_SHOW', 'You were marked as No-Show. You may rejoin the queue once today.');
    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error marking no-show:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Change Priority (with 1 tap)
app.post('/api/staff/:code/tokens/:id/priority', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const { priority_id } = req.body;

    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);
    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }

    const priority = db.prepare('SELECT * FROM priority_levels WHERE id = ? AND facility_id = ?').get(priority_id, facility.id);
    if (!priority) {
      return errorResponse(res, 400, 'Invalid priority category.');
    }

    db.prepare('UPDATE tokens SET priority_id = ? WHERE id = ?').run(priority.id, token.id);

    sendNotification(token, 'PRIORITY_CHANGED', `Your priority category was updated to "${priority.label}" by staff.`);
    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error changing token priority:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Cancel Token
app.post('/api/staff/:code/tokens/:id/cancel', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (!isValidTransition(token.status, 'CANCELLED')) {
      return errorResponse(res, 400, `Cannot cancel token with status "${token.status}".`);
    }

    db.prepare(`UPDATE tokens SET status = 'CANCELLED' WHERE id = ?`).run(token.id);

    sendNotification(token, 'CANCELLED', 'Your token was cancelled by facility staff.');
    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error staff cancelling token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Check In Appointment
app.post('/api/staff/:code/tokens/:id/checkin', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { id } = req.params;
    const token = db.prepare('SELECT * FROM tokens WHERE id = ? AND facility_id = ?').get(id, facility.id);

    if (!token) {
      return errorResponse(res, 404, 'Token not found.');
    }
    if (token.status !== 'BOOKED') {
      return errorResponse(res, 400, `Cannot check in token with status "${token.status}".`);
    }

    const now = new Date();
    const effectiveTime = token.appointment_time
      ? computeAppointmentEffectiveTime(token.appointment_time, now)
      : now.toISOString();

    db.prepare(`
      UPDATE tokens
      SET status = 'WAITING', checked_in_at = ?, effective_time = ?
      WHERE id = ?
    `).run(now.toISOString(), effectiveTime, token.id);

    sendNotification(token, 'CHECKED_IN', 'Your appointment has been checked in by staff.');
    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(token.id);
    return res.json({ success: true, token: updated });
  } catch (err) {
    console.error('Error staff checking in token:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Add Manual Walk-In Customer
app.post('/api/staff/:code/walk-in', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { customer_name, phone, priority_id, notify_at = 3 } = req.body;

    if (!customer_name || !customer_name.trim()) {
      return errorResponse(res, 400, 'Customer name is required.');
    }

    const cleanPhone = phone ? phone.trim() : null;
    if (cleanPhone) {
      const activeExisting = db.prepare(`
        SELECT id, display_number FROM tokens
        WHERE facility_id = ? AND phone = ? AND status IN ('BOOKED', 'WAITING', 'CALLED', 'SERVING')
      `).get(facility.id, cleanPhone);

      if (activeExisting) {
        return errorResponse(res, 409, `An active token (${activeExisting.display_number}) already exists for this phone number.`);
      }
    }

    const priority = db.prepare('SELECT * FROM priority_levels WHERE id = ? AND facility_id = ?').get(priority_id, facility.id);
    if (!priority) {
      return errorResponse(res, 400, 'Invalid priority category.');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const { seq, displayNumber } = getNextSequence(facility.id, priority.prefix, nowIso);
    const tokenId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tokens (
        id, facility_id, priority_id, display_number, seq, customer_name, phone,
        is_appointment, appointment_time, effective_time, status, notify_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'WAITING', ?, ?)
    `).run(
      tokenId,
      facility.id,
      priority.id,
      displayNumber,
      seq,
      customer_name.trim(),
      cleanPhone,
      nowIso,
      Math.min(5, Math.max(1, Number(notify_at) || 3)),
      nowIso
    );

    broadcastQueueUpdate(facility.id);
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
    return res.status(201).json({ success: true, token });
  } catch (err) {
    console.error('Error adding walk-in customer:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Pause Queue
app.post('/api/staff/:code/pause', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { reason = 'Temporary pause' } = req.body;

    db.prepare(`
      UPDATE facilities
      SET status = 'paused', pause_reason = ?
      WHERE id = ?
    `).run(reason.trim(), facility.id);

    // Notify waiting customers
    const waitingTokens = db.prepare(`SELECT * FROM tokens WHERE facility_id = ? AND status = 'WAITING'`).all(facility.id);
    for (const token of waitingTokens) {
      sendNotification(token, 'PAUSED', `Queue paused: ${reason}`);
    }

    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facility.id);
    return res.json({ success: true, facility: updated });
  } catch (err) {
    console.error('Error pausing queue:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Resume Queue
app.post('/api/staff/:code/resume', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;

    db.prepare(`
      UPDATE facilities
      SET status = 'open', pause_reason = NULL
      WHERE id = ?
    `).run(facility.id);

    // Notify waiting customers
    const waitingTokens = db.prepare(`SELECT * FROM tokens WHERE facility_id = ? AND status = 'WAITING'`).all(facility.id);
    for (const token of waitingTokens) {
      sendNotification(token, 'RESUMED', 'Queue has resumed normal operations.');
    }

    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facility.id);
    return res.json({ success: true, facility: updated });
  } catch (err) {
    console.error('Error resuming queue:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Change Active Counters
app.post('/api/staff/:code/counters', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const { active_counters } = req.body;
    const count = Math.max(1, Number(active_counters) || 1);

    db.prepare('UPDATE facilities SET active_counters = ? WHERE id = ?').run(count, facility.id);

    broadcastQueueUpdate(facility.id);
    const updated = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facility.id);
    return res.json({ success: true, facility: updated });
  } catch (err) {
    console.error('Error updating active counters:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Reset Day
app.post('/api/staff/:code/reset-day', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;

    db.prepare(`
      UPDATE tokens
      SET status = 'CANCELLED'
      WHERE facility_id = ? AND status IN ('BOOKED', 'WAITING', 'CALLED', 'SERVING')
    `).run(facility.id);

    broadcastQueueUpdate(facility.id);
    return res.json({ success: true, message: 'All active tokens cancelled. Day reset completed.' });
  } catch (err) {
    console.error('Error resetting day:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// Staff: Simulate 5 Customers
app.post('/api/staff/:code/simulate', verifyStaffPin, (req, res) => {
  try {
    const facility = req.facility;
    const priorities = db.prepare('SELECT * FROM priority_levels WHERE facility_id = ? ORDER BY rank ASC').all(facility.id);
    if (priorities.length === 0) {
      return errorResponse(res, 400, 'No priority levels configured.');
    }

    const emergency = priorities.find(p => p.rank === 1) || priorities[0];
    const senior = priorities.find(p => p.rank === 2) || priorities[0];
    const appointment = priorities.find(p => p.rank === 3) || priorities[priorities.length - 1];
    const regular = priorities.find(p => p.rank === 4) || priorities[priorities.length - 1];

    const demoCustomers = [
      { name: 'Dr. Jane Bennett (Urgent)', priority: emergency, isAppt: false },
      { name: 'Arthur Pendelton (Senior 78yo)', priority: senior, isAppt: false },
      { name: 'Maya Lin (Appt 10:30)', priority: appointment, isAppt: true, offsetMinutes: 5 },
      { name: 'Carlos Gomez (Regular)', priority: regular, isAppt: false },
      { name: 'Amina Yusuf (Regular)', priority: regular, isAppt: false }
    ];

    const now = new Date();
    const createdTokens = [];

    const simTx = db.transaction(() => {
      demoCustomers.forEach((cust, idx) => {
        const arrivalDate = new Date(now.getTime() - (idx * 3) * 60 * 1000);
        const arrivalIso = arrivalDate.toISOString();
        const { seq, displayNumber } = getNextSequence(facility.id, cust.priority.prefix, arrivalIso);
        const tokenId = crypto.randomUUID();

        let status = 'WAITING';
        let apptTime = null;
        let effectiveTime = arrivalIso;

        if (cust.isAppt) {
          // Scheduled 5 min from now, already checked in
          apptTime = new Date(now.getTime() + cust.offsetMinutes * 60 * 1000).toISOString();
          effectiveTime = apptTime;
        }

        db.prepare(`
          INSERT INTO tokens (
            id, facility_id, priority_id, display_number, seq, customer_name, phone,
            is_appointment, appointment_time, effective_time, status, notify_at, created_at, checked_in_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tokenId,
          facility.id,
          cust.priority.id,
          displayNumber,
          seq,
          cust.name,
          `+1-555-010${idx + 1}`,
          cust.isAppt ? 1 : 0,
          apptTime,
          effectiveTime,
          status,
          3,
          arrivalIso,
          cust.isAppt ? arrivalIso : null
        );

        createdTokens.push(db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId));
      });
    });

    simTx();

    broadcastQueueUpdate(facility.id);
    return res.json({ success: true, count: createdTokens.length, tokens: createdTokens });
  } catch (err) {
    console.error('Error simulating customers:', err);
    return errorResponse(res, 500, err.message || 'Internal server error');
  }
});

// ==========================================
// Socket.IO Room Subscriptions
// ==========================================

io.on('connection', (socket) => {
  // Join facility room
  socket.on('join:facility', (facilityId) => {
    if (facilityId) {
      socket.join(`facility:${facilityId}`);
      // Send initial snapshot immediately
      const state = getFacilityQueueState(facilityId);
      if (state) {
        socket.emit('queue:update', {
          ...state,
          timestamp: new Date().toISOString()
        });
      }
    }
  });

  socket.on('leave:facility', (facilityId) => {
    if (facilityId) {
      socket.leave(`facility:${facilityId}`);
    }
  });

  // Join individual token room
  socket.on('join:token', (tokenId) => {
    if (tokenId) {
      socket.join(`token:${tokenId}`);
      const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
      if (token) {
        const facility = db.prepare('SELECT * FROM facilities WHERE id = ?').get(token.facility_id);
        const state = getFacilityQueueState(token.facility_id);
        let position = null;
        let peopleAhead = null;
        let waitEstimate = null;

        if (token.status === 'WAITING' && state) {
          const matchIndex = state.waitingTokens.findIndex(t => t.id === token.id);
          if (matchIndex !== -1) {
            position = matchIndex + 1;
            peopleAhead = matchIndex;
            waitEstimate = state.waitingTokens[matchIndex].waitEstimate;
          }
        } else {
          waitEstimate = {
            isPaused: facility?.status === 'paused',
            displayText: token.status === 'CALLED' ? `Proceed to Counter ${token.counter_no}` : token.status
          };
        }

        socket.emit('token:update', {
          token,
          facility,
          position,
          peopleAhead,
          waitEstimate,
          servingTokens: state ? state.servingTokens : []
        });
      }
    }
  });

  socket.on('leave:token', (tokenId) => {
    if (tokenId) {
      socket.leave(`token:${tokenId}`);
    }
  });
});

// Serve frontend build if available (zero-proxy single-origin support)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

export { app, server, io };

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`QueueEase server running on http://127.0.0.1:${PORT}`);
  });
}
