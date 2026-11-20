import React, { useState, useEffect } from 'react';
import { socket } from '../socket.js';

export default function LiveIndicator() {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }
    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <div className={`live-indicator ${isConnected ? 'live' : 'polling'}`} title={isConnected ? 'Connected via WebSocket (Realtime)' : 'Connected via 10s Polling Fallback'}>
      <span className="live-dot"></span>
      <span className="live-label">{isConnected ? 'Live' : 'Polling (10s)'}</span>
    </div>
  );
}
