import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './CDSInsightsPanel.module.scss';

// ── Severity config ───────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  high  : { color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', icon: '🚨', label: 'High' },
  medium: { color: '#d97706', bg: '#fffbeb', border: '#fcd34d', icon: '⚠️', label: 'Medium' },
  low   : { color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ️', label: 'Low' },
};

// ── Alert type labels ─────────────────────────────────────────────────────────
const TYPE_LABELS = {
  DRUG_INTERACTION  : '💊 Drug Interaction',
  ALLERGY_CONFLICT  : '🤧 Allergy Alert',
  SEPSIS_RISK       : '🌡️ Sepsis Risk',
  DUPLICATE_ORDER   : '🔁 Duplicate Order',
  GUIDELINE_REMINDER: '📋 Guideline',
  GENERAL           : '🔔 Alert',
};

// ── Single alert card ─────────────────────────────────────────────────────────
function AlertCard({ alert, onAcknowledge, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason]     = useState('');
  const [showReason, setShowReason] = useState(null); // 'ack' | 'dismiss' | null

  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.low;

  function handleAction(type) {
    if (showReason === type) {
      // Submit
      if (type === 'ack') onAcknowledge(alert.id, reason);
      else onDismiss(alert.id, reason);
      setShowReason(null);
      setReason('');
    } else {
      setShowReason(type);
    }
  }

  return (
    <motion.div
      className={styles.alertCard}
      style={{ borderLeftColor: cfg.color, background: cfg.bg }}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25 }}
      layout
    >
      <div className={styles.alertHeader}>
        <div 
          className={styles.alertLeft}
          onClick={() => setExpanded(e => !e)}
          style={{ cursor: 'pointer', flex: 1 }}
        >
          <span className={styles.alertIcon} aria-hidden="true">{cfg.icon}</span>
          <div className={styles.alertMeta}>
            <span className={styles.alertType}>{TYPE_LABELS[alert.type] ?? alert.type}</span>
            <span className={styles.alertSeverity} style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        </div>
        <button
          className={styles.expandBtn}
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      <p className={styles.alertMessage}>{alert.message}</p>

      <AnimatePresence>
        {expanded && (
          <motion.div
            className={styles.alertActions}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {showReason && (
              <input
                className={styles.reasonInput}
                placeholder={`Reason for ${showReason === 'ack' ? 'acknowledging' : 'dismissing'} (optional)`}
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={500}
                autoFocus
              />
            )}
            <div className={styles.actionBtns}>
              <button
                className={`${styles.actionBtn} ${styles.ackBtn}`}
                onClick={() => handleAction('ack')}
                title="Mark as acknowledged — you've reviewed this alert"
              >
                {showReason === 'ack' ? '✓ Confirm Acknowledge' : '✓ Acknowledge'}
              </button>
              <button
                className={`${styles.actionBtn} ${styles.dismissBtn}`}
                onClick={() => handleAction('dismiss')}
                title="Dismiss — not applicable for this patient"
              >
                {showReason === 'dismiss' ? '✕ Confirm Dismiss' : '✕ Not Applicable'}
              </button>
              {showReason && (
                <button
                  className={`${styles.actionBtn} ${styles.cancelBtn}`}
                  onClick={() => { setShowReason(null); setReason(''); }}
                >
                  Cancel
                </button>
              )}
            </div>
            <p className={styles.alertTime}>
              Triggered: {new Date(alert.created_at).toLocaleString()}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
/**
 * CDSInsightsPanel
 * Props:
 *   patientId  string  — UUID of the patient to analyse
 *   collapsed  bool    — start collapsed (default false)
 */
export default function CDSInsightsPanel({ patientId, collapsed: initCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(initCollapsed);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cds-insights', patientId],
    queryFn : () => apiFetch(`/cds/insights/${patientId}`).then(r => r.data),
    enabled : !!patientId && !collapsed,
    staleTime: 2 * 60_000, // 2 min
    retry: 1,
  });

  const ackMutation = useMutation({
    mutationFn: ({ alertId, reason }) =>
      apiFetch(`/cds/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        body  : JSON.stringify({ reason }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cds-insights', patientId] }),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ alertId, reason }) =>
      apiFetch(`/cds/alerts/${alertId}/dismiss`, {
        method: 'POST',
        body  : JSON.stringify({ reason }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cds-insights', patientId] }),
  });

  const handleAcknowledge = useCallback((alertId, reason) => {
    ackMutation.mutate({ alertId, reason });
  }, [ackMutation]);

  const handleDismiss = useCallback((alertId, reason) => {
    dismissMutation.mutate({ alertId, reason });
  }, [dismissMutation]);

  const alerts  = data?.alerts ?? [];
  const summary = data?.summary ?? {};
  const highCount = summary.high ?? 0;

  return (
    <div className={`${styles.panel} ${collapsed ? styles.panelCollapsed : ''}`}>
      {/* Panel header */}
      <button
        className={styles.panelHeader}
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        aria-label="Toggle CDS Insights panel"
      >
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon} aria-hidden="true">🧠</span>
          <span className={styles.headerTitle}>CDS Insights</span>
          {highCount > 0 && (
            <span className={styles.urgentBadge} aria-label={`${highCount} high-priority alerts`}>
              {highCount} urgent
            </span>
          )}
          {!isLoading && alerts.length > 0 && (
            <span className={styles.countBadge}>{alerts.length}</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {!collapsed && (
            <span
              className={styles.refreshBtn}
              onClick={e => { e.stopPropagation(); refetch(); }}
              title="Refresh insights"
              aria-label="Refresh CDS insights"
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); refetch(); } }}
            >
              ↻
            </span>
          )}
          <span className={styles.chevron} aria-hidden="true">
            {collapsed ? '▼' : '▲'}
          </span>
        </div>
      </button>

      {/* Panel body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            className={styles.panelBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {isLoading && (
              <div className={styles.loadingState}>
                <div className={styles.spinner} aria-hidden="true" />
                <span>Analysing patient data…</span>
              </div>
            )}

            {isError && (
              <div className={styles.errorState}>
                <span>⚠️ Could not load insights.</span>
                <button className={styles.retryBtn} onClick={() => refetch()}>Retry</button>
              </div>
            )}

            {!isLoading && !isError && alerts.length === 0 && (
              <div className={styles.emptyState}>
                <span aria-hidden="true">✅</span>
                <p>No active alerts for this patient.</p>
              </div>
            )}

            {!isLoading && !isError && alerts.length > 0 && (
              <>
                {/* Summary bar */}
                <div className={styles.summaryBar}>
                  {summary.high   > 0 && <span className={styles.sumHigh}>🚨 {summary.high} High</span>}
                  {summary.medium > 0 && <span className={styles.sumMed}>⚠️ {summary.medium} Medium</span>}
                  {summary.low    > 0 && <span className={styles.sumLow}>ℹ️ {summary.low} Low</span>}
                </div>

                <div className={styles.alertList}>
                  <AnimatePresence>
                    {alerts.map(alert => (
                      <AlertCard
                        key={alert.id}
                        alert={alert}
                        onAcknowledge={handleAcknowledge}
                        onDismiss={handleDismiss}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                <p className={styles.disclaimer}>
                  CDS alerts are decision support only. Clinical judgment takes precedence.
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
