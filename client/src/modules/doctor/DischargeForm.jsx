import { useState } from 'react';
import styles from './DischargeForm.module.scss';

const API  = import.meta.env.VITE_API_URL ?? '/api';
const auth = () => ({ Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` });

export default function DischargeForm({ patientId, onSuccess }) {
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

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/discharge-summaries`, {
        method : 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          ...form,
          patientId,
          admissionDate: form.admissionDate ? new Date(form.admissionDate).toISOString() : undefined,
          dischargeDate: new Date(form.dischargeDate).toISOString(),
          followUpDate : form.followUpDate || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      const data = await res.json();
      onSuccess?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>Discharge Summary</h2>

      {error && <div className={styles.error}>{error}</div>}

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
    </form>
  );
}
