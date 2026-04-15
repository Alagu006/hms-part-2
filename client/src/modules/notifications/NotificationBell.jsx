import { useState, useEffect, useRef } from 'react';
import { useNotificationStore, useNotifications } from '../../shared/hooks/useNotifications.js';
import ActiveSessions from '../../shared/components/ActiveSessions.jsx';
import styles from './NotificationBell.module.scss';

// ---------------------------------------------------------------------------
// Type → icon + color map
// ---------------------------------------------------------------------------
const TYPE_CONFIG = {
  APPOINTMENT          : { icon: '📅', bg: '#dbeafe' },
  LAB_ORDER            : { icon: '🔬', bg: '#fef3c7' },
  LAB_RESULT           : { icon: '🧪', bg: '#fef3c7' },
  PRESCRIPTION         : { icon: '💊', bg: '#dcfce7' },
  LEAVE                : { icon: '✅', bg: '#dcfce7' },
  SYSTEM               : { icon: '🏥', bg: '#ede9fe' },
  ALERT                : { icon: '⚠️', bg: '#fef3c7' },
  MESSAGE              : { icon: '💬', bg: '#dbeafe' },
  SHIFT                : { icon: '🕐', bg: '#f3f4f6' },
  OT_SCHEDULED         : { icon: '🏨', bg: '#ede9fe' },
  BLOOD_REQUEST        : { icon: '🩸', bg: '#fee2e2' },
  EMERGENCY_ALERT      : { icon: '🚨', bg: '#fee2e2' },
  DISCHARGE_SUMMARY    : { icon: '📋', bg: '#dcfce7' },
  INCIDENT             : { icon: '🔧', bg: '#f3f4f6' },
};

function getConfig(type) {
  return TYPE_CONFIG[type] ?? { icon: '🔔', bg: '#f3f4f6' };
}

function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Toast renderer (portal-style, rendered at root level)
// ---------------------------------------------------------------------------
function ToastList() {
  const { toasts, dismissToast } = useNotificationStore();
  if (!toasts.length) return null;

  return (
    <div className={styles.toastContainer} aria-live="assertive" aria-atomic="false">
      {toasts.map((t) => {
        const cfg = getConfig(t.type);
        return (
          <div
            key={t.id}
            className={`${styles.toast} ${t.priority === 'high' ? styles.high : ''}`}
            role="alert"
          >
            <span className={styles.toastIcon}>{cfg.icon}</span>
            <div className={styles.toastContent}>
              <div className={styles.toastTitle}>{t.title}</div>
              {t.body && <div className={styles.toastBody}>{t.body}</div>}
            </div>
            <button
              className={styles.toastClose}
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main bell component
// ---------------------------------------------------------------------------
export default function NotificationBell({ currentUser }) {
  const [open, setOpen]         = useState(false);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(true);
  const [loading, setLoading]   = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const dropdownRef = useRef(null);

  const { unreadCount, notifications } = useNotificationStore();
  const { fetchNotifications, markRead, markAllRead, remove } = useNotifications(currentUser);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchNotifications(1)
      .then((json) => setHasMore((json.notifications?.length ?? 0) === 20))
      .finally(() => setLoading(false));
    setPage(1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    const next = page + 1;
    setPage(next);
    setLoading(true);
    const json = await fetchNotifications(next).finally(() => setLoading(false));
    setHasMore((json.notifications?.length ?? 0) === 20);
  }

  async function handleItemClick(n) {
    if (!n.is_read) await markRead(n.id);
    // Navigate to entity if applicable — extend as needed
  }

  return (
    <>
      <div className={styles.wrapper} ref={dropdownRef}>
        <button
          className={styles.bellBtn}
          onClick={() => setOpen((v) => !v)}
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
        >
          🔔
          {unreadCount > 0 && (
            <span className={styles.badge} aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div
            className={styles.dropdown}
            role="dialog"
            aria-label="Notifications"
          >
            <div className={styles.dropdownHeader}>
              <h3>Notifications</h3>
              <button
                className={styles.markAllBtn}
                onClick={markAllRead}
                disabled={unreadCount === 0}
              >
                Mark all read
              </button>
            </div>

            <div className={styles.list}>
              {notifications.length === 0 && !loading ? (
                <div className={styles.empty}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔕</div>
                  You're all caught up
                </div>
              ) : (
                notifications.map((n) => {
                  const cfg = getConfig(n.type);
                  return (
                    <div
                      key={n.id}
                      className={`${styles.item} ${!n.is_read ? styles.unread : ''}`}
                      onClick={() => handleItemClick(n)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleItemClick(n)}
                      aria-label={`${n.title}${!n.is_read ? ', unread' : ''}`}
                    >
                      <div
                        className={styles.iconWrap}
                        style={{ background: cfg.bg }}
                        aria-hidden="true"
                      >
                        {cfg.icon}
                      </div>

                      <div className={styles.content}>
                        <div className={styles.notifTitle}>{n.title}</div>
                        <div className={styles.notifBody}>{n.body}</div>
                        <div className={styles.notifTime}>
                          {formatRelativeTime(n.created_at)}
                        </div>
                      </div>

                      {!n.is_read && (
                        <div className={styles.unreadDot} aria-hidden="true" />
                      )}

                      <button
                        className={styles.deleteBtn}
                        onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                        aria-label="Delete notification"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}

              {loading && (
                <div className={styles.empty} style={{ padding: '16px' }}>
                  Loading…
                </div>
              )}
            </div>

            {hasMore && !loading && (
              <div className={styles.dropdownFooter}>
                <button className={styles.viewAllBtn} onClick={loadMore}>
                  Load more
                </button>
              </div>
            )}

            <div className={styles.sessionsLink}>
              <button
                className={styles.sessionsBtn}
                onClick={() => { setOpen(false); setShowSessions(true); }}
              >
                Manage sessions
              </button>
            </div>
          </div>
        )}
      </div>

      <ToastList />

      {showSessions && (
        <ActiveSessions onClose={() => setShowSessions(false)} />
      )}
    </>
  );
}
