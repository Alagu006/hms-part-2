import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useStore, getAccessToken } from '../store/index.js';
import { clearSessionKey } from '../utils/sessionKey.js';

/**
 * Listens for a force:logout event pushed by the server when an admin
 * terminates this user's session. Clears auth and redirects to /login.
 */
export function useForceLogout() {
  const clearAuth = useStore((s) => s.clearAuth);
  const user      = useStore((s) => s.user);
  const navigate  = useNavigate();

  useEffect(() => {
    if (!user?.id) return;

    const token = getAccessToken();
    if (!token) return;

    const socket = io('', {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('force:logout', () => {
      socket.disconnect();
      clearSessionKey();
      clearAuth();
      navigate('/login', { replace: true, state: { reason: 'Your session was terminated by an administrator.' } });
    });
    socket.on('connect_error', () => { /* backend not reachable — silent in dev */ });

    return () => socket.disconnect();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
