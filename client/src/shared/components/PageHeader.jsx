import styles from './PageHeader.module.scss';

/**
 * Consistent page header component.
 *
 * Props:
 *   title    string  — page title
 *   subtitle string  — optional subtitle
 *   actions  node    — optional right-side action buttons
 *   badge    string  — optional badge text (e.g. "LIVE", "Beta")
 *   badgeColor 'green'|'blue'|'amber'|'red'
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  badgeColor = 'blue',
}) {
  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {badge && (
            <span className={`${styles.badge} ${styles['badge_' + badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
