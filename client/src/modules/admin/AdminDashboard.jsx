import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import styles from './AdminDashboard.module.scss';

const ROLES = [
  'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','PHARMACIST',
  'LAB_TECHNICIAN','RADIOLOGIST','ANESTHETIST','PHYSIOTHERAPIST',
  'INVENTORY_MANAGER','BILLING_STAFF','HR_MANAGER','IT_ADMIN',
  'SECURITY','PATIENT','CAREGIVER','INSURANCE_OFFICER','AUDITOR',
];

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles[accent] : ''}`}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats]   = useState(null);
  const [logs, setLogs]     = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, lRes, sessRes] = await Promise.all([
        fetch('/api/admin/stats',    { credentials: 'include' }),
        fetch('/api/admin/audit-logs?limit=20', { credentials: 'include' }),
        fetch('/api/admin/sessions', { credentials: 'include' }),
      ]);
      if (!sRes.ok || !lRes.ok || !sessRes.ok) throw new Error('Failed to load admin data');
      const [s, l, sess] = await Promise.all([sRes.json(), lRes.json(), sessRes.json()]);
      setStats(s);
      setLogs(l.rows ?? []);
      setSessions(sess);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();

    // Live audit log updates via socket
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('audit:new', (entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 20));
    });
    return () => socket.disconnect();
  }, [fetchAll]);

  const forceLogout = async (sessionId) => {
    await fetch(`/api/admin/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  if (loading) return <div className={styles.loading}>Loading dashboard…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  const occupancyPct = stats.bedOccupancy.total
    ? Math.round((stats.bedOccupancy.occupied / stats.bedOccupancy.total) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Admin Dashboard</h1>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <StatCard label="Today's Admissions"  value={stats.todayAdmissions} />
        <StatCard
          label="Bed Occupancy"
          value={`${stats.bedOccupancy.occupied}/${stats.bedOccupancy.total}`}
          sub={`${occupancyPct}% occupied`}
          accent={occupancyPct > 85 ? 'accentRed' : 'accentGreen'}
        />
        <StatCard
          label="Pending Revenue"
          value={`$${stats.pendingRevenue.toLocaleString()}`}
          sub={`${stats.pendingBills} unpaid bills`}
          accent="accentYellow"
        />
        <StatCard label="Active Users"       value={stats.activeUsers} />
        <StatCard
          label="Failed Logins (24h)"
          value={stats.failedLogins24h}
          accent={stats.failedLogins24h > 20 ? 'accentRed' : undefined}
        />
      </div>

      <div className={styles.grid}>
        {/* Recent audit log */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Recent Audit Log</span>
            <span className={styles.live}>● LIVE</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.created_at).toLocaleTimeString()}</td>
                    <td>{l.first_name ? `${l.first_name} ${l.last_name}` : l.user_id?.slice(0, 8) ?? 'system'}</td>
                    <td><span className={`${styles.badge} ${styles[`action_${l.action}`] ?? ''}`}>{l.action}</span></td>
                    <td className={styles.mono}>{l.entity}</td>
                    <td className={styles.mono}>{l.ip_address ?? '—'}</td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr><td colSpan={5} className={styles.empty}>No audit entries</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Active sessions */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Active Sessions ({sessions.length})</span>
          </div>
          <div className={styles.sessionList}>
            {sessions.map((s) => (
              <div key={s.sessionId} className={styles.sessionRow}>
                <div className={styles.sessionInfo}>
                  <span className={styles.sessionName}>
                    {s.firstName} {s.lastName}
                  </span>
                  <span className={styles.sessionMeta}>
                    {s.employeeId} · {(s.roles ?? []).join(', ')}
                  </span>
                </div>
                <button
                  className={styles.logoutBtn}
                  onClick={() => forceLogout(s.sessionId)}
                  aria-label={`Force logout ${s.firstName} ${s.lastName}`}
                >
                  Logout
                </button>
              </div>
            ))}
            {!sessions.length && (
              <p className={styles.empty}>No active sessions</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
