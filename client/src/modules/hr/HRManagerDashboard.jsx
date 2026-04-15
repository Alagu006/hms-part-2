import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../shared/utils/api.js';
import styles from './HRManagerDashboard.module.scss';

function StatCard({ label, value, accent }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles[accent] : ''}`}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export default function HRManagerDashboard() {
  const [stats, setStats] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/admin/stats'),
      api.get('/leaves', { params: { status: 'PENDING', limit: 100 } }),
    ])
      .then(([s, l]) => {
        setStats(s.data);
        setLeaves(l.data.rows ?? l.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleLeave = async (id, action) => {
    await api.patch(`/leaves/${id}/${action}`, {});
    setLeaves((prev) => prev.filter((l) => l.id !== id));
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>HR Dashboard</h1>

      <div className={styles.statsRow}>
        <StatCard label="Total Staff"        value={stats?.activeUsers} />
        <StatCard label="Pending Leaves"     value={leaves.length} accent={leaves.length > 5 ? 'accentYellow' : undefined} />
        <StatCard label="Today's Admissions" value={stats?.todayAdmissions} />
        <StatCard label="Bed Occupancy"      value={stats?.bedOccupancy ? `${stats.bedOccupancy.occupied}/${stats.bedOccupancy.total}` : '—'} />
      </div>

      <div className={styles.quickActions}>
        <Link to="/hr/staff" className={styles.actionBtn}>
          Manage Staff
        </Link>
        <Link to="/hr/shifts" className={styles.actionBtn}>
          Manage Shifts
        </Link>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>Pending Leave Requests</div>
        {leaves.length === 0 ? (
          <p className={styles.empty}>No pending leave requests.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Reason</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={l.id}>
                  <td>{l.first_name} {l.last_name}</td>
                  <td>{l.leave_type}</td>
                  <td>{new Date(l.start_date).toLocaleDateString()}</td>
                  <td>{new Date(l.end_date).toLocaleDateString()}</td>
                  <td className={styles.reason}>{l.reason ?? '—'}</td>
                  <td className={styles.actions}>
                    <button className={styles.approveBtn} onClick={() => handleLeave(l.id, 'approve')}>Approve</button>
                    <button className={styles.rejectBtn}  onClick={() => handleLeave(l.id, 'reject')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
