import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../shared/utils/api.js';
import SkeletonLoader from '../../shared/components/SkeletonLoader.jsx';
import StatCard from '../../shared/components/StatCard.jsx';
import PageHeader from '../../shared/components/PageHeader.jsx';
import styles from './AdminDashboard.module.scss';

export default function AdminDashboard() {
  const [stats, setStats]       = useState(null);
  const [logs, setLogs]         = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, l, sess] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/audit-logs', { params: { limit: 20 } }),
        api.get('/admin/sessions'),
      ]);
      setStats(s.data);
      setLogs(l.data.rows ?? []);
      setSessions(sess.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();

    const socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 10,
    });
    socket.on('audit:new', (entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 20));
    });
    socket.on('connect_error', () => { /* silent in dev */ });
    return () => socket.disconnect();
  }, [fetchAll]);

  const forceLogout = async (sessionId) => {
    await api.delete(`/admin/sessions/${sessionId}`);
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  if (loading) return <SkeletonLoader variant="page" />;
  if (error)   return <div className={styles.error}>{error}</div>;

  const occupancyPct = stats.bedOccupancy.total
    ? Math.round((stats.bedOccupancy.occupied / stats.bedOccupancy.total) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <PageHeader title="Admin Dashboard" badge="LIVE" badgeColor="green" />

      {/* Stats row — animated StatCards with count-up */}
      <div className={styles.statsRow}>
        <StatCard
          label="Today's Admissions"
          value={stats.todayAdmissions}
          icon="🏥"
          status="blue"
          delay={0}
        />
        <StatCard
          label="Bed Occupancy"
          value={stats.bedOccupancy.occupied}
          suffix={'/' + stats.bedOccupancy.total}
          sub={occupancyPct + '% occupied'}
          icon="🛏️"
          status={occupancyPct > 85 ? 'red' : 'green'}
          delay={0.05}
        />
        <StatCard
          label="Pending Revenue"
          value={stats.pendingRevenue}
          prefix="₹"
          sub={stats.pendingBills + ' unpaid bills'}
          icon="💰"
          status="amber"
          delay={0.1}
        />
        <StatCard
          label="Active Users"
          value={stats.activeUsers}
          icon="👥"
          status="teal"
          delay={0.15}
        />
        <StatCard
          label="Failed Logins (24h)"
          value={stats.failedLogins24h}
          icon="🔒"
          status={stats.failedLogins24h > 20 ? 'red' : 'blue'}
          delay={0.2}
        />
      </div>

      {/* Quick charts */}
      <div className={styles.chartsRow}>
        <section className={styles.chartPanel}>
          <div className={styles.panelHeader}><span>Bed Occupancy</span></div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={[
              { name: 'Occupied',  value: stats.bedOccupancy.occupied },
              { name: 'Available', value: stats.bedOccupancy.total - stats.bedOccupancy.occupied },
            ]} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #f3f4f6)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill={occupancyPct > 85 ? '#dc2626' : '#16a34a'} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className={styles.chartPanel}>
          <div className={styles.panelHeader}><span>Security Overview</span></div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={[
              { name: 'Active Users',  value: stats.activeUsers },
              { name: 'Failed Logins', value: stats.failedLogins24h },
              { name: 'Pending Bills', value: stats.pendingBills },
            ]} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #f3f4f6)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
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
                    <td>{l.first_name ? l.first_name + ' ' + l.last_name : (l.user_id?.slice(0, 8) ?? 'system')}</td>
                    <td>
                      <span className={styles.badge}>{l.action}</span>
                    </td>
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
                  <span className={styles.sessionName}>{s.firstName} {s.lastName}</span>
                  <span className={styles.sessionMeta}>
                    {s.employeeId} · {(s.roles ?? []).join(', ')}
                  </span>
                </div>
                <button
                  className={styles.logoutBtn}
                  onClick={() => forceLogout(s.sessionId)}
                  aria-label={'Force logout ' + s.firstName + ' ' + s.lastName}
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
