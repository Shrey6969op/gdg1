/**
 * Notification Dispatcher for QueueEase
 *
 * Handles in-app realtime notifications via Socket.IO and includes
 * stub integration points for external SMS/WhatsApp providers.
 */

let ioInstance = null;

export function setSocketIO(io) {
  ioInstance = io;
}

/**
 * Sends a notification to a specific token holder.
 *
 * @param {Object} token - Token data object (must contain id, facility_id, and optionally phone)
 * @param {string} type - Notification type: 'NEAR' | 'CALLED' | 'RECALLED' | 'NO_SHOW' | 'CANCELLED' | 'PRIORITY_CHANGED' | 'PAUSED' | 'RESUMED'
 * @param {string} message - Human-readable notification message
 * @param {Object} [extra={}] - Additional metadata (e.g., counter_no)
 */
export function sendNotification(token, type, message, extra = {}) {
  const payload = {
    tokenId: token.id,
    facilityId: token.facility_id,
    type,
    message,
    displayNumber: token.display_number,
    counterNo: extra.counterNo || token.counter_no || null,
    timestamp: new Date().toISOString(),
    ...extra
  };

  // 1. In-App Realtime delivery via Socket.IO
  if (ioInstance) {
    // Deliver directly to the token subscriber's private room
    ioInstance.to(`token:${token.id}`).emit('notification', payload);

    // Also broadcast on the facility room for staff or display board sound cues
    ioInstance.to(`facility:${token.facility_id}`).emit('facility:event', payload);
  }

  // =========================================================================
  // EXTERNAL SMS / WHATSAPP INTEGRATION STUB
  // (Ready for integration with Twilio, AWS SNS, Infobip, Meta WhatsApp API)
  // =========================================================================
  if (token.phone) {
    // Future implementation:
    // await smsProvider.send({ to: token.phone, body: `[QueueEase] ${message}` });
    // console.log(`[SMS/WhatsApp STUB] To: ${token.phone} | Type: ${type} | Msg: ${message}`);
  }

  return payload;
}
