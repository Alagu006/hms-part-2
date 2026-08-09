import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createInactivityTimer } from '../utils/inactivity.js';
import { apiFetch } from '../utils/api.js';
import { useStore } from '../store/index.js';
import { clearSessionKey } from '../utils/sessionKey.js';
import styles from './SessionTimeoutWarning.module.scss';

const WARN_SECONDS = 120; // 2 minutes

export default function SessionTimeoutWarning() {
  const [visible, setVisible]     = useState(false);
  const [countdown, setCountdown] = useState(WARN_SECONDS);
  const clearAuth = useStore(s => s.clearAuth);
  const user      = useStore(s => s.user);
  const navigate  = useNavigate();

  const doLogout = useCallback(() => {
    setVisible(false);
    clearSessionKey();
    clearAuth();
    navigate('/login', { replace: true, state: { reason: 'Your session expired due to inactivity.' } });
  }, [clearAuth, navigate]);

  const extendSession = useCallback(async () => {
    setVisible(false);
    setCountdown(WARN_SECONDS);
    try {
      // Ping any authenticated endpoint to refresh the session
      await apiFetch(`/auth/refresh`, { method: 'POST' });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const timer = createInactivityTimer({
      onTimeout: doLogout,
      onWarning: () => {
        setVisible(true);
        setCountdown(WARN_SECONDS);
      },
    });
    timer.start();
    return () => timer.stop();
  }, [user?.id, doLogout]);

  // Countdown ticker
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(id); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const mins = Math.floor(countdown / 60);
  const secs = String(countdown % 60).padStart(2, '0');

  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-label="Session expiring soon">
      <div className={styles.modal}>
        <div className={styles.icon}>⏱</div>
        <h2 className={styles.title}>Session Expiring Soon</h2>
        <p className={styles.body}>
          You've been inactive. Your session will expire in{' '}
          <strong>{mins}:{secs}</strong>.
        </p>
        <div className={styles.actions}>
          <button className={styles.extendBtn} onClick={extendSession}>
            Stay Logged In
          </button>
          <button className={styles.logoutBtn} onClick={doLogout}>
            Log Out Now
          </button>
        </div>
      </div>
    </div>
  );
}
