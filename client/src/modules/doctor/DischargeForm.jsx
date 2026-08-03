import { useState, useEffect, useRef } from 'react';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './DischargeForm.module.scss';

// ---------------------------------------------------------------------------
// Patient search autocomplete (same pattern as PrescriptionForm)
// ---------------------------------------------------------------------------
function useDebounce(value, delay = 300) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

function PatientSearch({ onSelect }) {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debouncedQ = useDebounce(q);

  useEffect(() => {
    if (debouncedQ.length < 2) { setResults([]); return; }
    setLoading(true);
    apiFetch(`${API_BASE}/patients?search=${encodeURIComponent(debouncedQ)}&limit=8`)
      .then(json => setResults(json?.patients ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  return (
    <div className={styles.patientSearchWrap}>
      <label className={styles.label}>
        Search Patient <span className={styles.req}>*</span>
        <input
          className={styles.searchInput}
          placeholder="Name or MRN…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
      </label>
      {loading && <div className={styles.hint}>Searching…</div>}
      {results.length > 0 && (
        <ul className={styles.patientList}>
          {results.map(p => (
            <li
              key={p.id}
              className={styles.patientItem}
              onClick={() => { onSelect(p); setResults([]); setQ(''); }}
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelect(p)}
            >
              <span className={styles.patientName}>{p.first_name} {p.last_name}</span>
              <span className={styles.patientMrn}>{p.mrn}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------
export default function DischargeForm({ patientId: propPatientId, onSuccess }) {
  // If no patientId prop, the doctor must search for one
  const [patient, setPatient] = useState(
    propPatientId ? { id: propPatientId, name: '' } : null
  );

  const [form, setForm] = useState({
    admissionDate      : '',
    dischargeDate      : new Date().toISOString().slice(0, 16),
    diagnosis          : '',
    treatmentSummary   : '',
    dischargeMedications: '',
    followUpDate       : '',
    instructions       : '',
  });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patient?.id) { setError('Select a patient first.'); return; }
    setSaving(true);
    setError(null);
    try {
      const json = await apiFetch(`${API_BASE}/discharge-summaries`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          ...form,
          patientId: patient.id,
          admissionDate: form.admissionDate ? new Date(form.admissionDate).toISOString() : undefined,
          dischargeDate: new Date(form.dischargeDate).toISOString(),
          followUpDate : form.followUpDate || undefined,
        }),
      });
      setSuccess(true);
      onSuccess?.(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className={styles.form}>
        <div className={styles.successBox}>
          <span className={styles.successIcon}>✓</span>
          <h3>Discharge summary created</h3>
          <p>
            {patient.name && `${patient.name}'s discharge summary has been saved.`}
            {!patient.name && 'Discharge summary has been saved.'}
            {' '}The patient and nursing staff have been notified.
          </p>
          <button
            className={styles.submitBtn}
            onClick={() => {
              setSuccess(false);
              setPatient(propPatientId ? { id: propPatientId, name: '' } : null);
              setForm({
                admissionDate: '', dischargeDate: new Date().toISOString().slice(0, 16),
                diagnosis: '', treatmentSummary: '', dischargeMedications: '',
                followUpDate: '', instructions: '',
              });
            }}
          >
            New Discharge Summary
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>Discharge Summary</h2>

      {error && <div className={styles.error}>{error}</div>}

      {/* Patient selection — only shown when no patientId prop */}
      {!propPatientId && (
        !patient ? (
          <PatientSearch
            onSelect={p => setPatient({ id: p.id, name: `${p.first_name} ${p.last_name}` })}
          />
        ) : (
          <div className={styles.patientChip}>
            <span>👤 {patient.name}</span>
            <button type="button" className={styles.changeBtn} onClick={() => setPatient(null)}>
              Change
            </button>
          </div>
        )
      )}

      {/* Only show the rest of the form once a patient is selected */}
      {patient && (
        <>
          <div className={styles.row}>
            <label className={styles.label}>
              Admission Date
              <input type="datetime-local" value={form.admissionDate} onChange={set('admissionDate')} />
            </label>
            <label className={styles.label}>
              Discharge Date *
              <input type="datetime-local" value={form.dischargeDate} onChange={set('dischargeDate')} required />
            </label>
          </div>

          <label className={styles.label}>
            Diagnosis *
            <textarea required value={form.diagnosis} onChange={set('diagnosis')} placeholder="Final diagnosis…" />
          </label>

          <label className={styles.label}>
            Treatment Summary
            <textarea value={form.treatmentSummary} onChange={set('treatmentSummary')} placeholder="Summary of treatment provided…" />
          </label>

          <label className={styles.label}>
            Discharge Medications
            <textarea value={form.dischargeMedications} onChange={set('dischargeMedications')} placeholder="Medications prescribed on discharge…" />
          </label>

          <div className={styles.row}>
            <label className={styles.label}>
              Follow-up Date
              <input type="date" value={form.followUpDate} onChange={set('followUpDate')} />
            </label>
          </div>

          <label className={styles.label}>
            Instructions
            <textarea value={form.instructions} onChange={set('instructions')} placeholder="Post-discharge instructions for patient…" />
          </label>

          <button type="submit" className={styles.submitBtn} disabled={saving}>
            {saving ? 'Saving…' : 'Create Discharge Summary'}
          </button>
        </>
      )}
    </form>
  );
}
