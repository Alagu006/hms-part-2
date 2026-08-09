import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './ShiftsManagement.module.scss';

const ROLES = [
  'DOCTOR','NURSE','RECEPTIONIST','LAB_TECH','PHARMACIST',
  'INVENTORY','BILLING','SECURITY_OFC','ORDERLY','DIETITIAN',
  'PHYSIO','RADIOLOGIST','ANESTHETIST','SOCIAL_WORKER',
];

async function fetchShifts(params = {}) {
  const q = new URLSearchParams(params).toString();
  const data = await apiFetch(`/shifts?${q}`);
  return data?.shifts ?? data ?? [];
}

async function fetchUsers(search, role) {
  const params = new URLSearchParams({ limit: 30 });
  if (search) params.set('search', search);
  if (role)   params.set('role', role);
  const data = await apiFetch(`/admin/users?${params}`);
  // endpoint returns a plain array
  return Array.isArray(data) ? data : (data?.users ?? []);
}

async function createShift(body) {
  return apiFetch(`/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteShift(id) {
  return apiFetch(`/shifts/${id}`, { method: 'DELETE' });
}

function formatTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

// ── Searchable user picker ────────────────────────────────────────────────────
function UserPicker({ value, displayName, role, onChange }) {
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(false);
  const [inputVal, setInputVal] = useState(displayName ?? '');
  const wrapRef = useRef(null);

  // sync display when form resets
  useEffect(() => { if (!value) setInputVal(''); }, [value]);

  // close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: users = [], isFetching } = useQuery({
    queryKey: ['user-search', search, role],
    queryFn: () => fetchUsers(search, role),
    enabled: open,
    staleTime: 10_000,
    placeholderData: prev => prev,
  });

  function select(user) {
    const name = `${user.first_name ?? user.firstName} ${user.last_name ?? user.lastName}`;
    setInputVal(name);
    setSearch('');
    setOpen(false);
    onChange(user.id, name);
  }

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        type="text"
        className={styles.pickerInput}
        placeholder="Search staff by name…"
        value={open ? search : inputVal}
        onFocus={() => setOpen(true)}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        autoComplete="off"
        required={!value}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {value && !open && (
        <button
          type="button"
          className={styles.pickerClear}
          onClick={() => { setInputVal(''); setSearch(''); onChange('', ''); }}
          aria-label="Clear selection"
        >×</button>
      )}
      {open && (
        <ul className={styles.pickerDropdown} role="listbox">
          {isFetching && <li className={styles.pickerHint}>Searching…</li>}
          {!isFetching && users.length === 0 && (
            <li className={styles.pickerHint}>No staff found.</li>
          )}
          {users.map(u => (
            <li
              key={u.id}
              role="option"
              aria-selected={u.id === value}
              className={`${styles.pickerOption} ${u.id === value ? styles.pickerSelected : ''}`}
              onMouseDown={() => select(u)}
            >
              <span className={styles.pickerName}>
                {u.first_name ?? u.firstName} {u.last_name ?? u.lastName}
              </span>
              <span className={styles.pickerMeta}>
                {u.employee_id ?? u.employeeId} · {u.roles?.[0] ?? u.role ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ShiftsManagement() {
  const queryClient = useQueryClient();
  const [filterRole, setFilterRole] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [form, setForm] = useState({
    userId: '', userDisplayName: '', role: '', shiftDate: '', startTime: '', endTime: '', notes: '',
  });
  const [toast, setToast] = useState({ msg: '', type: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const params = {};
  if (filterRole) params.role = filterRole;
  if (filterDate) params.date = filterDate;

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts', filterRole, filterDate],
    queryFn: () => fetchShifts(params),
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: createShift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setForm({ userId: '', userDisplayName: '', role: '', shiftDate: '', startTime: '', endTime: '', notes: '' });
      showToast('Shift created.', 'success');
    },
    onError: () => showToast('Failed to create shift.', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteShift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setConfirmDelete(null);
      showToast('Shift deleted.', 'success');
    },
    onError: () => showToast('Failed to delete shift.', 'error'),
  });

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: '' }), 3000);
  }

  const handleSubmit = e => {
    e.preventDefault();
    const { userId, role, shiftDate, startTime, endTime } = form;
    if (!userId || !role || !shiftDate || !startTime || !endTime) return;
    createMutation.mutate({ userId, role, shiftDate, startTime, endTime, notes: form.notes });
  };

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className={styles.page}>
      {toast.msg && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.msg}
        </div>
      )}

      <h1 className={styles.title}>Shifts Management</h1>

      <div className={styles.layout}>
        {/* Create form */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Create Shift</h2>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              Staff Member
              <UserPicker
                value={form.userId}
                displayName={form.userDisplayName}
                role={form.role || undefined}
                onChange={(id, name) => setForm(f => ({ ...f, userId: id, userDisplayName: name }))}
              />
            </label>

            <label className={styles.label}>
              Role
              <select value={form.role} onChange={set('role')} required>
                <option value="">Select role…</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className={styles.label}>
              Shift Date
              <input type="date" value={form.shiftDate} onChange={set('shiftDate')} required />
            </label>

            <div className={styles.row}>
              <label className={styles.label}>
                Start Time
                <input type="time" value={form.startTime} onChange={set('startTime')} required />
              </label>
              <label className={styles.label}>
                End Time
                <input type="time" value={form.endTime} onChange={set('endTime')} required />
              </label>
            </div>

            <label className={styles.label}>
              Notes (optional)
              <input
                type="text"
                value={form.notes}
                onChange={set('notes')}
                placeholder="Any notes…"
              />
            </label>

            <button type="submit" className={styles.submitBtn} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Create Shift'}
            </button>
          </form>
        </section>

        {/* Shifts list */}
        <section className={styles.card}>
          <div className={styles.listHeader}>
            <h2 className={styles.cardTitle}>Shifts</h2>
            <div className={styles.filters}>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
              />
            </div>
          </div>

          {isLoading ? (
            <p className={styles.loading}>Loading…</p>
          ) : shifts.length === 0 ? (
            <p className={styles.empty}>No shifts found.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role</th>
                    <th>Date</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map(s => (
                    <tr key={s.id}>
                      <td>{s.first_name ?? s.firstName ?? '—'} {s.last_name ?? s.lastName ?? ''}</td>
                      <td><span className={styles.roleBadge}>{s.role}</span></td>
                      <td>{s.shift_date ?? s.shiftDate}</td>
                      <td>{formatTime(s.start_time ?? s.startTime)}</td>
                      <td>{formatTime(s.end_time ?? s.endTime)}</td>
                      <td className={styles.notes}>{s.notes ?? '—'}</td>
                      <td>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => setConfirmDelete(s.id)}
                          aria-label="Delete shift"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.dialog}>
            <p>Delete this shift?</p>
            <div className={styles.dialogActions}>
              <button
                className={styles.confirmBtn}
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button className={styles.cancelBtn} onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
