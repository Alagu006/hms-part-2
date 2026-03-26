import { useState, useEffect } from 'react';
import { useNotificationStore } from '../../shared/hooks/useNotifications.js';
import styles from './BroadcastBanner.module.scss';

const STORAGE_KEY = (userId) => `dismissed_broadcasts_${userId}`;

function getDismissed(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY(userId)) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(userId, set) {
  localStorage.setItem(STORAGE_KEY(userId), JSON.stringify([...set]));
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    day   : '2-digit',
    month : 'short',
    hour  : '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Single dismissible banner
// ---------------------------------------------------------------------------
function Banner({ notification, onDismiss }) {
  const { metadata } = notification;
  const senderName   = metadata?.senderName ?? 'Admin';

  return (
    <div className={styles.banner} role="alert" aria-live="assertive">
      <div className={styles.iconWrap} aria-hidden="true">📢</div>

      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.criticalTag}>CRITICAL BROADCAST</span>
          <span className={styles.meta}>
            From {senderName} · {formatTime(notification.created_at)}
          </span>
        </div>
        <div className={styles.title}>{notification.title.replace(/^\[CRITICAL\]\s*/i, '')}</div>
        {notification.body && (
          <div className={styles.body}>{notification.body}</div>
        )}
      </div>

      <button
        className={styles.dismissBtn}
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss broadcast"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — listens to Zustand store for CRITICAL BROADCAST notifications
// ---------------------------------------------------------------------------
export default function BroadcastBanner({ currentUser }) {
  const notifications = useNotificationStore((s) => s.notifications);
  const [dismissed, setDismissed] = useState(() =>
    currentUser?.id ? getDismissed(currentUser.id) : new Set()
  );

  // Sync dismissed set when user changes
  useEffect(() => {
    if (currentUser?.id) setDismissed(getDismissed(currentUser.id));
  }, [currentUser?.id]);

  function handleDismiss(id) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (currentUser?.id) saveDismissed(currentUser.id, next);
      return next;
    });
  }

  const criticalBroadcasts = notifications.filter(
    (n) =>
      n.type === 'BROADCAST' &&
      n.metadata?.priority === 'CRITICAL' &&
      !dismissed.has(n.id)
  );

  if (!criticalBroadcasts.length) return null;

  return (
    <div className={styles.stack}>
      {criticalBroadcasts.map((n) => (
        <Banner key={n.id} notification={n} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
