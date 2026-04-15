import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import api from '../../shared/utils/api.js';
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
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
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

function FlagModal({ row, onClose, onFlagged }) {
  const [reason, setReason] = useState(row.flag_reason ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/admin/audit-logs/${row.id}/flag`, { reason });
      onFlagged(data);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Flag Audit Entry</h3>
        <p className={styles.modalSub}>
          {row.action} · {row.entity} · {new Date(row.created_at).toLocaleString()}
        </p>
        <textarea
          className={styles.modalTextarea}
          placeholder="Reason for flagging (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.flagSubmitBtn} onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Flag Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockIpModal({ ip, onClose, onBlocked }) {
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/admin/blocked-ips', {
        ipAddress: ip,
        reason: reason || undefined,
        expiresAt: expiresAt || undefined,
      });
      onBlocked(data);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Block IP Address</h3>
        <p className={styles.modalSub}>{ip}</p>
        <input
          className={styles.modalInput}
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label className={styles.modalLabel}>Expires at (leave blank for permanent)</label>
        <input
          type="datetime-local"
          className={styles.modalInput}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.blockSubmitBtn} onClick={submit} disabled={saving}>
            {saving ? 'Blocking…' : 'Block IP'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockedIpsPanel() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addIp, setAddIp]     = useState('');
  const [addReason, setAddReason] = useState('');
  const [addExpires, setAddExpires] = useState('');
  const [adding, setAdding]   = useState(false);
  const [unblocking, setUnblocking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/blocked-ips');
      setList(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitBlock = async () => {
    if (!addIp.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post('/admin/blocked-ips', {
        ipAddress: addIp.trim(),
        reason: addReason || undefined,
        expiresAt: addExpires || undefined,
      });
      setList((prev) => [data, ...prev]);
      setShowAdd(false);
      setAddIp(''); setAddReason(''); setAddExpires('');
    } catch (e) { console.error(e); }
    finally { setAdding(false); }
  };

  const unblock = async (id) => {
    setUnblocking(id);
    try {
      await api.delete(`/admin/blocked-ips/${id}`);
      setList((prev) => prev.map((r) => r.id === id ? { ...r, unblocked_at: new Date().toISOString() } : r));
    } finally {
      setUnblocking(null);
    }
  };

  const active   = list.filter((r) => !r.unblocked_at);
  const inactive = list.filter((r) => r.unblocked_at);

  return (
    <div className={styles.blockedPanel}>
      <div className={styles.blockedHeader}>
        <span>Blocked IP Addresses ({active.length} active)</span>
        <button className={styles.addBlockBtn} onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Block IP'}
        </button>
      </div>

      {showAdd && (
        <div className={styles.addBlockForm}>
          <input
            className={styles.addBlockInput}
            placeholder="IP address (e.g. 192.168.1.1)"
            value={addIp}
            onChange={(e) => setAddIp(e.target.value)}
          />
          <input
            className={styles.addBlockInput}
            placeholder="Reason (optional)"
            value={addReason}
            onChange={(e) => setAddReason(e.target.value)}
          />
          <input
            type="datetime-local"
            className={styles.addBlockInput}
            title="Expires at (leave blank for permanent)"
            value={addExpires}
            onChange={(e) => setAddExpires(e.target.value)}
          />
          <button className={styles.blockSubmitBtn} onClick={submitBlock} disabled={adding || !addIp.trim()}>
            {adding ? 'Blocking…' : 'Block'}
          </button>
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>IP Address</th><th>Reason</th><th>Blocked By</th>
                <th>Blocked At</th><th>Expires</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {!list.length && (
                <tr><td colSpan={7} className={styles.empty}>No blocked IPs</td></tr>
              )}
              {active.map((r) => (
                <tr key={r.id}>
                  <td className={styles.mono}>{r.ip_address}</td>
                  <td>{r.reason ?? '—'}</td>
                  <td>{r.blocked_by_name ?? '—'}</td>
                  <td className={styles.mono}>{new Date(r.blocked_at).toLocaleString()}</td>
                  <td className={styles.mono}>{r.expires_at ? new Date(r.expires_at).toLocaleString() : 'Permanent'}</td>
                  <td><span className={styles.badgeBlocked}>Blocked</span></td>
                  <td>
                    <button className={styles.unblockBtn} onClick={() => unblock(r.id)} disabled={unblocking === r.id}>
                      {unblocking === r.id ? '…' : 'Unblock'}
                    </button>
                  </td>
                </tr>
              ))}
              {inactive.map((r) => (
                <tr key={r.id} className={styles.rowUnblocked}>
                  <td className={styles.mono}>{r.ip_address}</td>
                  <td>{r.reason ?? '—'}</td>
                  <td>{r.blocked_by_name ?? '—'}</td>
                  <td className={styles.mono}>{new Date(r.blocked_at).toLocaleString()}</td>
                  <td className={styles.mono}>{r.expires_at ? new Date(r.expires_at).toLocaleString() : 'Permanent'}</td>
                  <td><span className={styles.badgeUnblocked}>Unblocked</span></td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AuditLogViewer() {
  const [rows, setRows]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [flagModal, setFlagModal] = useState(null);   // row to flag
  const [blockModal, setBlockModal] = useState(null); // ip to block
  const [filters, setFilters]     = useState({
    role: '', action: '', dateFrom: '', dateTo: '', entity: '', flagged: '',
  });
  const limit = 50;
  const abortRef = useRef(null);

  const fetchLogs = useCallback(async (p = 1) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = { page: p, limit };
      if (filters.role)     params.role     = filters.role;
      if (filters.action)   params.action   = filters.action;
      if (filters.entity)   params.entity   = filters.entity;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo)   params.dateTo   = filters.dateTo;
      if (filters.flagged)  params.flagged  = filters.flagged;

      const { data } = await api.get('/admin/audit-logs', {
        params,
        signal: abortRef.current.signal,
      });
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch (e) {
      if (e.name !== 'AbortError' && e.name !== 'CanceledError') console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data } = await api.get('/admin/audit-logs/verify');
      setVerifyResult(data);
    } catch {
      setVerifyResult({ error: true });
    } finally {
      setVerifying(false);
    }
  };

  const handleUnflag = async (row) => {
    try {
      await api.patch(`/admin/audit-logs/${row.id}/unflag`);
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, flagged: false, flag_reason: null } : r));
    } catch (e) { console.error(e); }
  };

  const exportCsv = () => {
    const header = ['id','user','action','entity','entity_id','ip','flagged','flag_reason','created_at'];
    const csvRows = [
      header.join(','),
      ...rows.map((r) => [
        r.id,
        r.first_name ? `${r.first_name} ${r.last_name}` : r.user_id ?? '',
        r.action,
        r.entity,
        r.entity_id ?? '',
        r.ip_address ?? '',
        r.flagged ? 'YES' : '',
        r.flag_reason ?? '',
        r.created_at,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `audit-logs-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Audit Log Viewer</h1>
        <div className={styles.actions}>
          <button className={styles.verifyBtn} onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify Integrity'}
          </button>
          <button className={styles.exportBtn} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <select value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))} aria-label="Filter by role">
          <option value="">All Roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input type="text" placeholder="Action (e.g. CREATE)" value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} aria-label="Filter by action" />
        <input type="text" placeholder="Entity (e.g. patients)" value={filters.entity}
          onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))} aria-label="Filter by entity" />
        <input type="datetime-local" value={filters.dateFrom}
          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} aria-label="Date from" />
        <input type="datetime-local" value={filters.dateTo}
          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} aria-label="Date to" />
        <select value={filters.flagged} onChange={(e) => setFilters((f) => ({ ...f, flagged: e.target.value }))} aria-label="Filter flagged">
          <option value="">All Entries</option>
          <option value="true">Flagged Only</option>
          <option value="false">Unflagged Only</option>
        </select>
        <button className={styles.applyBtn} onClick={() => fetchLogs(1)}>Apply</button>
      </div>

      {verifyResult && !verifyResult.error && verifyResult.valid && (
        <div className={styles.verifyBannerGreen}>Chain valid — {verifyResult.totalChecked} records verified</div>
      )}
      {verifyResult && !verifyResult.error && !verifyResult.valid && (
        <div className={styles.verifyBannerRed}>Tampered record detected at ID: {verifyResult.firstTamperedId}</div>
      )}
      {verifyResult && verifyResult.error && (
        <div className={styles.verifyBannerAmber}>Verification failed — try again</div>
      )}

      <div className={styles.splitLayout}>
      <div className={styles.logsCol}>
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
              <th>Flag</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className={styles.empty}>Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={9} className={styles.empty}>No results</td></tr>}
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={`${styles.dataRow} ${expanded === row.id ? styles.expandedRow : ''} ${row.flagged ? styles.flaggedRow : ''}`}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                >
                  <td className={styles.expandIcon}>{expanded === row.id ? '▾' : '▸'}</td>
                  <td className={styles.mono}>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.first_name ? `${row.first_name} ${row.last_name}` : row.user_id?.slice(0, 8) ?? 'system'}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[`a_${row.action}`] ?? ''}`}>{row.action}</span>
                  </td>
                  <td className={styles.mono}>{row.entity}</td>
                  <td className={styles.mono}>{row.entity_id?.slice(0, 8) ?? '—'}</td>
                  <td className={styles.mono}>
                    {row.ip_address ? (
                      <span className={styles.ipCell}>
                        {row.ip_address}
                        <button
                          className={styles.blockIpBtn}
                          title="Block this IP"
                          onClick={(e) => { e.stopPropagation(); setBlockModal(row.ip_address); }}
                        >🚫</button>
                      </span>
                    ) : '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {row.flagged ? (
                      <span className={styles.flaggedBadge} title={row.flag_reason ?? ''}>
                        🚩
                        <button className={styles.unflagBtn} onClick={() => handleUnflag(row)}>✕</button>
                      </span>
                    ) : (
                      <button className={styles.flagBtn} onClick={() => setFlagModal(row)}>Flag</button>
                    )}
                  </td>
                  <td />
                </tr>
                {expanded === row.id && (
                  <tr key={`${row.id}-exp`} className={styles.expandedContent}>
                    <td colSpan={9}>
                      <div className={styles.diffWrap}>
                        {row.flagged && (
                          <div className={styles.flagInfo}>
                            🚩 Flagged{row.flagged_by_first ? ` by ${row.flagged_by_first} ${row.flagged_by_last}` : ''}
                            {row.flagged_at ? ` at ${new Date(row.flagged_at).toLocaleString()}` : ''}
                            {row.flag_reason ? ` — ${row.flag_reason}` : ''}
                          </div>
                        )}
                        <div className={styles.hashInfo}>
                          <span>prev_hash: <code>{row.prev_hash?.slice(0, 16) ?? 'null'}…</code></span>
                          <span>row_hash: <code>{row.row_hash?.slice(0, 16) ?? '—'}…</code></span>
                        </div>
                        <DiffView prev={row.prev_data} next={row.next_data} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>← Prev</button>
          <span>Page {page} of {totalPages} ({total} total)</span>
          <button disabled={page >= totalPages} onClick={() => fetchLogs(page + 1)}>Next →</button>
        </div>
      )}
      </div>{/* end logsCol */}

      <div className={styles.ipCol}>
        <BlockedIpsPanel />
      </div>
      </div>{/* end splitLayout */}

      {flagModal && (
        <FlagModal
          row={flagModal}
          onClose={() => setFlagModal(null)}
          onFlagged={(updated) => {
            setRows((prev) => prev.map((r) => r.id === updated.id ? { ...r, ...updated } : r));
          }}
        />
      )}

      {blockModal && (
        <BlockIpModal
          ip={blockModal}
          onClose={() => setBlockModal(null)}
          onBlocked={() => {}}
        />
      )}
    </div>
  );
}
