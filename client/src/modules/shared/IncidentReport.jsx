import { useState } from 'react';
import styles from './IncidentReport.module.scss';

const API = import.meta.env.VITE_API_URL ?? '/api';
const auth = () => ({ Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` });

const TYPES = [
  { value: 'NEAR_MISS',          label: 'Near Miss' },
  { value: 'ADVERSE_EVENT',      label: 'Adverse Event' },
  { value: 'EQUIPMENT_FAILURE',  label: 'Equipment Failure' },
  { value: 'SECURITY_BREACH',    label: 'Security Breach' },
];

const EMPTY = { type: 'NEAR_MISS', severity: 3, description: '', patientId: '', witnessIds: '' };

export default function IncidentReport() {
  const [form, setForm]       = useState(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body = {
        type       : form.type,
        severity   : form.severity,
        description: form.description,
        patientId  : form.patientId.trim() || undefined,
        witnessIds : form.witnessIds
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      };
      const res = await fetch(`${API}/incidents`, {
        method : 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body   : JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Submission failed');
      setForm(EMPTY);
      setSuccess(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Report Incident</h1>

      {success && <div className={styles.success}>Incident reported successfully.</div>}
      {error   && <div className={styles.error}>{error}</div>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.row}>
          <label className={styles.label}>
            Incident Type
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className={styles.label}>
            Patient ID (optional)
            <input
              type="text"
              placeholder="UUID"
              value={form.patientId}
              onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))}
            />
          </label>
        </div>

        <label className={styles.label}>
          Severity (1 = minor, 5 = critical)
          <div className={styles.severityRow}>
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                type="button"
                className={`${styles.severityBtn} ${form.severity === n ? styles.active : ''} ${n >= 4 ? styles.high : ''}`}
                onClick={() => setForm(f => ({ ...f, severity: n }))}
              >
                {n}
              </button>
            ))}
          </div>
        </label>

        <label className={styles.label}>
          Description
          <textarea
            required
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe what happened…"
          />
        </label>

        <label className={styles.label}>
          Witness IDs (comma-separated UUIDs, optional)
          <input
            type="text"
            value={form.witnessIds}
            onChange={e => setForm(f => ({ ...f, witnessIds: e.target.value }))}
            placeholder="uuid1, uuid2"
          />
        </label>

        <button type="submit" className={styles.submitBtn} disabled={saving}>
          {saving ? 'Submitting…' : 'Submit Report'}
        </button>
      </form>
    </div>
  );
}
