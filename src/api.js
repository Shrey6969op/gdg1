/**
 * API client for QueueEase
 */

export async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || `HTTP ${response.status}: Request failed`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Facility APIs
export const getFacilities = () => apiRequest('/api/facilities');
export const getFacilityByCode = (code) => apiRequest(`/api/facilities/${code}`);
export const createFacility = (data) => apiRequest('/api/facilities', { method: 'POST', body: JSON.stringify(data) });
export const updateFacility = (code, pin, data) => apiRequest(`/api/facilities/${code}`, {
  method: 'PATCH',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify(data)
});

// Customer Token APIs
export const joinQueue = (code, data) => apiRequest(`/api/facilities/${code}/tokens`, {
  method: 'POST',
  body: JSON.stringify(data)
});
export const getTokenStatus = (id) => apiRequest(`/api/tokens/${id}`);
export const checkinToken = (id) => apiRequest(`/api/tokens/${id}/checkin`, { method: 'POST' });
export const cancelToken = (id) => apiRequest(`/api/tokens/${id}/cancel`, { method: 'POST' });
export const rejoinToken = (id) => apiRequest(`/api/tokens/${id}/rejoin`, { method: 'POST' });

// Staff APIs
export const staffCallNext = (code, pin, counterNo) => apiRequest(`/api/staff/${code}/call-next`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify({ counter_no: counterNo })
});

export const staffRecall = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/recall`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffStartServing = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/start`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffComplete = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/complete`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffNoShow = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/no-show`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffChangePriority = (code, pin, tokenId, priorityId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/priority`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify({ priority_id: priorityId })
});

export const staffCancelToken = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/cancel`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffCheckin = (code, pin, tokenId) => apiRequest(`/api/staff/${code}/tokens/${tokenId}/checkin`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffWalkIn = (code, pin, data) => apiRequest(`/api/staff/${code}/walk-in`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify(data)
});

export const staffPauseQueue = (code, pin, reason) => apiRequest(`/api/staff/${code}/pause`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify({ reason })
});

export const staffResumeQueue = (code, pin) => apiRequest(`/api/staff/${code}/resume`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffSetCounters = (code, pin, count) => apiRequest(`/api/staff/${code}/counters`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin },
  body: JSON.stringify({ active_counters: count })
});

export const staffResetDay = (code, pin) => apiRequest(`/api/staff/${code}/reset-day`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});

export const staffSimulate = (code, pin) => apiRequest(`/api/staff/${code}/simulate`, {
  method: 'POST',
  headers: { 'x-staff-pin': pin }
});
