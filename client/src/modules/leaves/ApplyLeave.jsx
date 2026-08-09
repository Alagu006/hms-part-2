import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './ApplyLeave.module.scss';

const LEAVE_TYPES = [
  { value: 'ANNUAL',       label: 'Annual Leave' },
  { value: 'SICK',         label: 'Sick Leave' },
  { value: 'EMERGENCY',    label: 'Emergency Leave' },
  { value: 'MATERNITY',    label: 'Maternity Leave' },
  { value: 'PATERNITY',    label: 'Paternity Leave' },
  { value: 'COMPENSATORY', label: 'Compensatory Leave' },
  { value: 'UNPAID',       label: 'Unpaid Leave' },
];

const STATUS_CONFIG = {
  PENDING  : { label: 'Pending',  cls: styles.statusPending },
  APPROVED : { label: 'Approved', cls: styles.statusApproved },
  REJECTED : { label: 'Rejected', cls: styles.statusRejected },
  CANCELLED: { label: 'Cancelled',cls: styles.statusCancelled },
};

function countBusinessDays(start, end) {
  if (!start || !end) return 0;
  let count = 0;
  const cur = new Date(start);
  const fin = new Date(end);
  while (cur <= fin) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Leave history card
// ---------------------------------------------------------------------------
function LeaveCard({ leave }) {
  const cfg = STATUS_CONFIG[leave.status] ?? STATUS_CONFIG.PENDING;
  const days = parseFloat(leave.days_count);
  const reviewer = leave.reviewer_first
    ? `${leave.reviewer_first} ${leave.reviewer_last}`
    : null;

  return (
    <div className={styles.leaveCard}>
      <div className={styles.leaveCardTop}>
        <div>
          <span className={styles.leaveType}>{leave.leave_type.replace('_', ' ')}</span>
          <span className={styles.leaveDates}>
            {formatDate(leave.start_date)} – {formatDate(leave.end_date)}
            <span className={styles.leaveDays}> · {days} day{days !== 1 ? 's' : ''}</span>
          </span>
        </div>
        <span className={`${styles.statusBadge} ${cfg.cls}`}>{cfg.label}</span>
      </div>

      {leave.reason && (
        <div className={styles.leaveReason}>"{leave.reason}"</div>
      )}

      {leave.status === 'REJECTED' && (
        <div className={styles.rejectionBox}>
          <span className={styles.rejectionLabel}>Rejection reason:</span>
          <span className={styles.rejectionText}>
            {leave.review_note ?? 'No reason provided'}
          </span>
          {reviewer && <span className={styles.reviewerName}>— {reviewer}</span>}
        </div>
      )}

      {leave.status === 'APPROVED' && reviewer && (
        <div className={styles.approvedBy}>Approved by {reviewer}</div>
      )}

      <div className={styles.leaveCardMeta}>
        Applied {formatDate(leave.created_at)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ApplyLeave({ onSuccess }) {
  const [form, setForm]       = useState({ leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' });
  const [balances, setBalances] = useState([]);
  const [leaves, setLeaves]   = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await apiFetch(`/leaves/my`);
      setBalances(data?.balances ?? []);
      setLeaves(data?.leaves ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const currentBalance = balances.find(b => b.leave_type === form.leaveType);
  const businessDays   = countBusinessDays(form.startDate, form.endDate);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/leaves`, {
        method: 'POST',
        body: JSON.stringify({
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate  : form.endDate,
          reason   : form.reason,
        }),
      });
      setSuccess(true);
      setForm({ leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' });
      loadData();
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* ── Apply form ── */}
      <div className={styles.card}>
        <h2 className={styles.title}>Apply for Leave</h2>

        {success && (
          <div className={styles.successBox} style={{ marginBottom: '1rem' }}>
            <span className={styles.successIcon}>✓</span>
            <p>Leave request submitted. Pending approval.</p>
            <button className={styles.resetBtn} onClick={() => setSuccess(false)}>Apply Another</button>
          </div>
        )}

        {!success && (
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            <div className={styles.field}>
              <label htmlFor="leaveType">Leave Type</label>
              <select id="leaveType" value={form.leaveType} onChange={set('leaveType')} required>
                {LEAVE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {currentBalance && (
              <div className={styles.balanceChip}>
                <span>Available:</span>
                <strong className={parseFloat(currentBalance.available_days) < businessDays ? styles.balanceLow : styles.balanceOk}>
                  {parseFloat(currentBalance.available_days)} days
                </strong>
                <span className={styles.balanceMeta}>
                  ({parseFloat(currentBalance.used_days)} used · {parseFloat(currentBalance.pending_days)} pending)
                </span>
              </div>
            )}

            <div className={styles.dateRow}>
              <div className={styles.field}>
                <label htmlFor="startDate">Start Date</label>
                <input id="startDate" type="date" value={form.startDate} onChange={set('startDate')}
                  min={new Date().toISOString().slice(0, 10)} required />
              </div>
              <div className={styles.field}>
                <label htmlFor="endDate">End Date</label>
                <input id="endDate" type="date" value={form.endDate} onChange={set('endDate')}
                  min={form.startDate || new Date().toISOString().slice(0, 10)} required />
              </div>
            </div>

            {businessDays > 0 && (
              <div className={styles.daysPreview}>{businessDays} working day{businessDays !== 1 ? 's' : ''}</div>
            )}

            <div className={styles.field}>
              <label htmlFor="reason">Reason <span className={styles.optional}>(optional)</span></label>
              <textarea id="reason" rows={3} value={form.reason} onChange={set('reason')}
                placeholder="Briefly describe the reason for your leave…" maxLength={1000} />
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <button type="submit" className={styles.submitBtn}
              disabled={submitting || !form.startDate || !form.endDate}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </form>
        )}
      </div>

      {/* ── Leave history ── */}
      {leaves.length > 0 && (
        <div className={styles.historySection}>
          <h3 className={styles.historyTitle}>My Leave Requests</h3>
          <div className={styles.historyList}>
            {leaves.map(l => <LeaveCard key={l.id} leave={l} />)}
          </div>
        </div>
      )}
    </div>
  );
}
