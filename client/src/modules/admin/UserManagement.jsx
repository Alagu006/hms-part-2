import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import { useStore, getAccessToken } from '../../shared/store/index.js';
import { encryptProfileImage, decryptProfileImageToUrl } from '../../shared/utils/crypto.js';
import { storeFileKey, getFileKey } from '../../shared/utils/keyStore.js';
import styles from './UserManagement.module.scss';

const ROLES = [
  'ADMIN','DOCTOR','NURSE','RECEPTIONIST','LAB_TECH','PHARMACIST',
  'INVENTORY','RADIOLOGIST','BILLING','HR','DIETITIAN','PHYSIO',
  'ANESTHETIST','SOCIAL_WORKER','IT_ADMIN','SECURITY_OFC','ORDERLY','PATIENT',
];

const ROLE_COLORS = {
  SUPER_ADMIN: '#7c3aed', ADMIN: '#6366f1', DOCTOR: '#0891b2',
  NURSE: '#0d9488', RECEPTIONIST: '#d97706', PHARMACIST: '#16a34a',
  PATIENT: '#6b7280',
};

const DEPT_ROLES = new Set([
  'DOCTOR','NURSE','LAB_TECH','PHARMACIST','INVENTORY','RADIOLOGIST',
  'BILLING','DIETITIAN','PHYSIO','ANESTHETIST','SOCIAL_WORKER',
]);
const SPEC_ROLES = new Set(['DOCTOR','RADIOLOGIST','ANESTHETIST','PHYSIO','DIETITIAN']);
const SHIFT_ROLES = new Set(['NURSE','SECURITY_OFC','ORDERLY']);
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '',
  role: 'DOCTOR', departmentId: '',
  specialization: '', licenseNumber: '',
  dateOfBirth: '', gender: '', bloodGroup: '',
  shiftType: '', address: '', emergencyContact: '',
};

const inputStyle = { padding:'10px', border:'1px solid #d1d5db', borderRadius:4, fontSize:'1rem', width:'100%', minHeight:44 };
const labelStyle = { display:'flex', flexDirection:'column', gap:4, fontSize:'0.875rem', marginBottom:12 };

function RoleBadge({ role }) {
  const color = ROLE_COLORS[role] ?? '#6b7280';
  return (
    <span className={styles.roleBadge} style={{ background: `${color}18`, color }}>
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Profile image upload — AES-256-GCM encrypted before upload
// ---------------------------------------------------------------------------
async function uploadProfileImage(file, userId) {
  // 1. Encrypt in browser
  const arrayBuffer = await file.arrayBuffer();
  const { encryptedBlob, keyB64, ivB64 } = await encryptProfileImage(arrayBuffer);

  const form = new FormData();
  form.append('file', encryptedBlob, file.name);

  const token = getAccessToken();
  const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  const { csrfToken } = await csrfRes.json();

  // 2. Upload encrypted bytes
  const res = await fetch(`${API_BASE}/files/profile-image/${userId}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-csrf-token': csrfToken,
      'x-client-encrypted': 'true',
      'x-original-mime': file.type,
    },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Image upload failed');
  }
  const { data } = await res.json();

  // 3. Send IV to server
  await fetch(`${API_BASE}/files/profile-image/${data.id}/iv`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-csrf-token': csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ iv: ivB64 }),
  });

  // 4. Persist key to IndexedDB
  await storeFileKey(data.id, keyB64, ivB64, file.name);

  return { fileId: data.id };
}

// ---------------------------------------------------------------------------
// Profile image display — decrypt if key is available in IndexedDB
// ---------------------------------------------------------------------------
function ProfileImage({ fileId, initials, small = false }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_BASE}/files/profile-image/${fileId}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const ivB64     = res.headers.get('X-Encryption-IV');
        const encrypted = res.headers.get('X-Encrypted') === 'true';
        const mime      = res.headers.get('Content-Type') ?? 'image/jpeg';
        const buffer    = await res.arrayBuffer();

        if (encrypted && ivB64) {
          const record = await getFileKey(fileId);
          if (record?.keyB64) {
            objectUrl = await decryptProfileImageToUrl(buffer, ivB64, record.keyB64, mime);
          } else {
            return; // key not found — show initials
          }
        } else {
          const blob = new Blob([buffer], { type: mime });
          objectUrl = URL.createObjectURL(blob);
        }

        if (!cancelled) setSrc(objectUrl);
      } catch { /* fall back to initials */ }
    })();

    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId]);

  if (src) {
    return <img src={src} alt="Profile" className={small ? styles.avatarImg : styles.profileImg} />;
  }
  return small
    ? <span className={styles.avatar}>{initials}</span>
    : <div className={styles.panelAvatar}>{initials}</div>;
}

// ---------------------------------------------------------------------------
// Edit User Modal
// ---------------------------------------------------------------------------
function EditUserModal({ user, departments, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName      : user.first_name ?? '',
    lastName       : user.last_name ?? '',
    phone          : '',
    departmentId   : user.department_id ?? '',
    specialization : user.specialization ?? '',
    licenseNumber  : user.license_number ?? '',
    shiftType      : user.shift_type ?? '',
    dateOfBirth    : user.date_of_birth ?? '',
    gender         : user.gender ?? '',
    bloodGroup     : user.blood_group ?? '',
    address        : user.address ?? '',
    emergencyContact: user.emergency_contact ?? '',
  });
  const [imgFile, setImgFile]   = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const imgRef = useRef(null);

  const roles = user.roles ?? [];
  const needsDept  = roles.some(r => DEPT_ROLES.has(r));
  const needsSpec  = roles.some(r => SPEC_ROLES.has(r));
  const needsShift = roles.some(r => SHIFT_ROLES.has(r));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let profileImageFileId = undefined;

      if (imgFile) {
        const { fileId } = await uploadProfileImage(imgFile, user.id);
        profileImageFileId = fileId;
      }

      const body = { ...form };
      if (profileImageFileId) body.profileImageFileId = profileImageFileId;
      // strip empty strings
      Object.keys(body).forEach(k => { if (body[k] === '') delete body[k]; });

      const updated = await apiFetch(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved({ ...user, ...updated, profile_image_file_id: profileImageFileId ?? user.profile_image_file_id });
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'0' }}>
      <div style={{ background:'#fff',borderRadius:'16px 16px 0 0',padding:'clamp(1rem,4vw,2rem)',width:'100%',maxWidth:560,maxHeight:'92dvh',overflowY:'auto' }}>
        <h2 style={{ margin:'0 0 20px',fontSize:'1.1rem' }}>Edit User — {user.first_name} {user.last_name}</h2>
        <form onSubmit={handleSave}>

          {/* Profile image */}
          <div style={{ marginBottom:16 }}>
            <p style={{ margin:'0 0 6px',fontSize:'0.8125rem',fontWeight:600,color:'#374151' }}>Profile Photo</p>
            <div style={{ display:'flex',alignItems:'center',gap:12 }}>
              {imgFile ? (
                <img src={URL.createObjectURL(imgFile)} alt="Preview"
                  style={{ width:56,height:56,borderRadius:'50%',objectFit:'cover',border:'2px solid #e0e7ff' }} />
              ) : (
                <div style={{ width:56,height:56,borderRadius:'50%',background:'#e0e7ff',color:'#4338ca',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:'1.1rem' }}>
                  {user.first_name?.[0]}{user.last_name?.[0]}
                </div>
              )}
              <div>
                <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/webp"
                  style={{ display:'none' }}
                  onChange={e => setImgFile(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => imgRef.current?.click()}
                  style={{ padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer',fontSize:'0.8125rem' }}>
                  {imgFile ? 'Change photo' : 'Upload photo'}
                </button>
                <p style={{ margin:'4px 0 0',fontSize:'0.72rem',color:'#9ca3af' }}>
                  Encrypted client-side before upload
                </p>
              </div>
            </div>
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:12 }}>
            <label style={{ ...labelStyle, marginBottom:0 }}>
              First Name
              <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, marginBottom:0 }}>
              Last Name
              <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} style={inputStyle} />
            </label>
          </div>

          <label style={labelStyle}>
            Phone
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} placeholder="Leave blank to keep current" />
          </label>

          {needsDept && (
            <label style={labelStyle}>
              Department
              <select value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))} style={inputStyle}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}

          {needsSpec && (
            <label style={labelStyle}>
              Specialization
              <input value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))} style={inputStyle} />
            </label>
          )}

          {needsShift && (
            <label style={labelStyle}>
              Shift
              <select value={form.shiftType} onChange={e => setForm(f => ({ ...f, shiftType: e.target.value }))} style={inputStyle}>
                <option value="">Select…</option>
                {['MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}

          <div style={{ borderTop:'1px solid #f3f4f6',paddingTop:12,marginTop:4 }}>
            <p style={{ margin:'0 0 10px',fontSize:'0.75rem',fontWeight:600,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em' }}>Personal Details</p>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:12 }}>
              <label style={{ ...labelStyle, marginBottom:0 }}>
                Date of Birth
                <input type="date" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} style={inputStyle} max={new Date().toISOString().split('T')[0]} />
              </label>
              <label style={{ ...labelStyle, marginBottom:0 }}>
                Gender
                <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} style={inputStyle}>
                  <option value="">Select…</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </label>
            </div>
            <label style={labelStyle}>
              Blood Group
              <select value={form.bloodGroup} onChange={e => setForm(f => ({ ...f, bloodGroup: e.target.value }))} style={inputStyle}>
                <option value="">Unknown</option>
                {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Address
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Emergency Contact
              <input value={form.emergencyContact} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} style={inputStyle} />
            </label>
          </div>

          {error && <p style={{ color:'#ef4444',fontSize:'0.8rem',margin:'0 0 12px' }}>{error}</p>}

          <div style={{ display:'flex',gap:8,justifyContent:'flex-end',marginTop:8 }}>
            <button type="button" onClick={onClose} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding:'8px 16px',background:'#1d4ed8',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function UserManagement() {
  const { user: currentUser } = useStore();
  const isAdminOrSuper = currentUser?.roles?.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'HR');

  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [toggling, setToggling] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [filters, setFilters]   = useState({ role: '', status: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editUser, setEditUser] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (filters.role)   params.set('role', filters.role);
      if (filters.status) params.set('status', filters.status);
      const data = await apiFetch(`/admin/users?${params}`);
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    apiFetch(`/departments`).then(d => setDepartments(d?.departments ?? [])).catch(() => {});
  }, []);

  const openPanel = async (user) => {
    setSelected(user);
    setSessLoading(true);
    try {
      const data = await apiFetch(`/admin/sessions`);
      setSessions((Array.isArray(data) ? data : []).filter((s) => s.userId === user.id));
    } catch { setSessions([]); }
    finally { setSessLoading(false); }
  };

  const toggleStatus = async (user) => {
    setToggling(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !user.is_active }) });
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, is_active: !u.is_active } : u));
      if (selected?.id === user.id) setSelected((s) => ({ ...s, is_active: !s.is_active }));
    } catch (e) { console.error(e); }
    finally { setToggling(null); }
  };

  const handleDelete = async (user) => {
    setDeleting(user.id);
    try {
      await apiFetch(`/admin/users/${user.id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      if (selected?.id === user.id) setSelected(null);
    } catch (e) { console.error(e); }
    finally { setDeleting(null); setConfirmDelete(null); }
  };

  const forceLogout = async (sessionId) => {
    await apiFetch(`/admin/sessions/${sessionId}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const body = { ...createForm };
      ['departmentId','phone','specialization','licenseNumber','dateOfBirth','gender','bloodGroup','shiftType','address','emergencyContact']
        .forEach((k) => { if (!body[k]) delete body[k]; });
      await apiFetch(`/admin/users`, { method: 'POST', body: JSON.stringify(body) });
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      fetchUsers();
    } catch (e) {
      setCreateError(e.message || 'Failed to create user');
    } finally { setCreating(false); }
  };

  const handleUserSaved = (updated) => {
    setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
    if (selected?.id === updated.id) setSelected(s => ({ ...s, ...updated }));
    setEditUser(null);
  };

  const role = createForm.role;
  const needsDept  = DEPT_ROLES.has(role);
  const needsSpec  = SPEC_ROLES.has(role);
  const needsShift = SHIFT_ROLES.has(role);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>User Management</h1>

      {/* Filters */}
      <div className={styles.filters}>
        <select value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))} aria-label="Filter by role">
          <option value="">All Roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Filter by status">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button className={styles.activateBtn} onClick={() => setShowCreate(true)} style={{ marginLeft: 'auto' }}>
          + Add User
        </button>
      </div>

      {/* Edit User Modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          departments={departments}
          onClose={() => setEditUser(null)}
          onSaved={handleUserSaved}
        />
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'flex-end',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:'16px 16px 0 0',padding:'clamp(1rem,4vw,2rem)',width:'100%',maxWidth:560,maxHeight:'92dvh',overflowY:'auto' }}>
            <h2 style={{ margin:'0 0 20px',fontSize:'1.1rem' }}>Add New User</h2>
            <form onSubmit={handleCreateUser}>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:12 }}>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  First Name *
                  <input required value={createForm.firstName} onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Last Name *
                  <input required value={createForm.lastName} onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))} style={inputStyle} />
                </label>
              </div>
              <label style={labelStyle}>
                Email *
                <input required type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Phone
                <input value={createForm.phone} onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                Role *
                <select required value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value, departmentId:'', specialization:'', shiftType:'' }))} style={inputStyle}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {needsDept && (
                <label style={labelStyle}>
                  Department
                  <select value={createForm.departmentId} onChange={(e) => setCreateForm((f) => ({ ...f, departmentId: e.target.value }))} style={inputStyle}>
                    <option value="">Select department… (optional)</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}
              {needsSpec && (
                <label style={labelStyle}>
                  Specialization
                  <input value={createForm.specialization} onChange={(e) => setCreateForm((f) => ({ ...f, specialization: e.target.value }))} placeholder="e.g. Cardiology" style={inputStyle} />
                </label>
              )}
              {(needsDept || needsSpec) && (
                <label style={labelStyle}>
                  License / Registration No. <span style={{ color:'#9ca3af', fontWeight:400 }}>(optional)</span>
                  <input value={createForm.licenseNumber} onChange={(e) => setCreateForm((f) => ({ ...f, licenseNumber: e.target.value }))} placeholder="e.g. MCI-12345" style={inputStyle} />
                </label>
              )}
              {needsShift && (
                <label style={labelStyle}>
                  Default Shift
                  <select value={createForm.shiftType} onChange={(e) => setCreateForm((f) => ({ ...f, shiftType: e.target.value }))} style={inputStyle}>
                    <option value="">Select shift…</option>
                    {['MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
              <div style={{ borderTop:'1px solid #f3f4f6', paddingTop:12, marginTop:4 }}>
                <p style={{ margin:'0 0 10px', fontSize:'0.75rem', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>Personal Details</p>
                <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12,marginBottom:12 }}>
                  <label style={{ ...labelStyle, marginBottom:0 }}>
                    Date of Birth
                    <input type="date" value={createForm.dateOfBirth} onChange={(e) => setCreateForm((f) => ({ ...f, dateOfBirth: e.target.value }))} style={inputStyle} max={new Date().toISOString().split('T')[0]} />
                  </label>
                  <label style={{ ...labelStyle, marginBottom:0 }}>
                    Gender
                    <select value={createForm.gender} onChange={(e) => setCreateForm((f) => ({ ...f, gender: e.target.value }))} style={inputStyle}>
                      <option value="">Select…</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                      <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                    </select>
                  </label>
                </div>
                <label style={labelStyle}>
                  Blood Group
                  <select value={createForm.bloodGroup} onChange={(e) => setCreateForm((f) => ({ ...f, bloodGroup: e.target.value }))} style={inputStyle}>
                    <option value="">Unknown</option>
                    {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Address
                  <input value={createForm.address} onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))} placeholder="Home address" style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Emergency Contact
                  <input value={createForm.emergencyContact} onChange={(e) => setCreateForm((f) => ({ ...f, emergencyContact: e.target.value }))} placeholder="Name — Phone" style={inputStyle} />
                </label>
              </div>
              <div style={{ background:'#f3f4f6',borderRadius:4,padding:'10px 14px',marginBottom:16,fontSize:'0.8rem',color:'#6b7280' }}>
                Default password: <strong style={{ color:'#111',fontFamily:'monospace' }}>hospital@pass@12345</strong><br/>
                User will be required to change it on first login.
              </div>
              {createError && <p style={{ color:'#ef4444',fontSize:'0.8rem',margin:'0 0 12px' }}>{createError}</p>}
              <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                <button type="button" onClick={() => { setShowCreate(false); setCreateError(''); setCreateForm(EMPTY_FORM); }} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
                <button type="submit" disabled={creating} style={{ padding:'8px 16px',background:'#1d4ed8',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
                  {creating ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'flex-end',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:'16px 16px 0 0',padding:'clamp(1rem,4vw,1.75rem)',width:'100%',maxWidth:420 }}>
            <h2 style={{ margin:'0 0 8px',fontSize:'1rem' }}>Delete User</h2>
            <p style={{ margin:'0 0 20px',fontSize:'0.875rem',color:'#6b7280' }}>
              Are you sure you want to permanently delete <strong style={{ color:'#111' }}>{confirmDelete.first_name} {confirmDelete.last_name}</strong>? This cannot be undone.
            </p>
            <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={!!deleting} style={{ padding:'8px 16px',background:'#dc2626',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.layout}>
        {/* ── User table (desktop) ── */}
        <div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee ID / MRN</th>
                <th>Roles</th>
                <th>Department</th>
                <th>Last Login</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className={styles.empty}>Loading…</td></tr>}
              {!loading && !users.length && <tr><td colSpan={7} className={styles.empty}>No users found</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className={`${styles.row} ${selected?.id === u.id ? styles.selectedRow : ''}`} onClick={() => openPanel(u)}>
                  <td className={styles.nameCell}>
                    <ProfileImage
                      fileId={u.profile_image_file_id}
                      initials={`${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`}
                      small
                    />
                    {u.first_name} {u.last_name}
                  </td>
                  <td className={styles.mono}>{u.employee_id ?? (u.patient_mrn ? `MRN: ${u.patient_mrn}` : '—')}</td>
                  <td><div className={styles.roleList}>{(u.roles ?? []).map((r) => <RoleBadge key={r} role={r} />)}</div></td>
                  <td>{u.department_name ?? '—'}</td>
                  <td className={styles.mono}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                  <td><span className={u.is_active ? styles.statusActive : styles.statusInactive}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td onClick={(e) => e.stopPropagation()} style={{ display:'flex',gap:6,alignItems:'center',flexWrap:'wrap' }}>
                    {isAdminOrSuper && (
                      <button className={styles.activateBtn} onClick={() => setEditUser(u)} aria-label={`Edit ${u.first_name}`}
                        style={{ background:'#eff6ff',color:'#1d4ed8',borderColor:'#bfdbfe' }}>
                        Edit
                      </button>
                    )}
                    <button className={u.is_active ? styles.deactivateBtn : styles.activateBtn} onClick={() => toggleStatus(u)} disabled={toggling === u.id} aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.first_name}`}>
                      {toggling === u.id ? '…' : u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className={styles.deactivateBtn} onClick={() => setConfirmDelete(u)} aria-label={`Delete ${u.first_name}`} style={{ background:'#fef2f2',color:'#dc2626',borderColor:'#fecaca' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Mobile user cards ── */}
        <div className={styles.mobileList}>
          {loading && <div className={styles.empty}>Loading…</div>}
          {!loading && !users.length && <div className={styles.empty}>No users found</div>}
          {users.map((u) => (
            <div key={u.id}
              className={`${styles.userCard} ${selected?.id === u.id ? styles.selectedCard : ''}`}
              onClick={() => openPanel(u)}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && openPanel(u)}
              aria-label={`${u.first_name} ${u.last_name}`}>
              <div className={styles.userCardTop}>
                <div className={styles.nameCell}>
                  <ProfileImage fileId={u.profile_image_file_id}
                    initials={`${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`} small />
                  <span>{u.first_name} {u.last_name}</span>
                </div>
                <span className={u.is_active ? styles.statusActive : styles.statusInactive}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className={styles.userCardMeta}>
                <div className={styles.roleList}>{(u.roles ?? []).map((r) => <RoleBadge key={r} role={r} />)}</div>
                {u.department_name && <span>{u.department_name}</span>}
              </div>
              <div className={styles.userCardActions} onClick={(e) => e.stopPropagation()}>
                {isAdminOrSuper && (
                  <button className={styles.activateBtn} onClick={() => setEditUser(u)}
                    style={{ background:'#eff6ff', color:'#1d4ed8' }}>Edit</button>
                )}
                <button className={u.is_active ? styles.deactivateBtn : styles.activateBtn}
                  onClick={() => toggleStatus(u)} disabled={toggling === u.id}>
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
        </div>

        {/* Side panel */}
        {selected && (
          <aside className={styles.panel}>
            <div className={styles.panelHeader}>
              <ProfileImage
                fileId={selected.profile_image_file_id}
                initials={`${selected.first_name?.[0] ?? ''}${selected.last_name?.[0] ?? ''}`}
              />
              <div>
                <div className={styles.panelName}>{selected.first_name} {selected.last_name}</div>
                <div className={styles.panelId}>{selected.employee_id ?? (selected.patient_mrn ? `MRN: ${selected.patient_mrn}` : '—')}</div>
              </div>
              <button className={styles.closeBtn} onClick={() => setSelected(null)} aria-label="Close panel">✕</button>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.detailRow}><span>Department</span><span>{selected.department_name ?? '—'}</span></div>
              <div className={styles.detailRow}>
                <span>Status</span>
                <span className={selected.is_active ? styles.statusActive : styles.statusInactive}>{selected.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className={styles.detailRow}><span>Last Login</span><span>{selected.last_login_at ? new Date(selected.last_login_at).toLocaleString() : 'Never'}</span></div>
              <div className={styles.detailRow}><span>Joined</span><span>{new Date(selected.created_at).toLocaleDateString()}</span></div>

              <div className={styles.rolesSection}>
                <span className={styles.sectionLabel}>Roles</span>
                <div className={styles.roleList}>{(selected.roles ?? []).map((r) => <RoleBadge key={r} role={r} />)}</div>
              </div>

              {isAdminOrSuper && (
                <div style={{ paddingTop:12, borderTop:'1px solid #f3f4f6' }}>
                  <button onClick={() => setEditUser(selected)}
                    style={{ width:'100%',padding:'8px',background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:4,cursor:'pointer',fontSize:'0.8125rem',fontWeight:600 }}>
                    Edit User
                  </button>
                </div>
              )}

              <div className={styles.sessionsSection}>
                <span className={styles.sectionLabel}>Active Sessions ({sessions.length})</span>
                {sessLoading && <p className={styles.empty}>Loading…</p>}
                {!sessLoading && !sessions.length && <p className={styles.empty}>No active sessions</p>}
                {sessions.map((s) => (
                  <div key={s.sessionId} className={styles.sessionRow}>
                    <span className={styles.mono}>{s.sessionId.slice(0, 16)}…</span>
                    <button className={styles.logoutBtn} onClick={() => forceLogout(s.sessionId)}>Logout</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop:16,paddingTop:16,borderTop:'1px solid #f3f4f6' }}>
                <button onClick={() => setConfirmDelete(selected)} disabled={!!deleting}
                  style={{ width:'100%',padding:'8px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:4,cursor:'pointer',fontSize:'0.8125rem' }}>
                  Delete User
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
