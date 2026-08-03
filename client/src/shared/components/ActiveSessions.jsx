import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../store/index.js';
import { useNotificationStore } from '../hooks/useNotifications.js';
import { apiFetch, API_BASE } from '../utils/api.js';
import { decodeJwtPayload } from '../utils/crypto.js';
import styles from './ActiveSessions.module.scss';

function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

function DeviceIcon({ device }) {
  if (device === 'Mobile') {
    return (
      <div className={`${styles.icon} ${styles.iconMobile}`} aria-hidden="true">
        <div className={styles.mobileScreen} />
        <div className={styles.mobileHome} />
      </div>
    );
  }
  if (device === 'Browser') {
    return (
      <div className={`${styles.icon} ${styles.iconBrowser}`} aria-hidden="true">
        <div className={styles.browserScreen}>
          <div className={styles.browserBar} />
        </div>
        <div className={styles.browserStand} />
      </div>
    );
  }
  return (
    <div className={`${styles.icon} ${styles.iconUnknown}`} aria-hidden="true">
      <div className={styles.unknownDevice} />
    </div>
  );
}

function SessionCard({ session, isCurrent, onRevoke, revoking }) {
  const [fading, setFading] = useState(false);

  function handleRevoke() {
    setFading(true);
    setTimeout(() => onRevoke(session.id), 300);
  }

  return (
    <div className={`${styles.card} ${isCurrent ? styles.cardCurrent : ''} ${fading ? styles.cardFading : ''}`}>
      <DeviceIcon device={session.device} />
      <div className={styles.cardInfo}>
        <div className={styles.cardIp}>{session.ip}</div>
        <div className={styles.cardMeta}>
          <span>{session.device}</span>
          <span className={styles.dot}>·</span>
          <span>{formatRelative(session.createdAt)}</span>
        </div>
      </div>
      <div className={styles.cardActions}>
        {isCurrent ? (
          <span className={styles.currentBadge}>Current session</span>
        ) : (
          <button
            className={styles.revokeBtn}
            onClick={handleRevoke}
            disabled={revoking}
            aria-label="Revoke this session"
          >
            {revoking ? 'Revoking…' : 'Revoke'}
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({ count, onConfirm, onCancel }) {
  return (
    <div className={styles.confirmOverlay} onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title" className={styles.confirmTitle}>Sign out all devices?</h3>
        <p className={styles.confirmBody}>
          This will sign out <strong>{count}</strong> other device{count !== 1 ? 's' : ''}. You will stay logged in on this device.
        </p>
        <div className={styles.confirmActions}>
          <button className={styles.confirmCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.confirmOk} onClick={onConfirm}>Sign out all</button>
        </div>
      </div>
    </div>
  );
}

export default function ActiveSessions({ onClose }) {
  const { accessToken } = useAuth();
  const queryClient      = useQueryClient();
  const addToast        = useNotificationStore((s) => s.addToast);

  const currentSessionId = decodeJwtPayload(accessToken ?? '')?.sessionId ?? null;

  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ['active-sessions'],
    queryFn: () => apiFetch(`${API_BASE}/auth/sessions`),
    enabled: !!accessToken,
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId) => apiFetch(`${API_BASE}/auth/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
      addToast({ title: 'Session revoked', body: 'That device has been signed out.', type: 'SESSION_REVOKED' });
    },
    onError: () => {
      addToast({ title: 'Error', body: 'Failed to revoke session. Please try again.', type: 'ERROR' });
    },
  });

  const signOutAllMutation = useMutation({
    mutationFn: () => apiFetch(`${API_BASE}/auth/sessions`, { method: 'DELETE' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
      addToast({
        title: 'All devices signed out',
        body: `Signed out of ${data.revokedCount} other device${data.revokedCount !== 1 ? 's' : ''}.`,
        type: 'SESSIONS_REVOKED',
      });
      setConfirmSignOut(false);
    },
    onError: () => {
      addToast({ title: 'Error', body: 'Failed to sign out devices. Please try again.', type: 'ERROR' });
      setConfirmSignOut(false);
    },
  });

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const otherSessionsCount = sessions.filter((s) => s.id !== currentSessionId).length;

  function handleRevoke(sessionId) {
    revokeMutation.mutate(sessionId);
  }

  function handleSignOutAll() {
    signOutAllMutation.mutate();
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Active sessions">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Active Sessions</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {isLoading && <div className={styles.loading}>Loading sessions…</div>}
          {error    && <div className={styles.error}>Failed to load sessions.</div>}
          {!isLoading && !error && sessions.length === 0 && (
            <div className={styles.empty}>No active sessions found.</div>
          )}
          {!isLoading && sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isCurrent={session.id === currentSessionId}
              onRevoke={handleRevoke}
              revoking={revokeMutation.isPending}
            />
          ))}
        </div>

        {otherSessionsCount > 0 && (
          <div className={styles.footer}>
            <button
              className={styles.signOutAllBtn}
              onClick={() => setConfirmSignOut(true)}
              disabled={signOutAllMutation.isPending}
            >
              {signOutAllMutation.isPending ? 'Signing out…' : 'Sign out all other devices'}
            </button>
          </div>
        )}
      </div>

      {confirmSignOut && (
        <ConfirmModal
          count={otherSessionsCount}
          onConfirm={handleSignOutAll}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  );
}
