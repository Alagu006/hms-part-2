import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './BloodBank.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';

const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const STATUSES     = ['AVAILABLE','RESERVED','USED','EXPIRED'];

const EMPTY_FORM = { bloodGroup: 'A+', units: 1, donorName: '', expiryDate: '', status: 'AVAILABLE' };

export default function BloodBank() {
  const [availability, setAvailability] = useState([]);
  const [units, setUnits]               = useState([]);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [editId, setEditId]             = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [saving, setSaving]             = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [av, un] = await Promise.all([
        apiFetch(`${API}/blood-bank/availability`),
        apiFetch(`${API}/blood-bank`),
      ]);
      setAvailability(Array.isArray(av) ? av : (av?.data ?? []));
      setUnits(Array.isArray(un) ? un : (un?.data ?? un?.units ?? []));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url    = editId ? `${API}/blood-bank/${editId}` : `${API}/blood-bank`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({ ...form, units: Number(form.units) }),
      });
      setForm(EMPTY_FORM);
      setEditId(null);
      await fetchAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (unit) => {
    setEditId(unit.id);
    setForm({
      bloodGroup: unit.blood_group,
      units     : unit.units,
      donorName : unit.donor_name ?? '',
      expiryDate: unit.expiry_date?.slice(0, 10) ?? '',
      status    : unit.status,
    });
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this blood unit record?')) return;
    await apiFetch(`${API}/blood-bank/${id}`, { method: 'DELETE' });
    await fetchAll();
  };

  if (loading) return <div className={styles.loading}>Loading blood bank…</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Blood Bank</h1>

      {error && <div className={styles.error}>{error}</div>}

      {/* Availability summary */}
      <section className={styles.availSection}>
        <h2 className={styles.sectionTitle}>Availability</h2>
        <div className={styles.availGrid}>
          {availability.map(g => (
            <div key={g.bloodGroup} className={`${styles.availCard} ${g.lowStock ? styles.lowStock : ''}`}>
              <span className={styles.bloodGroup}>{g.bloodGroup}</span>
              <span className={styles.availCount}>{g.available}</span>
              <span className={styles.availLabel}>available</span>
              {g.lowStock && <span className={styles.lowBadge}>LOW</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Add / Edit form */}
      <section className={styles.formSection}>
        <h2 className={styles.sectionTitle}>{editId ? 'Edit Record' : 'Add Blood Unit'}</h2>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Blood Group
            <select value={form.bloodGroup} onChange={e => setForm(f => ({ ...f, bloodGroup: e.target.value }))}>
              {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className={styles.label}>
            Units
            <input type="number" min="1" value={form.units}
              onChange={e => setForm(f => ({ ...f, units: e.target.value }))} required />
          </label>
          <label className={styles.label}>
            Donor Name (optional)
            <input type="text" value={form.donorName}
              onChange={e => setForm(f => ({ ...f, donorName: e.target.value }))} />
          </label>
          <label className={styles.label}>
            Expiry Date
            <input type="date" value={form.expiryDate}
              onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} required />
          </label>
          <label className={styles.label}>
            Status
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <div className={styles.formActions}>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
            </button>
            {editId && (
              <button type="button" className={styles.cancelBtn}
                onClick={() => { setEditId(null); setForm(EMPTY_FORM); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Units table */}
      <section className={styles.tableSection}>
        <h2 className={styles.sectionTitle}>All Records</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Blood Group</th><th>Units</th><th>Donor</th>
                <th>Expiry</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {units.map(u => (
                <tr key={u.id}>
                  <td><span className={styles.bgBadge}>{u.blood_group}</span></td>
                  <td>{u.units}</td>
                  <td>{u.donor_name ?? '—'}</td>
                  <td>{u.expiry_date?.slice(0, 10) ?? '—'}</td>
                  <td><span className={`${styles.statusBadge} ${styles[`s_${u.status}`]}`}>{u.status}</span></td>
                  <td className={styles.actions}>
                    <button className={styles.editBtn} onClick={() => handleEdit(u)}>Edit</button>
                    <button className={styles.delBtn}  onClick={() => handleDelete(u.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!units.length && (
                <tr><td colSpan={6} className={styles.empty}>No records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
