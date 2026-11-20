import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAverageServiceMinutes, estimateWaitTime } from '../estimate.js';

test('calculateAverageServiceMinutes: returns default when insufficient samples', () => {
  const defaultMin = 12;
  // Empty
  assert.equal(calculateAverageServiceMinutes([], defaultMin), defaultMin);

  // Less than 3 valid samples
  const tokens = [
    { started_at: '2026-11-20T10:00:00.000Z', completed_at: '2026-11-20T10:10:00.000Z' },
    { started_at: '2026-11-20T10:10:00.000Z', completed_at: '2026-11-20T10:20:00.000Z' }
  ];
  assert.equal(calculateAverageServiceMinutes(tokens, defaultMin), defaultMin);
});

test('calculateAverageServiceMinutes: ignores outliers > 3x default and averages last 10', () => {
  const defaultMin = 10;
  const samples = [
    // Outlier (> 30 min)
    { started_at: '2026-11-20T08:00:00.000Z', completed_at: '2026-11-20T08:45:00.000Z' }, // 45 min -> ignored
    // 3 valid samples: 8 min, 10 min, 12 min -> avg = 10 min
    { started_at: '2026-11-20T09:00:00.000Z', completed_at: '2026-11-20T09:08:00.000Z' }, // 8 min
    { started_at: '2026-11-20T09:10:00.000Z', completed_at: '2026-11-20T09:20:00.000Z' }, // 10 min
    { started_at: '2026-11-20T09:25:00.000Z', completed_at: '2026-11-20T09:37:00.000Z' }  // 12 min
  ];

  const avg = calculateAverageServiceMinutes(samples, defaultMin);
  assert.equal(avg, 10);
});

test('estimateWaitTime: returns Queue paused when facility is paused', () => {
  const res = estimateWaitTime({
    waitingAheadCount: 5,
    busyCount: 1,
    activeCounters: 2,
    avgServiceMinutes: 10,
    isPaused: true
  });

  assert.equal(res.isPaused, true);
  assert.equal(res.displayText, 'Queue paused');
  assert.equal(res.waitMinutes, null);
  assert.equal(res.expectedClockTime, null);
});

test('estimateWaitTime: returns 0-2 min when waiting ahead is less than free counters', () => {
  const res = estimateWaitTime({
    waitingAheadCount: 0,
    busyCount: 1,
    activeCounters: 2, // free = 1 > a (0)
    avgServiceMinutes: 15,
    isPaused: false
  });

  assert.equal(res.isPaused, false);
  assert.equal(res.displayText, 'about 0-2 min');
  assert.equal(res.minMinutes, 0);
  assert.equal(res.maxMinutes, 2);
});

test('estimateWaitTime: computes batches and +/- 25% range', () => {
  // waitingAheadCount = 3, busy = 2, activeCounters = 2
  // free = max(0, 2 - 2) = 0
  // batches = ceil((3 - 0 + 1) / 2) = ceil(4 / 2) = 2
  // wait = 2 * 10 = 20 min
  // min = round(20 * 0.75) = 15 min
  // max = round(20 * 1.25) = 25 min
  const now = new Date('2026-11-20T10:00:00.000Z');
  const res = estimateWaitTime({
    waitingAheadCount: 3,
    busyCount: 2,
    activeCounters: 2,
    avgServiceMinutes: 10,
    isPaused: false,
    currentTime: now
  });

  assert.equal(res.isPaused, false);
  assert.equal(res.waitMinutes, 20);
  assert.equal(res.minMinutes, 15);
  assert.equal(res.maxMinutes, 25);
  assert.equal(res.displayText, 'about 15-25 min');
  assert.equal(res.expectedClockTime, new Date('2026-11-20T10:20:00.000Z').toISOString());
});
