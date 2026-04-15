import styles from './EmptyState.module.scss';

/**
 * Context-aware empty state component.
 *
 * Props:
 *   icon       string  — emoji or SVG (default '📭')
 *   title      string  — main heading
 *   message    string  — supporting text
 *   action     node    — optional CTA button/link
 *   compact    bool    — smaller padding variant
 */
export default function EmptyState({
  icon = '📭',
  title = 'Nothing here yet',
  message,
  action,
  compact = false,
}) {
  return (
    <div className={`${styles.wrapper} ${compact ? styles.compact : ''}`} role="status">
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <h3 className={styles.title}>{title}</h3>
      {message && <p className={styles.message}>{message}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
