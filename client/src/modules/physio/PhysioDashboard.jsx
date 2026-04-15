import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './PhysioDashboard.module.scss';

export default function PhysioDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/appointments', { params: { limit: 50 } })
      .then((r) => setAppointments(r.data.rows ?? r.data ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toDateString();
  const todayAppts = appointments.filter((a) => new Date(a.appointment_date).toDateString() === today);
  const upcoming   = appointments.filter((a) => new Date(a.appointment_date) > new Date());

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Physiotherapy Dashboard</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{todayAppts.length}</span>
          <span className={styles.statLabel}>Today's Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{upcoming.length}</span>
          <span className={styles.statLabel}>Upcoming Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{appointments.length}</span>
          <span className={styles.statLabel}>Total Appointments</span>
        </div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>Today's Sessions</div>
        <table className={styles.table}>
          <thead>
            <tr><th>Time</th><th>Patient</th><th>MRN</th><th>Type</th><th>Status</th></tr>
          </thead>
          <tbody>
            {todayAppts.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{a.patient_first_name} {a.patient_last_name}</td>
                <td className={styles.mono}>{a.mrn ?? '—'}</td>
                <td>{a.appointment_type ?? 'Physio'}</td>
                <td><span className={`${styles.badge} ${styles[`status_${a.status}`] ?? ''}`}>{a.status ?? 'SCHEDULED'}</span></td>
              </tr>
            ))}
            {todayAppts.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>No sessions today.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
