import crypto from 'crypto';
import { db, createDefaultPriorities, getNextSequence } from './db.js';

console.log('Seeding QueueEase demo data...');

// Clean existing data for DEMO facilities if present
const existingDemo1 = db.prepare('SELECT id FROM facilities WHERE code = ?').get('DEMO01');
if (existingDemo1) {
  db.prepare('DELETE FROM facilities WHERE id = ?').run(existingDemo1.id);
}
const existingDemo2 = db.prepare('SELECT id FROM facilities WHERE code = ?').get('DEMO02');
if (existingDemo2) {
  db.prepare('DELETE FROM facilities WHERE id = ?').run(existingDemo2.id);
}

const now = new Date();
const nowIso = now.toISOString();

// Helper to create a facility with tokens
function seedFacility({ code, name, type, defaultService, counters, agingMinutes, graceMinutes, tokenDefinitions }) {
  const facilityId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO facilities (
      id, code, name, type, default_service_minutes, active_counters,
      status, staff_pin, aging_minutes, no_show_grace_minutes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', '1234', ?, ?, ?)
  `).run(
    facilityId,
    code,
    name,
    type,
    defaultService,
    counters,
    agingMinutes,
    graceMinutes,
    nowIso
  );

  createDefaultPriorities(facilityId);
  const priorities = db.prepare('SELECT * FROM priority_levels WHERE facility_id = ?').all(facilityId);
  const pMap = new Map(priorities.map(p => [p.prefix, p]));

  for (const def of tokenDefinitions) {
    const priority = pMap.get(def.prefix) || priorities[0];
    const createdDate = new Date(now.getTime() - (def.createdOffsetMinutes || 10) * 60 * 1000);
    const createdIso = createdDate.toISOString();
    const { seq, displayNumber } = getNextSequence(facilityId, priority.prefix, createdIso);
    const tokenId = crypto.randomUUID();

    let startedIso = null;
    let completedIso = null;
    let calledIso = null;
    let checkedInIso = null;
    let effectiveTime = createdIso;

    if (def.isAppointment && def.apptOffsetMinutes !== undefined) {
      const apptDate = new Date(now.getTime() + def.apptOffsetMinutes * 60 * 1000);
      effectiveTime = apptDate.toISOString();
    }

    if (def.status === 'CALLED') {
      calledIso = new Date(now.getTime() - 1 * 60 * 1000).toISOString();
    } else if (def.status === 'SERVING') {
      calledIso = new Date(now.getTime() - 8 * 60 * 1000).toISOString();
      startedIso = new Date(now.getTime() - 6 * 60 * 1000).toISOString();
    } else if (def.status === 'COMPLETED') {
      calledIso = new Date(now.getTime() - 25 * 60 * 1000).toISOString();
      startedIso = new Date(now.getTime() - 22 * 60 * 1000).toISOString();
      completedIso = new Date(now.getTime() - (22 - (def.duration || 10)) * 60 * 1000).toISOString();
    }

    if (def.isAppointment && def.status !== 'BOOKED') {
      checkedInIso = createdIso;
    }

    db.prepare(`
      INSERT INTO tokens (
        id, facility_id, priority_id, display_number, seq, customer_name, phone,
        is_appointment, appointment_time, effective_time, status, counter_no,
        call_count, notify_at, created_at, checked_in_at, called_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tokenId,
      facilityId,
      priority.id,
      displayNumber,
      seq,
      def.customerName,
      def.phone || null,
      def.isAppointment ? 1 : 0,
      def.isAppointment ? effectiveTime : null,
      effectiveTime,
      def.status,
      def.counterNo || null,
      def.callCount || 0,
      def.notifyAt || 3,
      createdIso,
      checkedInIso,
      calledIso,
      startedIso,
      completedIso
    );
  }

  console.log(`Facility "${name}" created with code: ${code}`);
}

// Facility 1: City Clinic
seedFacility({
  code: 'DEMO01',
  name: 'City Clinic',
  type: 'Clinic',
  defaultService: 10,
  counters: 2,
  agingMinutes: 20,
  graceMinutes: 3,
  tokenDefinitions: [
    {
      customerName: 'Robert Vance',
      prefix: 'R',
      status: 'COMPLETED',
      duration: 9,
      counterNo: 1,
      createdOffsetMinutes: 30
    },
    {
      customerName: 'Marcus Wright',
      prefix: 'R',
      status: 'SERVING',
      counterNo: 1,
      callCount: 1,
      createdOffsetMinutes: 15
    },
    {
      customerName: 'Eleanor Sterling',
      prefix: 'S',
      status: 'CALLED',
      counterNo: 2,
      callCount: 1,
      createdOffsetMinutes: 12
    },
    {
      customerName: 'Liam Chen (Trauma)',
      prefix: 'E',
      status: 'WAITING',
      createdOffsetMinutes: 2
    },
    {
      customerName: 'Grace Hopper (Senior)',
      prefix: 'S',
      status: 'WAITING',
      createdOffsetMinutes: 14
    },
    {
      customerName: 'David Miller',
      prefix: 'A',
      status: 'WAITING',
      isAppointment: true,
      apptOffsetMinutes: -5, // Scheduled 5 min ago, already checked in
      createdOffsetMinutes: 20
    },
    {
      customerName: 'Sophia Patel',
      prefix: 'R',
      status: 'WAITING',
      createdOffsetMinutes: 8
    },
    {
      customerName: 'Lucas Ramirez',
      prefix: 'A',
      status: 'BOOKED',
      isAppointment: true,
      apptOffsetMinutes: 30, // Scheduled in 30 mins
      createdOffsetMinutes: 50
    }
  ]
});

// Facility 2: Mind Wellness Therapy
seedFacility({
  code: 'DEMO02',
  name: 'Mind Wellness Therapy',
  type: 'Therapist',
  defaultService: 20,
  counters: 1,
  agingMinutes: 25,
  graceMinutes: 5,
  tokenDefinitions: [
    {
      customerName: 'Hannah Abbott',
      prefix: 'A',
      status: 'COMPLETED',
      duration: 18,
      counterNo: 1,
      createdOffsetMinutes: 50
    },
    {
      customerName: 'Thomas Anderson',
      prefix: 'R',
      status: 'COMPLETED',
      duration: 22,
      counterNo: 1,
      createdOffsetMinutes: 45
    },
    {
      customerName: 'Sarah Connor',
      prefix: 'A',
      status: 'SERVING',
      counterNo: 1,
      callCount: 1,
      createdOffsetMinutes: 25
    },
    {
      customerName: 'Alexander Bell (Crisis)',
      prefix: 'E',
      status: 'WAITING',
      createdOffsetMinutes: 3
    },
    {
      customerName: 'Martha Kent',
      prefix: 'S',
      status: 'WAITING',
      createdOffsetMinutes: 18
    },
    {
      customerName: 'Bruce Wayne',
      prefix: 'R',
      status: 'WAITING',
      createdOffsetMinutes: 15
    },
    {
      customerName: 'Diana Prince',
      prefix: 'A',
      status: 'BOOKED',
      isAppointment: true,
      apptOffsetMinutes: 45,
      createdOffsetMinutes: 60
    },
    {
      customerName: 'Clark Kent',
      prefix: 'A',
      status: 'BOOKED',
      isAppointment: true,
      apptOffsetMinutes: 75,
      createdOffsetMinutes: 90
    }
  ]
});

console.log('Seed completed successfully! Both DEMO01 and DEMO02 are ready.');
