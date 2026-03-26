import styles from './GroupList.module.scss';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function initials(name) {
  return (name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function GroupList({ groups, activeGroupId, onSelect, isDM = false }) {
  if (!groups.length) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
        No {isDM ? 'conversations' : 'groups'} yet.
      </div>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <div
          key={g.id}
          className={`${styles.item} ${g.id === activeGroupId ? styles.active : ''}`}
          onClick={() => onSelect(g)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(g)}
          aria-label={`${g.name ?? 'Direct message'}, ${g.unread_count > 0 ? `${g.unread_count} unread` : 'no unread messages'}`}
          aria-current={g.id === activeGroupId ? 'true' : undefined}
        >
          <div className={`${styles.avatar} ${isDM ? styles.dm : ''}`}>
            {initials(g.name ?? g.other_user_name ?? '?')}
          </div>

          <div className={styles.info}>
            <div className={styles.name}>{g.name ?? g.other_user_name ?? 'Direct Message'}</div>
            <div className={styles.preview}>
              {g.last_msg_content
                ? '🔒 Encrypted message'
                : 'No messages yet'}
            </div>
          </div>

          <div className={styles.meta}>
            {g.last_msg_at && (
              <span className={styles.time}>{formatTime(g.last_msg_at)}</span>
            )}
            {g.unread_count > 0 && (
              <span className={styles.unreadBadge} aria-label={`${g.unread_count} unread`}>
                {g.unread_count > 99 ? '99+' : g.unread_count}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
