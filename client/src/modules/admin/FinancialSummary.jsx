import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../shared/utils/authHeaders.js';
import styles from './FinancialSummary.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';

function fmt(n) { return Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Minimal SVG pie chart (no external deps)
// ---------------------------------------------------------------------------
const PIE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

function PieChart({ data }) {
  if (!data || data.length === 0) return <p className={styles.empty}>No data</p>;

  const total = data.reduce((s, d) => s + +d.total, 0);
  if (total === 0) return <p className={styles.empty}>No payments in last 30 days</p>;

  let cumAngle = 0;
  const slices = data.map((d, i) => {
    const pct   = +d.total / total;
    const start = cumAngle;
    cumAngle   += pct * 360;
    return { ...d, pct, startAngle: start, endAngle: cumAngle, color: PIE_COLORS[i % PIE_COLORS.length] };
  });

  function polarToXY(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function slicePath(cx, cy, r, startAngle, endAngle) {
    const [x1, y1] = polarToXY(cx, cy, r, startAngle);
    const [x2, y2] = polarToXY(cx, cy, r, endAngle);
    const large     = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
  }

  return (
    <div className={styles.pieWrap}>
      <svg viewBox="0 0 200 200" width={180} height={180} aria-label="Payment method breakdown">
        {slices.map((s) => (
          <path key={s.method} d={slicePath(100, 100, 90, s.startAngle, s.endAngle)}
            fill={s.color} stroke="#fff" strokeWidth={2}>
            <title>{s.method}: ₹{fmt(s.total)} ({(s.pct * 100).toFixed(1)}%)</title>
          </path>
        ))}
      </svg>
      <ul className={styles.legend}>
        {slices.map((s, i) => (
          <li key={s.method} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: s.color }} />
            <span>{s.method}</span>
            <span className={styles.legendVal}>₹{fmt(s.total)}</span>
            <span className={styles.legendPct}>({(s.pct * 100).toFixed(1)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function FinancialSummary() {
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch(`${API}/bills/summary/financial?date=${date}`);
      setData(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Financial Summary</h1>
        <div className={styles.dateRow}>
          <label className={styles.label} htmlFor="summaryDate">Date</label>
          <input id="summaryDate" type="date" className={styles.dateInput}
            value={date} onChange={(e) => setDate(e.target.value)} />
          <button className={styles.refreshBtn} onClick={fetchSummary}>Refresh</button>
        </div>
      </div>

      {loading && <p className={styles.loading}>Loading…</p>}
      {error   && <p className={styles.error} role="alert">{error}</p>}

      {data && (
        <>
          {/* Daily collection cards */}
          <div className={styles.statsRow}>
            <div className={`${styles.statCard} ${styles.accentGreen}`}>
              <span className={styles.statValue}>₹{fmt(data.daily.collected ?? 0)}</span>
              <span className={styles.statLabel}>Collected Today</span>
            </div>
            <div className={`${styles.statCard} ${styles.accentRed}`}>
              <span className={styles.statValue}>₹{fmt(data.daily.refunded ?? 0)}</span>
              <span className={styles.statLabel}>Refunded Today</span>
            </div>
            <div className={`${styles.statCard} ${styles.accentBlue}`}>
              <span className={styles.statValue}>{data.daily.transactions ?? 0}</span>
              <span className={styles.statLabel}>Transactions</span>
            </div>
            <div className={`${styles.statCard} ${styles.accentOrange}`}>
              <span className={styles.statValue}>{data.outstanding.length}</span>
              <span className={styles.statLabel}>Outstanding Bills</span>
            </div>
          </div>

          <div className={styles.grid}>
            {/* Outstanding payments */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Outstanding Payments</h2>
              {data.outstanding.length === 0 ? (
                <p className={styles.empty}>No outstanding bills.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Bill #</th><th>Patient</th><th>MRN</th>
                        <th>Net Amount</th><th>Paid</th><th>Outstanding</th>
                        <th>Due Date</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outstanding.map((b) => {
                        const outstanding = Math.max(0, +b.net_amount - +b.paid_amount);
                        const overdue = b.due_date && new Date(b.due_date) < new Date();
                        return (
                          <tr key={b.id} className={overdue ? styles.overdueRow : ''}>
                            <td className={styles.mono}>{b.bill_number}</td>
                            <td>{b.patient_name}</td>
                            <td className={styles.mono}>{b.mrn}</td>
                            <td>₹{fmt(b.net_amount)}</td>
                            <td className={styles.paidAmt}>₹{fmt(b.paid_amount)}</td>
                            <td className={styles.outstandingAmt}>₹{fmt(outstanding)}</td>
                            <td>{fmtDate(b.due_date)}{overdue && <span className={styles.overdueBadge}>Overdue</span>}</td>
                            <td>
                              <span className={`${styles.badge} ${b.status === 'PARTIALLY_PAID' ? styles.badgePartial : styles.badgePending}`}>
                                {b.status === 'PARTIALLY_PAID' ? 'Partial' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Payment method pie chart */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Payment Methods (Last 30 Days)</h2>
              <PieChart data={data.methodBreakdown} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
