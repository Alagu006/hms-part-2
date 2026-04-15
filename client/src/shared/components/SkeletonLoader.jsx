import styles from './SkeletonLoader.module.scss';

/**
 * Generic skeleton loader with a pulsing GIF-like shimmer animation.
 *
 * Usage:
 *   <SkeletonLoader variant="page" />          — full page skeleton
 *   <SkeletonLoader variant="card" count={3} /> — stat cards
 *   <SkeletonLoader variant="table" rows={5} /> — table rows
 *   <SkeletonLoader variant="text" lines={3} /> — text lines
 */
export default function SkeletonLoader({ variant = 'text', count = 1, rows = 4, lines = 3, height }) {
  if (variant === 'page') {
    return (
      <div className={styles.page} aria-busy="true" aria-label="Loading…">
        <div className={styles.pageHeader}>
          <div className={`${styles.bone} ${styles.title}`} />
          <div className={`${styles.bone} ${styles.subtitle}`} />
        </div>
        <div className={styles.cardRow}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={styles.statCard}>
              <div className={`${styles.bone} ${styles.statLabel}`} />
              <div className={`${styles.bone} ${styles.statValue}`} />
            </div>
          ))}
        </div>
        <div className={styles.tableCard}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={styles.tableRow}>
              <div className={`${styles.bone} ${styles.cell} ${styles.cellWide}`} />
              <div className={`${styles.bone} ${styles.cell}`} />
              <div className={`${styles.bone} ${styles.cell}`} />
              <div className={`${styles.bone} ${styles.cell} ${styles.cellNarrow}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={styles.cardRow} aria-busy="true" aria-label="Loading…">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.statCard}>
            <div className={`${styles.bone} ${styles.statLabel}`} />
            <div className={`${styles.bone} ${styles.statValue}`} />
            <div className={`${styles.bone} ${styles.statSub}`} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className={styles.tableCard} aria-busy="true" aria-label="Loading…">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={styles.tableRow}>
            <div className={`${styles.bone} ${styles.cell} ${styles.cellWide}`} />
            <div className={`${styles.bone} ${styles.cell}`} />
            <div className={`${styles.bone} ${styles.cell}`} />
            <div className={`${styles.bone} ${styles.cell} ${styles.cellNarrow}`} />
          </div>
        ))}
      </div>
    );
  }

  // text / default
  return (
    <div className={styles.textBlock} aria-busy="true" aria-label="Loading…"
      style={height ? { height } : undefined}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`${styles.bone} ${styles.textLine}`}
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
