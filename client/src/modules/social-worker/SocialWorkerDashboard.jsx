import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './SocialWorkerDashboard.module.scss';

const NOTE_TYPES = ['ASSESSMENT', 'FOLLOW_UP', 'REFERRAL', 'DISCHARGE_PLAN', 'OTHER'];

const inputStyle = { padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8125rem', width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem', marginBottom: 12 };

export default function SocialWorkerDashboard() {
  const [patients, setPatients]     = useState([]);
  const [notes, setNotes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showForm, setShowForm]     = useState(false);
  const [editNote, setEditNote]     = useState(null);
  const [form, setForm]             = useState({ noteType: 'ASSESSMENT', content: '', followUpDate: '' });
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/patients', { params: { limit: 100 } }),
      api.get('/case-notes', { params: { limit: 200 } }),
    ])
      .then(([pr, nr]) => {
        const list = pr.data;
        setPatients(Array.isArray(list) ? list : list?.rows ?? list?.patients ?? []);
        setNotes(nr.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = patients.filter((p) => {
    const q = search.toLowerCase();
    return p.first_name?.toLowerCase().includes(q) || p.last_name?.toLowerCase().includes(q) || p.mrn?.toLowerCase().includes(q);
  });

  const patientNotes = (patientId) => notes.filter((n) => n.patient_id === patientId);

  const openCreate = (patient) => {
    setSelectedPatient(patient);
    setEditNote(null);
    setForm({ noteType: 'ASSESSMENT', content: '', followUpDate: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (patient, note) => {
    setSelectedPatient(patient);
    setEditNote(note);
    setForm({
      noteType    : note.note_type,
      content     : note.content,
      followUpDate: note.follow_up_date?.slice(0, 10) ?? '',
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
        patientId   : selectedPatient.id,
        noteType    : form.noteType,
        content     : form.content,
        followUpDate: form.followUpDate || undefined,
      };
      if (editNote) {
        const { data } = await api.patch(`/case-notes/${editNote.id}`, { content: form.content, followUpDate: form.followUpDate || null });
        setNotes((prev) => prev.map((n) => n.id === editNote.id ? data : n));
      } else {
        const { data } = await api.post('/case-notes', body);
        setNotes((prev) => [data, ...prev]);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const markResolved = async (note) => {
    const { data } = await api.patch(`/case-notes/${note.id}`, { resolved: !note.resolved });
    setNotes((prev) => prev.map((n) => n.id === note.id ? data : n));
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Social Worker Dashboard</h1>
      <p className={styles.subtitle}>Review patients and manage social support case notes.</p>

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search by name or MRN…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className={styles.count}>{filtered.length} patient{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Case Note Form Modal */}
      {showForm && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:8,padding:28,width:480,maxWidth:'90vw',maxHeight:'90vh',overflowY:'auto' }}>
            <h2 style={{ margin:'0 0 4px',fontSize:'1rem' }}>{editNote ? 'Edit' : 'New'} Case Note</h2>
            <p style={{ margin:'0 0 16px',fontSize:'0.8125rem',color:'#6b7280' }}>
              Patient: <strong>{selectedPatient?.first_name} {selectedPatient?.last_name}</strong> ({selectedPatient?.mrn})
            </p>
            <form onSubmit={handleSave}>
              {!editNote && (
                <label style={labelStyle}>
                  Note Type
                  <select value={form.noteType} onChange={(e) => setForm(f => ({ ...f, noteType: e.target.value }))} style={inputStyle}>
                    {NOTE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </label>
              )}
              <label style={labelStyle}>
                Content *
                <textarea required value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                  placeholder="Describe the assessment, referral, or follow-up details…" />
              </label>
              <label style={labelStyle}>
                Follow-up Date
                <input type="date" value={form.followUpDate} onChange={(e) => setForm(f => ({ ...f, followUpDate: e.target.value }))} style={inputStyle} />
              </label>
              {formError && <p style={{ color:'#ef4444',fontSize:'0.8rem',margin:'0 0 12px' }}>{formError}</p>}
              <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
                <button type="button" onClick={() => setShowForm(false)} style={{ padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:4,background:'#fff',cursor:'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding:'8px 16px',background:'#7c3aed',color:'#fff',border:'none',borderRadius:4,cursor:'pointer' }}>
                  {saving ? 'Saving…' : editNote ? 'Update Note' : 'Add Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr><th>MRN</th><th>Name</th><th>Status</th><th>Open Cases</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const pn = patientNotes(p.id);
              const open = pn.filter((n) => !n.resolved);
              return (
                <tr key={p.id}>
                  <td className={styles.mono}>{p.mrn}</td>
                  <td>{p.first_name} {p.last_name}</td>
                  <td>
                    <span className={`${styles.badge} ${p.is_admitted ? styles.badgeGreen : styles.badgeGray}`}>
                      {p.is_admitted ? 'Admitted' : 'Outpatient'}
                    </span>
                  </td>
                  <td>
                    {open.length === 0
                      ? <span className={styles.noNotes}>None</span>
                      : open.map((n) => (
                          <span key={n.id} className={`${styles.noteTag} ${styles[`type_${n.note_type}`] ?? ''}`}
                            onClick={() => openEdit(p, n)} title="Click to edit">
                            {n.note_type.replace('_', ' ')}
                          </span>
                        ))
                    }
                  </td>
                  <td>
                    <button className={styles.addBtn} onClick={() => openCreate(p)}>+ Add Note</button>
                    {pn.filter((n) => !n.resolved).map((n) => (
                      <button key={n.id} className={styles.resolveBtn} onClick={() => markResolved(n)} title="Mark resolved">✓</button>
                    ))}
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
