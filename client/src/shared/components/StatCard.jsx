import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SparklineChart } from './SparklineChart.jsx';
import styles from './StatCard.module.scss';

/**
 * Reusable stat card with:
 * - Animated count-up on mount
 * - Optional sparkline trend chart
 * - Color-coded status indicator (green/amber/red)
 * - Hover elevation
 *
 * Props:
 *   label       string   — card title
 *   value       number|string — main value (number triggers count-up)
 *   sub         string   — subtitle / secondary info
 *   prefix      string   — e.g. "₹" or "$"
 *   suffix      string   — e.g. "%" or " beds"
 *   trend       number[] — sparkline data array
 *   trendLabel  string   — e.g. "Last 7 days"
 *   status      'green'|'amber'|'red'|'blue'|'purple' — left border accent
 *   icon        string   — emoji or text icon
 *   delay       number   — animation delay in seconds
 */
export default function StatCard({
  label,
  value,
  sub,
  prefix = '',
  suffix = '',
  trend,
  trendLabel,
  status = 'blue',
  icon,
  delay = 0,
}) {
  const isNumeric = typeof value === 'number';
  const [displayed, setDisplayed] = useState(isNumeric ? 0 : value);
  const rafRef = useRef(null);

  // Count-up animation
  useEffect(() => {
    if (!isNumeric) { setDisplayed(value); return; }
    const duration = 900;
    const start = performance.now();
    const from = 0;
    const to = value;

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }

    const timeout = setTimeout(() => {
      rafRef.current = requestAnimationFrame(step);
    }, delay * 1000);

    return () => {
      clearTimeout(timeout);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, isNumeric, delay]);

  const trendColor = trend && trend.length >= 2
    ? trend[trend.length - 1] >= trend[0] ? '#16a34a' : '#dc2626'
    : '#6b7280';

  return (
    <motion.div
      className={`${styles.card} ${styles[`status_${status}`]}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
    >
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      </div>

      <div className={styles.valueRow}>
        <span className={styles.value}>
          {prefix}{isNumeric ? displayed.toLocaleString() : displayed}{suffix}
        </span>
        {trend && trend.length > 1 && (
          <span className={styles.trendArrow} style={{ color: trendColor }}>
            {trend[trend.length - 1] >= trend[0] ? '↑' : '↓'}
          </span>
        )}
      </div>

      {sub && <span className={styles.sub}>{sub}</span>}

      {trend && trend.length > 1 && (
        <div className={styles.sparkline}>
          <SparklineChart data={trend} color={trendColor} />
          {trendLabel && <span className={styles.trendLabel}>{trendLabel}</span>}
        </div>
      )}
    </motion.div>
  );
}
