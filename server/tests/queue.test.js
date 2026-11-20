import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEffectiveRank,
  computeAppointmentEffectiveTime,
  canCheckInAppointment,
  orderWaitingTokens
} from '../queue.js';

test('calculateEffectiveRank: Emergency (rank 1) is immutable and always 1', () => {
  assert.equal(calculateEffectiveRank(1, 0, 20), 1);
  assert.equal(calculateEffectiveRank(1, 100, 20), 1);
  assert.equal(calculateEffectiveRank(1, 1000, 10), 1);
});

test('calculateEffectiveRank: Aging discounts rank per interval but never drops below 2', () => {
  const agingMinutes = 20;

  // Rank 4 (Regular)
  assert.equal(calculateEffectiveRank(4, 0, agingMinutes), 4);
  assert.equal(calculateEffectiveRank(4, 19, agingMinutes), 4);
  assert.equal(calculateEffectiveRank(4, 20, agingMinutes), 3);
  assert.equal(calculateEffectiveRank(4, 39, agingMinutes), 3);
  assert.equal(calculateEffectiveRank(4, 40, agingMinutes), 2);
  // Cap at 2: even after 100 or 1000 minutes, cannot become rank 1
  assert.equal(calculateEffectiveRank(4, 60, agingMinutes), 2);
  assert.equal(calculateEffectiveRank(4, 500, agingMinutes), 2);

  // Rank 2 (Senior/Disabled/Pregnant) remains at minimum 2
  assert.equal(calculateEffectiveRank(2, 60, agingMinutes), 2);
});

test('calculateEffectiveRank: aging_minutes = 0 disables aging', () => {
  assert.equal(calculateEffectiveRank(4, 120, 0), 4);
  assert.equal(calculateEffectiveRank(3, 120, 0), 3);
});

test('computeAppointmentEffectiveTime: on-time or early preserves scheduled time', () => {
  const scheduled = '2026-11-20T10:00:00.000Z';
  const earlyCheckin = '2026-11-20T09:50:00.000Z';
  const onTimeCheckin = '2026-11-20T10:00:00.000Z';
  const tenMinLateCheckin = '2026-11-20T10:10:00.000Z';

  assert.equal(computeAppointmentEffectiveTime(scheduled, earlyCheckin), scheduled);
  assert.equal(computeAppointmentEffectiveTime(scheduled, onTimeCheckin), scheduled);
  assert.equal(computeAppointmentEffectiveTime(scheduled, tenMinLateCheckin), scheduled);
});

test('computeAppointmentEffectiveTime: > 15 min late uses check-in time', () => {
  const scheduled = '2026-11-20T10:00:00.000Z';
  const lateCheckin = '2026-11-20T10:20:00.000Z';

  assert.equal(computeAppointmentEffectiveTime(scheduled, lateCheckin), lateCheckin);
});

test('canCheckInAppointment: allows checkin up to 15 min before scheduled time', () => {
  const scheduled = '2026-11-20T10:00:00.000Z';

  assert.equal(canCheckInAppointment(scheduled, '2026-11-20T09:40:00.000Z'), false);
  assert.equal(canCheckInAppointment(scheduled, '2026-11-20T09:45:00.000Z'), true);
  assert.equal(canCheckInAppointment(scheduled, '2026-11-20T10:00:00.000Z'), true);
  assert.equal(canCheckInAppointment(scheduled, '2026-11-20T10:30:00.000Z'), true);
});

test('orderWaitingTokens: properly sorts by effective_rank, effective_time, and seq', () => {
  const now = new Date('2026-11-20T11:00:00.000Z');
  const agingMinutes = 20;

  const tokens = [
    // Regular customer who arrived 45 mins ago (effective rank: 4 - 2 = 2)
    {
      id: 'token-reg-old',
      status: 'WAITING',
      priority_rank: 4,
      effective_time: '2026-11-20T10:15:00.000Z',
      seq: 1
    },
    // Emergency customer who just arrived 1 min ago (rank 1)
    {
      id: 'token-emergency',
      status: 'WAITING',
      priority_rank: 1,
      effective_time: '2026-11-20T10:59:00.000Z',
      seq: 2
    },
    // Appointment customer who arrived on time 5 mins ago (rank 3, effective rank: 3)
    {
      id: 'token-appt',
      status: 'WAITING',
      priority_rank: 3,
      effective_time: '2026-11-20T10:55:00.000Z',
      seq: 3
    },
    // Another regular customer who arrived 5 mins ago (rank 4, effective rank: 4)
    {
      id: 'token-reg-new',
      status: 'WAITING',
      priority_rank: 4,
      effective_time: '2026-11-20T10:55:00.000Z',
      seq: 4
    },
    // A token in BOOKED or SERVING status - should be omitted
    {
      id: 'token-serving',
      status: 'SERVING',
      priority_rank: 1,
      effective_time: '2026-11-20T10:00:00.000Z',
      seq: 0
    }
  ];

  const ordered = orderWaitingTokens(tokens, agingMinutes, now);

  assert.equal(ordered.length, 4);
  // 1st: Emergency (rank 1)
  assert.equal(ordered[0].id, 'token-emergency');
  assert.equal(ordered[0].effective_rank, 1);

  // 2nd: Old regular (aged to rank 2)
  assert.equal(ordered[1].id, 'token-reg-old');
  assert.equal(ordered[1].effective_rank, 2);

  // 3rd: Appointment (rank 3)
  assert.equal(ordered[2].id, 'token-appt');
  assert.equal(ordered[2].effective_rank, 3);

  // 4th: New regular (rank 4)
  assert.equal(ordered[3].id, 'token-reg-new');
  assert.equal(ordered[3].effective_rank, 4);
});
