/**
 * Queue Ordering Engine for QueueEase
 *
 * Implements dynamic queue ordering based on arrival time, priority category,
 * and priority aging to prevent starvation of low-priority customers.
 */

/**
 * Calculates effective rank for a token given priority rank, wait duration, and aging rate.
 *
 * Rules:
 * - Emergency (rank 1) is always rank 1.
 * - If aging_minutes is 0 or negative, aging is disabled (effective_rank = priority_rank).
 * - For non-emergency (rank >= 2), aging discounts 1 rank level per aging_minutes waited:
 *   effective_rank = priority_rank - floor(minutes_waited / aging_minutes)
 * - Crucially, non-emergency tokens NEVER decrease below rank 2, ensuring Emergency
 *   always retains top priority regardless of how long others wait.
 *
 * @param {number} priorityRank - Base priority rank (1 = highest).
 * @param {number} minutesWaited - Minutes elapsed since effective_time.
 * @param {number} agingMinutes - Facility aging parameter (0 = off).
 * @returns {number} Effective priority rank.
 */
export function calculateEffectiveRank(priorityRank, minutesWaited, agingMinutes) {
  const pRank = Number(priorityRank);
  const mWaited = Math.max(0, Number(minutesWaited) || 0);
  const aging = Number(agingMinutes) || 0;

  if (pRank === 1) {
    return 1;
  }

  if (aging <= 0) {
    return pRank;
  }

  const discount = Math.floor(mWaited / aging);
  const computedRank = pRank - discount;

  // Never drop below 2 for non-emergency categories
  return Math.max(2, computedRank);
}

/**
 * Computes the effective time for an appointment token upon check-in.
 *
 * Rules:
 * - If check-in occurs on-time or early (now <= scheduled_time + 15 min):
 *   effective_time = scheduled_time
 * - If check-in is more than 15 minutes late (now > scheduled_time + 15 min):
 *   effective_time = check-in time
 *
 * @param {Date|string} scheduledTime
 * @param {Date|string} checkinTime
 * @returns {string} ISO string of effective time.
 */
export function computeAppointmentEffectiveTime(scheduledTime, checkinTime) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const checkinMs = new Date(checkinTime).getTime();
  const lateGraceMs = 15 * 60 * 1000; // 15 minutes

  if (checkinMs <= scheduledMs + lateGraceMs) {
    return new Date(scheduledMs).toISOString();
  } else {
    return new Date(checkinMs).toISOString();
  }
}

/**
 * Checks if an appointment is eligible for self check-in.
 * Allowed starting 15 minutes before scheduled time.
 *
 * @param {Date|string} scheduledTime
 * @param {Date|string} currentTime
 * @returns {boolean}
 */
export function canCheckInAppointment(scheduledTime, currentTime = new Date()) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const currentMs = new Date(currentTime).getTime();
  const earlyWindowMs = 15 * 60 * 1000; // 15 min before

  return currentMs >= (scheduledMs - earlyWindowMs);
}

/**
 * Orders a list of WAITING tokens according to QueueEase rules:
 * 1. effective_rank ASC (lowest numerical value = highest priority)
 * 2. effective_time ASC (earlier arrival/effective appointment time first)
 * 3. seq ASC (tiebreaker based on sequence number)
 *
 * @param {Array<Object>} tokens - List of tokens with status === 'WAITING'
 * @param {number} agingMinutes - Facility aging parameter
 * @param {Date|string} currentTime - Current reference time
 * @returns {Array<Object>} Sorted array of tokens with attached effective_rank and minutes_waited
 */
export function orderWaitingTokens(tokens, agingMinutes, currentTime = new Date()) {
  const nowMs = new Date(currentTime).getTime();

  // Filter to WAITING tokens only
  const waitingTokens = (tokens || []).filter(t => t.status === 'WAITING');

  const tokensWithRank = waitingTokens.map(token => {
    const effectiveMs = new Date(token.effective_time || token.created_at).getTime();
    const minutesWaited = Math.max(0, (nowMs - effectiveMs) / (60 * 1000));
    const effectiveRank = calculateEffectiveRank(token.priority_rank ?? token.rank ?? 4, minutesWaited, agingMinutes);

    return {
      ...token,
      minutes_waited: Math.floor(minutesWaited),
      effective_rank: effectiveRank
    };
  });

  return tokensWithRank.sort((a, b) => {
    // 1. effective_rank ASC
    if (a.effective_rank !== b.effective_rank) {
      return a.effective_rank - b.effective_rank;
    }

    // 2. effective_time ASC
    const timeA = new Date(a.effective_time || a.created_at).getTime();
    const timeB = new Date(b.effective_time || b.created_at).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // 3. seq ASC
    return (a.seq || 0) - (b.seq || 0);
  });
}
