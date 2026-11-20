import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

// We can test against the running or exported app, or spin up a test instance
test('API: Basic endpoints and workflows', async (t) => {
  // Let's import the server or fetch endpoints
  // We can do an in-memory test with node fetch against a local ephemeral server
  const { default: express } = await import('express');
  const { db, getNextSequence } = await import('../db.js');
  const { getFacilityQueueState } = await import('../index.js');

  const facility = db.prepare('SELECT * FROM facilities WHERE code = ?').get('DEMO01');
  assert.ok(facility, 'DEMO01 facility should exist from seed');

  const state = getFacilityQueueState(facility.id);
  assert.ok(state, 'Queue state should be returned');
  assert.ok(Array.isArray(state.waitingTokens), 'waitingTokens should be an array');
  assert.ok(state.waitingTokens.length > 0, 'There should be waiting tokens');

  // Verify first waiting token is Emergency (E-...)
  const firstWaiting = state.waitingTokens[0];
  assert.equal(firstWaiting.priority_rank, 1, 'First waiting token must be Emergency rank 1');
});
