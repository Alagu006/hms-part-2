import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './DepartmentsManagement.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';

async function fetchDepartments() {
  const data = await apiFetch(`${API}/departments`);
  return Array.isArray(data) ? data : (data?.departments ?? []);
}

async function fetchStaff(departmentId) {
  const data = await apiFetch(`${API}/admin/users?department=${departmentId}&limit=100`);
  return Array.isArray(data) ? data : (data?.users ?? []);
}

async function createDepartment(body) {
  return apiFetch(`${API}/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function updateDepartment({ id, ...body }) {
  return apiFetch(`${API}/departments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ROLE_COLORS = {
  DOCTOR: '#dbeafe',
  NURSE: '#d1fae5',
  RECEPTIONIST: '#fef3c7',
  LAB_TECH: '#ede9fe',
  PHARMACIST: '#fce7f3',
  ADMIN: '#fee2e2',
  SUPER_ADMIN: '#fee2e2',
  HR: '#ffedd5',
  IT_ADMIN: '#e0f2fe',
  BILLING: '#f0fdf4',
  INVENTORY: '#fdf4ff',
  SECURITY_OFC: '#f1f5f9',
  RADIOLOGIST: '#ecfdf5',
  ANESTHETIST: '#fef9c3',
  DIETITIAN: '#f0fdfa',
  PHYSIO: '#fff7ed',
  SOCIAL_WORKER: '#fdf2f8',
  ORDERLY: '#f8fafc',
};

function RoleBadge({ role }) {
  const bg = ROLE_COLORS[role] ?? '#f3f4f6';
  return (
    <span className={styles.roleBadge} style={{ background: bg }}>
      {role?.replace(/_/g, ' ')}
    </span>
  );
}

function StaffPanel({ department }) {
  const { data: staff = [], isLoading, isError } = useQuery({
    queryKey: ['dept-staff', department.id],
    queryFn: () => fetchStaff(department.id),
    staleTime: 30_000,
  });

  return (
    <div className={styles.staffPanel}>
      <div className={styles.staffHeader}>
        <div>
          <h2 className={styles.staffTitle}>{department.name}</h2>
          {department.description && (
            <p className={styles.staffDesc}>{department.description}</p>
          )}
        </div>
        {!isLoading && (
          <span className={styles.staffCount}>{staff.length} staff</span>
        )}
      </div>

      {isLoading ? (
        <div className={styles.staffLoading}>
          {[...Array(4)].map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : isError ? (
        <p className={styles.empty}>Failed to load staff.</p>
      ) : staff.length === 0 ? (
        <p className={styles.empty}>No staff assigned to this department.</p>
      ) : (
        <div className={styles.staffGrid}>
          {staff.map(u => (
            <div key={u.id} className={styles.staffCard}>
              <div className={styles.staffAvatar}>
                {u.first_name?.[0]}{u.last_name?.[0]}
              </div>
              <div className={styles.staffInfo}>
                <span className={styles.staffName}>
                  {u.first_name} {u.last_name}
                </span>
                <span className={styles.staffEmpId}>{u.employee_id}</span>
                <div className={styles.staffRoles}>
                  {(u.roles ?? []).map(r => <RoleBadge key={r} role={r} />)}
                </div>
              </div>
              <span className={`${styles.statusDot} ${u.is_active ? styles.active : styles.inactive}`}
                title={u.is_active ? 'Active' : 'Inactive'} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DepartmentsManagement() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState({ msg: '', type: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  });

  const createMutation = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setForm({ name: '', description: '' });
      setShowForm(false);
      showToast('Department created.', 'success');
    },
    onError: () => showToast('Failed to create department.', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: updateDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setEditing(null);
      showToast('Department updated.', 'success');
    },
    onError: () => showToast('Failed to update department.', 'error'),
  });

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: '' }), 3000);
  }

  const handleCreate = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate(form);
  };

  const handleUpdate = e => {
    e.preventDefault();
    if (!editing?.name?.trim()) return;
    updateMutation.mutate(editing);
  };

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setEdit = k => e => setEditing(ed => ({ ...ed, [k]: e.target.value }));

  return (
    <div className={styles.page}>
      {toast.msg && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess}`}>
          {toast.msg}
        </div>
      )}

      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Departments</h1>
        <button className={styles.addBtn} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add Department'}
        </button>
      </div>

      {/* Add form (collapsible) */}
      {showForm && (
        <div className={styles.formCard}>
          <form className={styles.form} onSubmit={handleCreate}>
            <label className={styles.label}>
              Name
              <input
                type="text"
                value={form.name}
                onChange={set('name')}
                placeholder="e.g. Cardiology"
                required
                autoFocus
              />
            </label>
            <label className={styles.label}>
              Description
              <input
                type="text"
                value={form.description}
                onChange={set('description')}
                placeholder="Optional description"
              />
            </label>
            <button type="submit" className={styles.submitBtn} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Add Department'}
            </button>
          </form>
        </div>
      )}

      {/* Main two-panel layout */}
      <div className={styles.layout}>
        {/* Left: department list */}
        <aside className={styles.deptList}>
          {isLoading ? (
            [...Array(5)].map((_, i) => <div key={i} className={styles.skeleton} style={{ height: 56 }} />)
          ) : departments.length === 0 ? (
            <p className={styles.empty}>No departments yet.</p>
          ) : (
            departments.map(d => (
              <div
                key={d.id}
                className={`${styles.deptItem} ${selected?.id === d.id ? styles.deptItemActive : ''}`}
                onClick={() => setSelected(d)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelected(d)}
                aria-pressed={selected?.id === d.id}
              >
                <div className={styles.deptItemMain}>
                  <span className={styles.deptItemName}>{d.name}</span>
                  {d.description && (
                    <span className={styles.deptItemDesc}>{d.description}</span>
                  )}
                </div>
                <button
                  className={styles.editIconBtn}
                  onClick={e => {
                    e.stopPropagation();
                    setEditing({ id: d.id, name: d.name, description: d.description ?? '' });
                  }}
                  aria-label={`Edit ${d.name}`}
                  title="Edit"
                >
                  ✎
                </button>
              </div>
            ))
          )}
        </aside>

        {/* Right: staff panel */}
        <div className={styles.staffPanelWrap}>
          {selected ? (
            <StaffPanel department={selected} />
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🏥</span>
              <p>Select a department to view its staff</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Edit department">
          <div className={styles.dialog}>
            <h3 className={styles.dialogTitle}>Edit Department</h3>
            <form className={styles.form} onSubmit={handleUpdate}>
              <label className={styles.label}>
                Name
                <input type="text" value={editing.name} onChange={setEdit('name')} required autoFocus />
              </label>
              <label className={styles.label}>
                Description
                <input type="text" value={editing.description} onChange={setEdit('description')} />
              </label>
              <div className={styles.dialogActions}>
                <button type="submit" className={styles.submitBtn} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={styles.cancelBtn} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
