import { useEffect, useState, useCallback, useRef } from 'react';
import styles from './AuditLogViewer.module.scss';

const ROLES = [
  'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','PHARMACIST',
  'LAB_TECHNICIAN','RADIOLOGIST','ANESTHETIST','PHYSIOTHERAPIST',
  'INVENTORY_MANAGER','BILLING_STAFF','HR_MANAGER','IT_ADMIN',
  'SECURITY','PATIENT','CAREGIVER','INSURANCE_OFFICER','AUDITOR',
];

function DiffView({ prev, next }) {
  const parse = (v) => {
    if (!v) return {};
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return {}; }
  };
  const p = parse(prev);
  const n = parse(next);
  const keys = [...new Set([...Object.keys(p), ...Object.keys(n)])];

  if (!keys.length) return <span className={styles.noData}>No diff data</span>;

  return (
    <table className={styles.diffTable}>
      <thead>
        <tr><th>Field</th><th>Before</th><th>After</th></tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const changed = JSON.stringify(p[k]) !== JSON.stringify(n[k]);
          return (
            <tr key={k} className={changed ? styles.diffChanged : ''}>
              <td className={styles.diffKey}>{k}</td>
              <td className={styles.diffPrev}>{p[k] !== undefined ? JSON.stringify(p[k]) : '—'}</td>
              <td className={styles.diffNext}>{n[k] !== undefined ? JSON.stringify(n[k]) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AuditLogViewer() {
  const [rows, setRows]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(null);
  const [verifyMap, setVerifyMap] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [filters, setFilters]     = useState({
    role: '', action: '', dateFrom: '', dateTo: '', entity: '',
  });
  const limit = 50;
  const abortRef = useRef(null);

  const fetchLogs = useCallback(async (p = 1) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit });
      if (filters.role)     params.set('role',     filters.role);
      if (filters.action)   params.set('action',   filters.action);
      if (filters.entity)   params.set('entity',   filters.entity);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo)   params.set('dateTo',   filters.dateTo);

      const res = await fetch(`/api/admin/audit-logs?${params}`, {
        credentials: 'include',
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/admin/audit-logs/verify', { credentials: 'include' });
      const data = await res.json();
      const map = {};
      (data.results ?? []).forEach((r) => { map[r.id] = r.intact; });
      setVerifyMap(map);
    } catch (e) {
      console.error(e);
    } finally {
      setVerifying(false);
    }
  };

  const exportCsv = () => {
    const header = ['id','user','action','entity','entity_id','ip','created_at'];
    const csvRows = [
      header.join(','),
      ...rows.map((r) => [
        r.id,
        r.first_name ? `${r.first_name} ${r.last_name}` : r.user_id ?? '',
        r.action,
        r.entity,
        r.entity_id ?? '',
        r.ip_address ?? '',
        r.created_at,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `audit-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Audit Log Viewer</h1>
        <div className={styles.actions}>
          <button
            className={styles.verifyBtn}
            onClick={handleVerify}
            disabled={verifying}
          >
            {verifying ? 'Verifying…' : 'Verify Integrity'}
          </button>
          <button className={styles.exportBtn} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

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

        <input
          type="text"
          placeholder="Action (e.g. CREATE)"
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          aria-label="Filter by action"
        />

        <input
          type="text"
          placeholder="Entity (e.g. patients)"
          value={filters.entity}
          onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))}
          aria-label="Filter by entity"
        />

        <input
          type="datetime-local"
          value={filters.dateFrom}
          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          aria-label="Date from"
        />

        <input
          type="datetime-local"
          value={filters.dateTo}
          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          aria-label="Date to"
        />

        <button className={styles.applyBtn} onClick={() => fetchLogs(1)}>
          Apply
        </button>
      </div>

      {verifyMap && (
        <div className={styles.verifyBanner}>
          {Object.values(verifyMap).every(Boolean)
            ? '✅ All entries intact — chain verified'
            : `⚠️ Tampered entries detected (${Object.values(verifyMap).filter((v) => !v).length} rows)`}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th />
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Entity ID</th>
              <th>IP</th>
              {verifyMap && <th>Integrity</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className={styles.empty}>Loading…</td></tr>
            )}
            {!loading && !rows.length && (
              <tr><td colSpan={8} className={styles.empty}>No results</td></tr>
            )}
            {rows.map((row) => (
              <>
                <tr
                  key={row.id}
                  className={`${styles.dataRow} ${expanded === row.id ? styles.expandedRow : ''}`}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                >
                  <td className={styles.expandIcon}>
                    {expanded === row.id ? '▾' : '▸'}
                  </td>
                  <td className={styles.mono}>
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td>
                    {row.first_name
                      ? `${row.first_name} ${row.last_name}`
                      : row.user_id?.slice(0, 8) ?? 'system'}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[`a_${row.action}`] ?? ''}`}>
                      {row.action}
                    </span>
                  </td>
                  <td className={styles.mono}>{row.entity}</td>
                  <td className={styles.mono}>{row.entity_id?.slice(0, 8) ?? '—'}</td>
                  <td className={styles.mono}>{row.ip_address ?? '—'}</td>
                  {verifyMap && (
                    <td>
                      {verifyMap[row.id] === true  && <span className={styles.intact}>✓</span>}
                      {verifyMap[row.id] === false && <span className={styles.tampered}>✗ TAMPERED</span>}
                      {verifyMap[row.id] === undefined && '—'}
                    </td>
                  )}
                </tr>
                {expanded === row.id && (
                  <tr key={`${row.id}-exp`} className={styles.expandedContent}>
                    <td colSpan={verifyMap ? 8 : 7}>
                      <div className={styles.diffWrap}>
                        <div className={styles.hashInfo}>
                          <span>prev_hash: <code>{row.prev_hash?.slice(0, 16) ?? 'null'}…</code></span>
                          <span>row_hash: <code>{row.row_hash?.slice(0, 16) ?? '—'}…</code></span>
                        </div>
                        <DiffView prev={row.prev_data} next={row.next_data} />
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>← Prev</button>
          <span>Page {page} of {totalPages} ({total} total)</span>
          <button disabled={page >= totalPages} onClick={() => fetchLogs(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
