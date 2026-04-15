import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './AnesthetistDashboard.module.scss';

export default function AnesthetistDashboard() {
  const [otSlots, setOtSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Correct prefix: /ot-schedules (registered in app.js as /api/ot-schedules)
    api.get('/ot-schedules', { params: { limit: 50 } })
      .then((r) => setOtSlots(r.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toDateString();
  const todayOps  = otSlots.filter((s) => new Date(s.scheduled_start).toDateString() === today);
  const upcoming  = otSlots.filter((s) => new Date(s.scheduled_start) > new Date());

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Anesthetist Dashboard</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{todayOps.length}</span>
          <span className={styles.statLabel}>Today's Procedures</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{upcoming.length}</span>
          <span className={styles.statLabel}>Upcoming Procedures</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{otSlots.length}</span>
          <span className={styles.statLabel}>Total Scheduled</span>
        </div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>OT Schedule</div>
        <table className={styles.table}>
          <thead>
            <tr><th>Date / Time</th><th>Patient</th><th>Procedure</th><th>Surgeon</th><th>OT Room</th><th>Status</th></tr>
          </thead>
          <tbody>
            {otSlots.map((s) => (
              <tr key={s.id}>
                <td className={styles.mono}>{new Date(s.scheduled_start).toLocaleString()}</td>
                <td>{s.patient_first} {s.patient_last}</td>
                <td>{s.procedure_name ?? '—'}</td>
                <td>{s.doctor_first ? `${s.doctor_first} ${s.doctor_last}` : '—'}</td>
                <td>{s.theatre ?? '—'}</td>
                <td>
                  <span className={`${styles.badge} ${styles[`status_${s.status}`] ?? ''}`}>
                    {s.status ?? 'SCHEDULED'}
                  </span>
                </td>
              </tr>
            ))}
            {otSlots.length === 0 && (
              <tr><td colSpan={6} className={styles.empty}>No procedures scheduled.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
