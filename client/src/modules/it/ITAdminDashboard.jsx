import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../shared/utils/api.js';
import AuditLogViewer from '../admin/AuditLogViewer.jsx';
import styles from './ITAdminDashboard.module.scss';

function StatCard({ label, value, accent }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles[accent] : ''}`}>
      <span className={styles.statValue}>{value ?? '—'}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'audit',     label: 'Audit Logs' },
];

export default function ITAdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.endsWith('/audit') ? 'audit' : 'dashboard';

  const [sessions, setSessions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/admin/sessions'),
      api.get('/admin/audit-logs', { params: { limit: 30 } }),
    ])
      .then(([s, l]) => {
        setSessions(s.data ?? []);
        setLogs(l.data.rows ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const forceLogout = async (sessionId) => {
    await api.delete(`/admin/sessions/${sessionId}`);
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  const failedLogins = logs.filter((l) => l.action === 'LOGIN_FAILED').length;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>IT Admin Dashboard</h1>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
            onClick={() => navigate(t.id === 'dashboard' ? '/it' : '/it/audit')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'audit' && <AuditLogViewer />}

      {activeTab === 'dashboard' && (
        <>
          {loading && <div className={styles.loading}>Loading…</div>}
          {error   && <div className={styles.error}>{error}</div>}
          {!loading && !error && (
            <>
              <div className={styles.statsRow}>
                <StatCard label="Active Sessions"     value={sessions.length} />
                <StatCard label="Failed Logins (log)" value={failedLogins} accent={failedLogins > 10 ? 'accentRed' : undefined} />
                <StatCard label="Audit Events"        value={logs.length} />
              </div>

              <div className={styles.grid}>
                <section className={styles.panel}>
                  <div className={styles.panelHeader}>Active Sessions ({sessions.length})</div>
                  <div className={styles.sessionList}>
                    {sessions.length === 0 && <p className={styles.empty}>No active sessions.</p>}
                    {sessions.map((s) => (
                      <div key={s.sessionId} className={styles.sessionRow}>
                        <div>
                          <span className={styles.sessionName}>{s.firstName} {s.lastName}</span>
                          <span className={styles.sessionMeta}>{s.employeeId} · {(s.roles ?? []).join(', ')}</span>
                        </div>
                        <button className={styles.logoutBtn} onClick={() => forceLogout(s.sessionId)}>
                          Force Logout
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeader}>Recent Audit Log</div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Time</th><th>User</th><th>Action</th><th>IP</th></tr>
                      </thead>
                      <tbody>
                        {logs.map((l) => (
                          <tr key={l.id}>
                            <td>{new Date(l.created_at).toLocaleTimeString()}</td>
                            <td>{l.first_name ? `${l.first_name} ${l.last_name}` : '—'}</td>
                            <td><span className={`${styles.badge} ${l.action === 'LOGIN_FAILED' ? styles.badgeRed : ''}`}>{l.action}</span></td>
                            <td className={styles.mono}>{l.ip_address ?? '—'}</td>
                          </tr>
                        ))}
                        {!logs.length && <tr><td colSpan={4} className={styles.empty}>No entries</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
