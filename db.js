import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.NODE_ENV === 'test' && process.env.TEST_DB_PATH
  ? process.env.TEST_DB_PATH
  : path.join(__dirname, 'queueease.db');

export const db = new Database(dbPath);

// Enable WAL mode & foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema initialization
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      default_service_minutes INTEGER NOT NULL DEFAULT 10,
      active_counters INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'paused'
      pause_reason TEXT,
      staff_pin TEXT NOT NULL,
      aging_minutes INTEGER NOT NULL DEFAULT 20,
      no_show_grace_minutes INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS priority_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      label TEXT NOT NULL,
      rank INTEGER NOT NULL,
      prefix TEXT NOT NULL,
      color TEXT NOT NULL,
      needs_verification INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL,
      priority_id INTEGER NOT NULL,
      display_number TEXT NOT NULL,
      seq INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT,
      is_appointment INTEGER NOT NULL DEFAULT 0,
      appointment_time TEXT,
      effective_time TEXT NOT NULL,
      status TEXT NOT NULL, -- BOOKED, WAITING, CALLED, SERVING, COMPLETED, NO_SHOW, CANCELLED
      counter_no INTEGER,
      call_count INTEGER NOT NULL DEFAULT 0,
      notify_at INTEGER NOT NULL DEFAULT 3,
      near_notified INTEGER NOT NULL DEFAULT 0,
      rejoined INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      checked_in_at TEXT,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
      FOREIGN KEY (priority_id) REFERENCES priority_levels(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_facility_status ON tokens(facility_id, status);
    CREATE INDEX IF NOT EXISTS idx_tokens_facility_created ON tokens(facility_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tokens_phone ON tokens(phone);
  `);
}

// Auto-run schema init
initSchema();

export const DEFAULT_PRIORITIES = [
  { rank: 1, prefix: 'E', label: 'Emergency', color: '#ef4444', needs_verification: 1, description: 'Immediate medical / critical attention' },
  { rank: 2, prefix: 'S', label: 'Senior citizen / Disabled / Pregnant', color: '#f59e0b', needs_verification: 1, description: 'Priority access for seniors, persons with disabilities, or pregnant individuals' },
  { rank: 3, prefix: 'A', label: 'Appointment', color: '#3b82f6', needs_verification: 0, description: 'Pre-booked scheduled appointment' },
  { rank: 4, prefix: 'R', label: 'Regular', color: '#10b981', needs_verification: 0, description: 'Standard walk-in customer' }
];

export function createDefaultPriorities(facilityId) {
  const insertStmt = db.prepare(`
    INSERT INTO priority_levels (facility_id, label, rank, prefix, color, needs_verification, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((facId) => {
    for (const p of DEFAULT_PRIORITIES) {
      insertStmt.run(facId, p.label, p.rank, p.prefix, p.color, p.needs_verification, p.description);
    }
  });

  insertMany(facilityId);
}

export function getNextSequence(facilityId, prefix, dateIso) {
  const dateStr = (dateIso ? new Date(dateIso) : new Date()).toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COALESCE(MAX(t.seq), 0) AS max_seq
    FROM tokens t
    JOIN priority_levels p ON t.priority_id = p.id
    WHERE t.facility_id = ?
      AND p.prefix = ?
      AND date(t.created_at) = date(?)
  `).get(facilityId, prefix, dateStr);

  const seq = (row?.max_seq || 0) + 1;
  const displayNumber = `${prefix}-${String(seq).padStart(3, '0')}`;
  return { seq, displayNumber };
}

// Valid transitions validation
export const ALLOWED_TRANSITIONS = {
  BOOKED: ['WAITING', 'CANCELLED'],
  WAITING: ['CALLED', 'CANCELLED'],
  CALLED: ['SERVING', 'NO_SHOW', 'WAITING', 'CANCELLED'],
  SERVING: ['COMPLETED'],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: []
};

export function isValidTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Boolean(allowed && allowed.includes(toStatus));
}
