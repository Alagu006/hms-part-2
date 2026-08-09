import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './BroadcastsInbox.module.scss';

const PRIORITY_MAP = {
  CRITICAL: { label: '🔴 Critical', cls: styles.critical },
  HIGH    : { label: '🟠 High',     cls: styles.high },
  MEDIUM  : { label: '🟡 Medium',   cls: styles.medium },
  LOW     : { label: '🟢 Low',      cls: styles.low },
};

function timeAgo(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Fetch broadcasts from the notifications endpoint (staff-side view)
async function fetchMyBroadcasts(page) {
  const data = await apiFetch(`/notifications?type=BROADCAST&page=${page}&limit=20`);
  return data ?? { notifications: [], total: 0 };
}

function BroadcastCard({ notif, onMarkRead }) {
  // Priority is embedded in metadata or title prefix like [HIGH]
  const rawTitle = notif.title ?? '';
  const priorityMatch = rawTitle.match(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*/i);
  const priority = (notif.metadata?.priority ?? priorityMatch?.[1] ?? 'MEDIUM').toUpperCase();
  const title    = rawTitle.replace(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*/i, '');
  const pCfg     = PRIORITY_MAP[priority] ?? PRIORITY_MAP.MEDIUM;

  return (
    <div className={`${styles.card} ${!notif.is_read ? styles.unread : ''}`}>
      <div className={styles.cardTop}>
        <div className={styles.cardLeft}>
          <span className={`${styles.priorityBadge} ${pCfg.cls}`}>{pCfg.label}</span>
          {!notif.is_read && <span className={styles.newBadge}>New</span>}
        </div>
        <span className={styles.time}>{timeAgo(notif.created_at)}</span>
      </div>

      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{notif.body}</div>

      {notif.metadata?.senderName && (
        <div className={styles.sender}>Sent by {notif.metadata.senderName}</div>
      )}

      {!notif.is_read && (
        <button className={styles.readBtn} onClick={() => onMarkRead(notif.id)}>
          Mark as read
        </button>
      )}
    </div>
  );
}

export default function BroadcastsInbox() {
  const qc    = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-broadcasts', page],
    queryFn: () => fetchMyBroadcasts(page),
    placeholderData: (prev) => prev,
  });

  const notifications = data?.notifications ?? [];
  const total         = data?.total ?? 0;
  const totalPages    = Math.ceil(total / 20);

  const markRead = useMutation({
    mutationFn: (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-broadcasts'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch(`/notifications/read-all`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-broadcasts'] }),
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Broadcasts</h1>
          <p className={styles.sub}>Messages sent to all staff by administrators</p>
        </div>
        {unreadCount > 0 && (
          <button className={styles.markAllBtn} onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            Mark all as read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className={styles.list}>
          {[1,2,3].map(i => <div key={i} className={styles.skeleton} />)}
        </div>
      ) : isError ? (
        <div className={styles.empty}>Failed to load broadcasts.</div>
      ) : notifications.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>📢</span>
          <p>No broadcasts yet</p>
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {notifications.map(n => (
              <BroadcastCard key={n.id} notif={n} onMarkRead={(id) => markRead.mutate(id)} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Prev</button>
              <span className={styles.pageInfo}>{page} / {totalPages}</span>
              <button className={styles.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
