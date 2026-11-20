/**
 * Audio, Vibration & Notification Manager
 * Synthesizes alerts using the WebAudio API (zero external audio files).
 */

let audioCtx = null;
let titleInterval = null;
let originalTitle = document.title;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Plays a pleasant synthetic two-tone chime via WebAudio.
 */
export function playChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    gain2.gain.setValueAtTime(0.35, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.65);
  } catch (err) {
    console.warn('Audio chime playback failed:', err);
  }
}

/**
 * Triggers physical vibration pattern on mobile devices.
 */
export function triggerVibration(pattern = [200, 100, 200, 100, 400]) {
  try {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (err) {
    console.warn('Vibration failed:', err);
  }
}

/**
 * Starts blinking the browser page title to alert the user.
 */
export function startTitleFlash(alertText = '(!) YOUR TURN') {
  stopTitleFlash();
  originalTitle = document.title || 'QueueEase';
  let isAlert = true;

  titleInterval = setInterval(() => {
    document.title = isAlert ? alertText : originalTitle;
    isAlert = !isAlert;
  }, 1000);
}

/**
 * Stops blinking and restores the original title.
 */
export function stopTitleFlash() {
  if (titleInterval) {
    clearInterval(titleInterval);
    titleInterval = null;
    document.title = originalTitle;
  }
}

/**
 * Requests browser notification permission with a one-line explanation.
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (err) {
    return 'denied';
  }
}

/**
 * Dispatches an OS/system browser notification if permitted.
 */
export function showBrowserNotification(title, options = {}) {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⏳</text></svg>',
        ...options
      });
    } catch (err) {
      console.warn('Browser notification error:', err);
    }
  }
}

/**
 * Master alert dispatcher combining Chime + Vibration + Title Flash + Browser Notification.
 */
export function triggerTurnAlert(message = 'Your turn! Please proceed to the counter.', counterNo = null) {
  playChime();
  triggerVibration([300, 150, 300, 150, 500]);
  startTitleFlash(counterNo ? `(!) Go to Counter ${counterNo}` : '(!) Your turn!');
  showBrowserNotification('QueueEase: Your Turn!', {
    body: message,
    requireInteraction: true
  });
}
