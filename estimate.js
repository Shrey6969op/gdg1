/**
 * Wait-Time Estimation Engine for QueueEase
 *
 * Computes dynamic wait times based on historical completed tokens,
 * current queue depth, active counters, and current servicing tokens.
 */

/**
 * Calculates average service minutes for today's completed tokens.
 *
 * Rules:
 * - Uses up to the last 10 COMPLETED tokens today.
 * - Duration = (completed_at - started_at) in minutes.
 * - Ignore durations over 3x default_service_minutes or <= 0.
 * - If fewer than 3 valid samples, falls back to default_service_minutes.
 *
 * @param {Array<{ started_at: string, completed_at: string }>} completedTokens
 * @param {number} defaultServiceMinutes
 * @returns {number} Average service minutes (rounded to 1 decimal place).
 */
export function calculateAverageServiceMinutes(completedTokens, defaultServiceMinutes = 10) {
  const fallback = Number(defaultServiceMinutes) > 0 ? Number(defaultServiceMinutes) : 10;
  const maxValidDuration = 3 * fallback;

  if (!Array.isArray(completedTokens) || completedTokens.length === 0) {
    return fallback;
  }

  const validDurations = [];

  for (const token of completedTokens) {
    if (!token.started_at || !token.completed_at) continue;
    const startMs = new Date(token.started_at).getTime();
    const endMs = new Date(token.completed_at).getTime();
    const durationMinutes = (endMs - startMs) / (60 * 1000);

    if (durationMinutes > 0 && durationMinutes <= maxValidDuration) {
      validDurations.push(durationMinutes);
    }
  }

  // Use the last 10 valid durations
  const recentDurations = validDurations.slice(-10);

  if (recentDurations.length < 3) {
    return fallback;
  }

  const sum = recentDurations.reduce((acc, d) => acc + d, 0);
  const avg = sum / recentDurations.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Calculates estimated wait time for a customer at a given position in the queue.
 *
 * Rules:
 * - a = waiting tokens ahead (position - 1, e.g. 0 ahead if 1st in line)
 * - busy = count of tokens in CALLED or SERVING
 * - free = max(0, active_counters - busy)
 * - If a < free: wait is about 0-2 min.
 * - Otherwise: wait = ceil((a - free + 1) / active_counters) * avg_service_minutes
 * - Range: +/- 25% ("about X-Y min")
 * - If isPaused: return "Queue paused" and null times.
 *
 * @param {Object} params
 * @param {number} params.waitingAheadCount - Number of waiting tokens ahead
 * @param {number} params.busyCount - Number of tokens currently CALLED or SERVING
 * @param {number} params.activeCounters - Number of active service counters (min 1)
 * @param {number} params.avgServiceMinutes - Calculated average service time
 * @param {boolean} [params.isPaused=false] - Whether the facility queue is paused
 * @param {Date|string} [params.currentTime=new Date()] - Current reference time
 * @returns {Object} { isPaused, waitMinutes, minMinutes, maxMinutes, expectedClockTime, displayText }
 */
export function estimateWaitTime({
  waitingAheadCount = 0,
  busyCount = 0,
  activeCounters = 1,
  avgServiceMinutes = 10,
  isPaused = false,
  currentTime = new Date()
}) {
  const now = new Date(currentTime);

  if (isPaused) {
    return {
      isPaused: true,
      waitMinutes: null,
      minMinutes: null,
      maxMinutes: null,
      expectedClockTime: null,
      displayText: 'Queue paused'
    };
  }

  const counters = Math.max(1, Number(activeCounters) || 1);
  const busy = Math.max(0, Number(busyCount) || 0);
  const free = Math.max(0, counters - busy);
  const a = Math.max(0, Number(waitingAheadCount) || 0);
  const avgService = Math.max(1, Number(avgServiceMinutes) || 10);

  let waitMinutes;
  let minMinutes;
  let maxMinutes;
  let displayText;

  if (a < free) {
    // There is an available counter ready right now
    waitMinutes = 1;
    minMinutes = 0;
    maxMinutes = 2;
    displayText = 'about 0-2 min';
  } else {
    // Formula from requirement: ceil((a - free + 1) / active_counters) * avg_service_minutes
    const batches = Math.ceil((a - free + 1) / counters);
    waitMinutes = Math.round(batches * avgService);
    minMinutes = Math.max(0, Math.round(waitMinutes * 0.75));
    maxMinutes = Math.max(minMinutes + 1, Math.round(waitMinutes * 1.25));
    displayText = `about ${minMinutes}-${maxMinutes} min`;
  }

  const expectedDate = new Date(now.getTime() + waitMinutes * 60 * 1000);

  return {
    isPaused: false,
    waitMinutes,
    minMinutes,
    maxMinutes,
    expectedClockTime: expectedDate.toISOString(),
    displayText
  };
}
