import assert from 'node:assert/strict';

const BASE_URL = 'http://127.0.0.1:4000';

async function req(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runVerification() {
  console.log('🚀 Running QueueEase Complete End-to-End Verification Flow...\n');

  // 1. List facilities
  console.log('Step 1: Listing existing facilities...');
  const facList = await req('/api/facilities');
  assert.equal(facList.status, 200);
  assert.ok(Array.isArray(facList.data), 'Facilities list should be array');
  console.log(`✓ Found ${facList.data.length} pre-existing facilities (including demo facilities).`);

  // 2. Create new facility
  console.log('\nStep 2: Creating new facility "Apex Community Medical"...');
  const createRes = await req('/api/facilities', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Apex Community Medical',
      type: 'Clinic',
      default_service_minutes: 10,
      active_counters: 2,
      staff_pin: '1234',
      aging_minutes: 20,
      no_show_grace_minutes: 3
    })
  });
  assert.equal(createRes.status, 201, `Failed to create facility: ${JSON.stringify(createRes.data)}`);
  const facility = createRes.data.facility;
  const priorities = createRes.data.priorities;
  assert.ok(facility.code, 'Facility should have 6-char code');
  assert.equal(facility.code.length, 6);
  assert.equal(priorities.length, 4);
  console.log(`✓ Facility created with Code: ${facility.code}, Name: ${facility.name}`);

  const pEmergency = priorities.find(p => p.prefix === 'E');
  const pSenior = priorities.find(p => p.prefix === 'S');
  const pAppt = priorities.find(p => p.prefix === 'A');
  const pRegular = priorities.find(p => p.prefix === 'R');

  // 3. Join 5 customers in sequence
  console.log('\nStep 3: Joining 5 customers with mixed priorities...');

  // Customer 1: Regular
  const c1 = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Rachel Green',
      phone: '+1-555-0101',
      priority_id: pRegular.id,
      notify_at: 3
    })
  });
  assert.equal(c1.status, 201);
  console.log(`✓ Added Customer 1: Rachel Green -> ${c1.data.token.display_number} (Regular)`);

  // Customer 2: Senior
  const c2 = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Arthur Dent (Senior)',
      phone: '+1-555-0102',
      priority_id: pSenior.id,
      notify_at: 3
    })
  });
  assert.equal(c2.status, 201);
  console.log(`✓ Added Customer 2: Arthur Dent -> ${c2.data.token.display_number} (Senior)`);

  // Customer 3: Regular
  const c3 = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Miles Davis',
      phone: '+1-555-0103',
      priority_id: pRegular.id,
      notify_at: 3
    })
  });
  assert.equal(c3.status, 201);
  console.log(`✓ Added Customer 3: Miles Davis -> ${c3.data.token.display_number} (Regular)`);

  // Customer 4: Appointment (in 30 mins)
  const apptTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const c4 = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Emma Stone',
      phone: '+1-555-0104',
      priority_id: pAppt.id,
      is_appointment: true,
      appointment_time: apptTime,
      notify_at: 3
    })
  });
  assert.equal(c4.status, 201);
  assert.equal(c4.data.token.status, 'BOOKED');
  console.log(`✓ Added Customer 4: Emma Stone -> ${c4.data.token.display_number} (Appointment, BOOKED)`);

  // Customer 5: Emergency (arrives last!)
  const c5 = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Bruce Banner (Critical)',
      phone: '+1-555-0105',
      priority_id: pEmergency.id,
      notify_at: 1
    })
  });
  assert.equal(c5.status, 201);
  console.log(`✓ Added Customer 5: Bruce Banner -> ${c5.data.token.display_number} (Emergency, arrived last)`);

  // 4. Verify Queue Ordering: Emergency MUST be position 1!
  console.log('\nStep 4: Checking queue state & verifying Emergency priority jump...');
  const queueState = await req(`/api/facilities/${facility.code}`);
  assert.equal(queueState.status, 200);
  const waiting = queueState.data.waitingTokens;

  console.log(`Current Waiting Line (${waiting.length} waiting):`);
  waiting.forEach((t, i) => {
    console.log(`  Pos #${i + 1}: ${t.display_number} | ${t.customer_name} | Rank: ${t.priority_rank} | EffRank: ${t.effective_rank}`);
  });

  assert.equal(waiting[0].customer_name, 'Bruce Banner (Critical)', 'Emergency customer MUST be at position #1');
  assert.equal(waiting[0].effective_rank, 1);
  assert.equal(waiting[1].customer_name, 'Arthur Dent (Senior)', 'Senior customer MUST be at position #2');
  console.log('✓ Priority ordering verified: Emergency jumped to #1, Senior is #2, Regulars follow.');

  // 5. Test Staff Call Next on Counter 1
  console.log('\nStep 5: Staff calls next customer to Counter 1...');
  const call1 = await req(`/api/staff/${facility.code}/call-next`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' },
    body: JSON.stringify({ counter_no: 1 })
  });
  assert.equal(call1.status, 200);
  assert.equal(call1.data.token.customer_name, 'Bruce Banner (Critical)');
  assert.equal(call1.data.token.status, 'CALLED');
  assert.equal(call1.data.token.counter_no, 1);
  console.log(`✓ Successfully called ${call1.data.token.customer_name} to Counter 1.`);

  // 6. Start & Complete Service on Counter 1
  console.log('\nStep 6: Start and complete service on Counter 1...');
  const startRes = await req(`/api/staff/${facility.code}/tokens/${call1.data.token.id}/start`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(startRes.status, 200);
  assert.equal(startRes.data.token.status, 'SERVING');
  console.log('✓ Token status updated to SERVING.');

  const completeRes = await req(`/api/staff/${facility.code}/tokens/${call1.data.token.id}/complete`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.data.token.status, 'COMPLETED');
  console.log('✓ Token status updated to COMPLETED.');

  // 7. Counter 2: Call next customer, Recall, and mark No-Show
  console.log('\nStep 7: Counter 2 calls next customer, tests recall, and marks No-Show...');
  const call2 = await req(`/api/staff/${facility.code}/call-next`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' },
    body: JSON.stringify({ counter_no: 2 })
  });
  assert.equal(call2.status, 200);
  assert.equal(call2.data.token.customer_name, 'Arthur Dent (Senior)');
  console.log(`✓ Called ${call2.data.token.customer_name} to Counter 2.`);

  // Recall
  const recallRes = await req(`/api/staff/${facility.code}/tokens/${call2.data.token.id}/recall`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(recallRes.status, 200);
  assert.equal(recallRes.data.token.call_count, 2);
  console.log(`✓ Recalled customer (call_count: ${recallRes.data.token.call_count}).`);

  // No-Show
  const noshowRes = await req(`/api/staff/${facility.code}/tokens/${call2.data.token.id}/no-show`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(noshowRes.status, 200);
  assert.equal(noshowRes.data.token.status, 'NO_SHOW');
  console.log('✓ Customer successfully marked as NO_SHOW.');

  // 8. Test Customer Rejoin Mechanism
  console.log('\nStep 8: Customer rejoins queue after No-Show...');
  const rejoinRes = await req(`/api/tokens/${call2.data.token.id}/rejoin`, {
    method: 'POST'
  });
  assert.equal(rejoinRes.status, 200);
  assert.ok(rejoinRes.data.newToken);
  assert.equal(rejoinRes.data.newToken.customer_name, 'Arthur Dent (Senior)');
  assert.equal(rejoinRes.data.newToken.status, 'WAITING');
  console.log(`✓ Customer rejoined! New Token issued: ${rejoinRes.data.newToken.display_number}`);

  // Test duplicate rejoin blocked
  const secondRejoin = await req(`/api/tokens/${call2.data.token.id}/rejoin`, {
    method: 'POST'
  });
  assert.equal(secondRejoin.status, 400);
  console.log('✓ Duplicate rejoin correctly rejected (allowed once per day).');

  // 9. Staff check-in appointment
  console.log('\nStep 9: Staff checks in appointment customer (Emma Stone)...');
  const checkinRes = await req(`/api/staff/${facility.code}/tokens/${c4.data.token.id}/checkin`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(checkinRes.status, 200);
  assert.equal(checkinRes.data.token.status, 'WAITING');
  console.log('✓ Emma Stone appointment checked in -> status is now WAITING.');

  // 10. Pause & Resume Queue
  console.log('\nStep 10: Testing pause and resume queue...');
  const pauseRes = await req(`/api/staff/${facility.code}/pause`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' },
    body: JSON.stringify({ reason: 'Team consultation break' })
  });
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.data.facility.status, 'paused');

  // Verify token status reflects pause
  const tokenAfterPause = await req(`/api/tokens/${c1.data.token.id}`);
  assert.equal(tokenAfterPause.data.waitEstimate.displayText, 'Queue paused');
  console.log('✓ Queue paused verified: customer wait estimate displays "Queue paused".');

  const resumeRes = await req(`/api/staff/${facility.code}/resume`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.data.facility.status, 'open');
  console.log('✓ Queue resumed verified.');

  // 11. Duplicate Phone Rejection
  console.log('\nStep 11: Testing duplicate phone number blocking...');
  const dupRes = await req(`/api/facilities/${facility.code}/tokens`, {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'Rachel Clone',
      phone: '+1-555-0101', // same phone as active customer Rachel Green
      priority_id: pRegular.id
    })
  });
  assert.equal(dupRes.status, 409);
  console.log(`✓ Duplicate phone rejected with HTTP 409: "${dupRes.data.error}".`);

  // 12. Simulate Customers
  console.log('\nStep 12: Testing "Simulate 5 Customers" button...');
  const simRes = await req(`/api/staff/${facility.code}/simulate`, {
    method: 'POST',
    headers: { 'x-staff-pin': '1234' }
  });
  assert.equal(simRes.status, 200);
  assert.equal(simRes.data.count, 5);
  console.log('✓ Successfully simulated 5 demo customers with mixed priorities.');

  console.log('\n🎉 ALL 12 INTEGRATION VERIFICATION STEPS PASSED WITH 100% SUCCESS!');
}

runVerification().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
