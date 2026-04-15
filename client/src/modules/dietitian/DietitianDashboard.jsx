import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './DietitianDashboard.module.scss';

const EMPTY_FORM = {
  planName: '', calories: '', protein: '', carbs: '',
  fats: '', restrictions: '', notes: '', startDate: '', endDate: '',
};

const inputStyle = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8125rem', width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', marginBottom: 12 };

export default function DietitianDashboard() {
  const [patients, setPatients]   = useState([]);
  const [plans, setPlans]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [editPlan, setEditPlan]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/patients', { params: { limit: 100 } }),
      api.get('/diet-plans', { params: { limit: 200 } }),
    ])
      .then(([pr, dr]) => {
        setPatients(pr.data.rows ?? pr.data ?? []);
        setPlans(dr.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = patients.filter((p) => {
    const q = search.toLowerCase();
    return p.first_name?.toLowerCase().includes(q) || p.last_name?.toLowerCase().includes(q) || p.mrn?.toLowerCase().includes(q);
  });

  const patientPlans = (patientId) => plans.filter((pl) => pl.patient_id === patientId);

  const openCreate = (patient) => {
    setSelected(patient);
    setEditPlan(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (patient, plan) => {
    setSelected(patient);
    setEditPlan(plan);
    setForm({
      planName    : plan.plan_name ?? '',
      calories    : plan.calories ?? '',
      protein     : plan.protein ?? '',
      carbs       : plan.carbs ?? '',
      fats        : plan.fats ?? '',
      restrictions: plan.restrictions ?? '',
      notes       : plan.notes ?? '',
      startDate   : plan.start_date?.slice(0, 10) ?? '',
      endDate     : plan.end_date?.slice(0, 10) ?? '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const body = {
        patientId   : selected.id,
        planName    : form.planName,
        calories    : form.calories ? parseInt(form.calories, 10) : undefined,
        protein     : form.protein || undefined,
        carbs       : form.carbs || undefined,
        fats        : form.fats || undefined,
        restrictions: form.restrictions || undefined,
        notes       : form.notes || undefined,
        startDate   : form.startDate || undefined,
        endDate     : form.endDate || undefined,
      };
      if (editPlan) {
        const { data } = await api.patch(`/diet-plans/${editPlan.id}`, body);
        setPlans((prev) => prev.map((pl) => pl.id === editPlan.id ? data : pl));
      } else {
        const { data } = await api.post('/diet-plans', body);
        setPlans((prev) => [data, ...prev]);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan) => {
    const { data } = await api.patch(`/diet-plans/${plan.id}`, { isActive: !plan.is_active });
    setPlans((prev) => prev.map((pl) => pl.id === plan.id ? data : pl));
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Dietitian Dashboard</h1>
      <p className={styles.subtitle}>Manage dietary plans for admitted patients.</p>

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search patients…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className={styles.count}>{filtered.length} patient{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Diet Plan Form Modal */}
      {showForm && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:8,padding:28,width:500,maxWidth:'90vw',maxHeight:'90vh',overflowY:'auto' }}>
            <h2 style={{ margin:'0 0 4px',fontSize:'1rem' }}>{editPlan ? 'Edit' : 'New'} Diet Plan</h2>
            <p style={{ margin:'0 0 16px',fontSize:'0.8125rem',color:'#6b7280' }}>
              Patient: <strong>{selected?.first_name} {selected?.last_name}</strong> ({selected?.mrn})
            </p>
            <form onSubmit={handleSave}>
              <label style={labelStyle}>
                Plan Name *
                <input required value={form.planName} onChange={(e) => setForm(f => ({ ...f, planName: e.target.value }))} style={inputStyle} placeholder="e.g. Low-sodium diabetic diet" />
              </label>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12 }}>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Calories (kcal/day)
                  <input type="number" min="0" value={form.calories} onChange={(e) => setForm(f => ({ ...f, calories: e.target.value }))} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Protein
                  <input value={form.protein} onChange={(e) => setForm(f => ({ ...f, protein: e.target.value }))} style={inputStyle} placeholder="e.g. 60g/day" />
                </label>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Carbohydrates
                  <input value={form.carbs} onChange={(e) => setForm(f => ({ ...f, carbs: e.target.value }))} style={inputStyle} placeholder="e.g. 200g/day" />
                </label>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Fats
                  <input value={form.fats} onChange={(e) => setForm(f => ({ ...f, fats: e.target.value }))} style={inputStyle} placeholder="e.g. 50g/day" />
                </label>
              </div>
              <label style={labelStyle}>
                Dietary Restrictions / Allergies
                <input value={form.restrictions} onChange={(e) => setForm(f => ({ ...f, restrictions: e.target.value }))} style={inputStyle} placeholder="e.g. No nuts, low sodium, gluten-free" />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} />
              </label>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12 }}>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  Start Date
                  <input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, marginBottom:0 }}>
                  End Date
                  <input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} style={inputStyle} />
                </label>
              </div>
              {formError && <p style={{ color:'#ef4444',fontSize:'0.8rem',margin:'0 0 12px' }}>{formError}</p>}
              <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                <button type="button" onClick={() => setShowForm(false)} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding:'8px 16px',background:'#059669',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
                  {saving ? 'Saving…' : editPlan ? 'Update Plan' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr><th>MRN</th><th>Name</th><th>DOB</th><th>Active Plans</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const pp = patientPlans(p.id);
              const active = pp.filter((pl) => pl.is_active);
              return (
                <tr key={p.id}>
                  <td className={styles.mono}>{p.mrn}</td>
                  <td>{p.first_name} {p.last_name}</td>
                  <td>{p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString() : '—'}</td>
                  <td>
                    {active.length === 0
                      ? <span className={styles.unset}>None</span>
                      : active.map((pl) => (
                          <span key={pl.id} className={styles.planTag} onClick={() => openEdit(p, pl)} title="Click to edit">
                            {pl.plan_name}
                          </span>
                        ))
                    }
                  </td>
                  <td>
                    <button className={styles.addBtn} onClick={() => openCreate(p)}>+ Add Plan</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>No patients found.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
