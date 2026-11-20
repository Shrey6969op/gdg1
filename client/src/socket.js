import { io } from 'socket.io-client';

// Use same host/port via Vite proxy
const SOCKET_URL = window.location.origin;

export const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  autoConnect: true
});

export function subscribeToFacility(facilityId, onUpdate) {
  if (!facilityId) return () => {};

  socket.emit('join:facility', facilityId);

  const handleUpdate = (data) => {
    onUpdate(data);
  };

  socket.on('queue:update', handleUpdate);

  return () => {
    socket.off('queue:update', handleUpdate);
    socket.emit('leave:facility', facilityId);
  };
}

export function subscribeToToken(tokenId, onUpdate, onNotification) {
  if (!tokenId) return () => {};

  socket.emit('join:token', tokenId);

  const handleUpdate = (data) => {
    onUpdate(data);
  };

  const handleNotification = (notif) => {
    if (onNotification) onNotification(notif);
  };

  socket.on('token:update', handleUpdate);
  socket.on('notification', handleNotification);

  return () => {
    socket.off('token:update', handleUpdate);
    socket.off('notification', handleNotification);
    socket.emit('leave:token', tokenId);
  };
}
