import { useEffect, useState, useCallback } from 'react';
import styles from './UserManagement.module.scss';

const ROLES = [
  'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','PHARMACIST',
  'LAB_TECHNICIAN','RADIOLOGIST','ANESTHETIST','PHYSIOTHERAPIST',
  'INVENTORY_MANAGER','BILLING_STAFF','HR_MANAGER','IT_ADMIN',
  'SECURITY','PATIENT','CAREGIVER','INSURANCE_OFFICER','AUDITOR',
];

const ROLE_COLORS = {
  SUPER_ADMIN: '#7c3aed', ADMIN: '#6366f1', DOCTOR: '#0891b2',
  NURSE: '#0d9488', RECEPTIONIST: '#d97706', PHARMACIST: '#16a34a',
  PATIENT: '#6b7280',
};

function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] ?? '#6b7280';
  return (
    <span
      className={styles.roleBadge}
      style={{ background: `${color}18`, color }}
    >
      {role}
    </span>
  );
}

export default function UserManagement() {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState(null);
  const [sessions, setSessions]   = useState([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [toggling, setToggling]   = useState(null);
  const [filters, setFilters]     = useState({ role: '', status: '' });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (filters.role)   params.set('role',   filters.role);
      if (filters.status) params.set('status', filters.status);
      const res = await fetch(`/api/admin/users?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch users');
      setUsers(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openPanel = async (user) => {
    setSelected(user);
    setSessLoading(true);
    try {
      const res = await fetch('/api/admin/sessions', { credentials: 'include' });
      const all = await res.json();
      setSessions(all.filter((s) => s.userId === user.id));
    } catch { setSessions([]); }
    finally { setSessLoading(false); }
  };

  const toggleStatus = async (user) => {
    setToggling(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method     : 'PATCH',
        credentials: 'include',
        headers    : { 'Content-Type': 'application/json' },
        body       : JSON.stringify({ isActive: !user.is_active }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, is_active: !u.is_active } : u)
      );
      if (selected?.id === user.id) {
        setSelected((s) => ({ ...s, is_active: !s.is_active }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setToggling(null);
    }
  };

  const forceLogout = async (sessionId) => {
    await fetch(`/api/admin/sessions/${sessionId}`, {
      method: 'DELETE', credentials: 'include',
    });
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>User Management</h1>

      {/* Filters */}
      <div className={styles.filters}>
        <select
          value={filters.role}
          onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}
          aria-label="Filter by role"
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          aria-label="Filter by status"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className={styles.layout}>
        {/* User table */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee ID</th>
                <th>Roles</th>
                <th>Department</th>
                <th>Last Login</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className={styles.empty}>Loading…</td></tr>
              )}
              {!loading && !users.length && (
                <tr><td colSpan={7} className={styles.empty}>No users found</td></tr>
              )}
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={`${styles.row} ${selected?.id === u.id ? styles.selectedRow : ''}`}
                  onClick={() => openPanel(u)}
                >
                  <td className={styles.nameCell}>
                    <span className={styles.avatar}>
                      {u.first_name?.[0]}{u.last_name?.[0]}
                    </span>
                    {u.first_name} {u.last_name}
                  </td>
                  <td className={styles.mono}>{u.employee_id}</td>
                  <td>
                    <div className={styles.roleList}>
                      {(u.roles ?? []).map((r) => <RoleBadge key={r} role={r} />)}
                    </div>
                  </td>
                  <td>{u.department_name ?? '—'}</td>
                  <td className={styles.mono}>
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td>
                    <span className={u.is_active ? styles.statusActive : styles.statusInactive}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className={u.is_active ? styles.deactivateBtn : styles.activateBtn}
                      onClick={() => toggleStatus(u)}
                      disabled={toggling === u.id}
                      aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.first_name}`}
                    >
                      {toggling === u.id ? '…' : u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Side panel */}
        {selected && (
          <aside className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelAvatar}>
                {selected.first_name?.[0]}{selected.last_name?.[0]}
              </div>
              <div>
                <div className={styles.panelName}>
                  {selected.first_name} {selected.last_name}
                </div>
                <div className={styles.panelId}>{selected.employee_id}</div>
              </div>
              <button
                className={styles.closeBtn}
                onClick={() => setSelected(null)}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.detailRow}>
                <span>Department</span>
                <span>{selected.department_name ?? '—'}</span>
              </div>
              <div className={styles.detailRow}>
                <span>Status</span>
                <span className={selected.is_active ? styles.statusActive : styles.statusInactive}>
                  {selected.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className={styles.detailRow}>
                <span>Last Login</span>
                <span>
                  {selected.last_login_at
                    ? new Date(selected.last_login_at).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div className={styles.detailRow}>
                <span>Joined</span>
                <span>{new Date(selected.created_at).toLocaleDateString()}</span>
              </div>

              <div className={styles.rolesSection}>
                <span className={styles.sectionLabel}>Roles</span>
                <div className={styles.roleList}>
                  {(selected.roles ?? []).map((r) => <RoleBadge key={r} role={r} />)}
                </div>
              </div>

              <div className={styles.sessionsSection}>
                <span className={styles.sectionLabel}>
                  Active Sessions ({sessions.length})
                </span>
                {sessLoading && <p className={styles.empty}>Loading…</p>}
                {!sessLoading && !sessions.length && (
                  <p className={styles.empty}>No active sessions</p>
                )}
                {sessions.map((s) => (
                  <div key={s.sessionId} className={styles.sessionRow}>
                    <span className={styles.mono}>{s.sessionId.slice(0, 16)}…</span>
                    <button
                      className={styles.logoutBtn}
                      onClick={() => forceLogout(s.sessionId)}
                    >
                      Logout
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
