import { useEffect, useState } from 'react';
import styles from './ApplyLeave.module.scss';

const LEAVE_TYPES = [
  { value: 'ANNUAL',       label: 'Annual Leave' },
  { value: 'SICK',         label: 'Sick Leave' },
  { value: 'CASUAL',       label: 'Casual Leave' },
  { value: 'EMERGENCY',    label: 'Emergency Leave' },
  { value: 'MATERNITY',    label: 'Maternity Leave' },
  { value: 'PATERNITY',    label: 'Paternity Leave' },
  { value: 'COMPENSATORY', label: 'Compensatory Leave' },
  { value: 'UNPAID',       label: 'Unpaid Leave' },
];

// Map CASUAL → ANNUAL for API (schema doesn't have CASUAL)
const API_TYPE_MAP = { CASUAL: 'ANNUAL' };

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

export default function ApplyLeave({ onSuccess }) {
  const [form, setForm]         = useState({ leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' });
  const [balances, setBalances] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(false);

  useEffect(() => {
    fetch('/api/leaves/my', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setBalances(d.balances ?? []))
      .catch(() => {});
  }, []);

  const currentBalance = balances.find(
    (b) => b.leave_type === (API_TYPE_MAP[form.leaveType] ?? form.leaveType)
  );

  const businessDays = countBusinessDays(form.startDate, form.endDate);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const apiType = API_TYPE_MAP[form.leaveType] ?? form.leaveType;
      const res = await fetch('/api/leaves', {
        method     : 'POST',
        credentials: 'include',
        headers    : { 'Content-Type': 'application/json' },
        body       : JSON.stringify({
          leaveType: apiType,
          startDate: form.startDate,
          endDate  : form.endDate,
          reason   : form.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit leave');
      setSuccess(true);
      setForm({ leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' });
      onSuccess?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className={styles.successBox}>
        <span className={styles.successIcon}>✓</span>
        <p>Leave request submitted successfully. Pending approval.</p>
        <button className={styles.resetBtn} onClick={() => setSuccess(false)}>
          Apply Another
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Apply for Leave</h2>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {/* Leave type */}
        <div className={styles.field}>
          <label htmlFor="leaveType">Leave Type</label>
          <select id="leaveType" value={form.leaveType} onChange={set('leaveType')} required>
            {LEAVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Balance indicator */}
        {currentBalance && (
          <div className={styles.balanceChip}>
            <span>Available:</span>
            <strong
              className={
                parseFloat(currentBalance.available_days) < businessDays
                  ? styles.balanceLow
                  : styles.balanceOk
              }
            >
              {parseFloat(currentBalance.available_days)} days
            </strong>
            <span className={styles.balanceMeta}>
              ({parseFloat(currentBalance.used_days)} used · {parseFloat(currentBalance.pending_days)} pending)
            </span>
          </div>
        )}

        {/* Date range */}
        <div className={styles.dateRow}>
          <div className={styles.field}>
            <label htmlFor="startDate">Start Date</label>
            <input
              id="startDate"
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
              min={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="endDate">End Date</label>
            <input
              id="endDate"
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              min={form.startDate || new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
        </div>

        {/* Days preview */}
        {businessDays > 0 && (
          <div className={styles.daysPreview}>
            {businessDays} working day{businessDays !== 1 ? 's' : ''}
          </div>
        )}

        {/* Reason */}
        <div className={styles.field}>
          <label htmlFor="reason">Reason <span className={styles.optional}>(optional)</span></label>
          <textarea
            id="reason"
            rows={3}
            value={form.reason}
            onChange={set('reason')}
            placeholder="Briefly describe the reason for your leave…"
            maxLength={1000}
          />
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={submitting || !form.startDate || !form.endDate}
        >
          {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </form>
    </div>
  );
}
