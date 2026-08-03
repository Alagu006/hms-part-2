import { useState, useEffect, useCallback } from 'react';
import { apiFetch, API_BASE } from '../utils/api.js';
import styles from './PatientAllergies.module.scss';

const ALLERGY_TYPES = ['DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER'];
const SEVERITY_OPTIONS = [
  { value: 'MILD',     label: 'Mild',     color: '#16a34a' },
  { value: 'MODERATE', label: 'Moderate', color: '#d97706' },
  { value: 'SEVERE',   label: 'Severe',   color: '#dc2626' },
];

const COMMON_ALLERGENS = {
  DRUG       : ['Penicillin', 'Aspirin', 'Ibuprofen', 'Sulfa drugs', 'Codeine', 'Morphine', 'Tetracycline', 'Erythromycin'],
  FOOD       : ['Peanuts', 'Tree nuts', 'Shellfish', 'Fish', 'Milk', 'Eggs', 'Wheat / Gluten', 'Soy'],
  ENVIRONMENTAL: ['Pollen', 'Dust mites', 'Pet dander', 'Mould', 'Latex', 'Insect stings'],
  OTHER      : ['Contrast dye', 'Nickel', 'Adhesive tape', 'Chlorhexidine'],
};

const REACTION_SUGGESTIONS = [
  'Rash', 'Hives', 'Itching', 'Swelling', 'Anaphylaxis',
  'Nausea', 'Vomiting', 'Difficulty breathing', 'Wheezing',
  'Diarrhoea', 'Abdominal pain', 'Dizziness',
];

const SEVERITY_COLOR = { MILD: '#16a34a', MODERATE: '#d97706', SEVERE: '#dc2626' };

function AllergyBadge({ severity }) {
  const opt = SEVERITY_OPTIONS.find(s => s.value === severity);
  return (
    <span className={styles.severityBadge} style={{ background: opt?.color + '20', color: opt?.color, borderColor: opt?.color + '40' }}>
      {opt?.label ?? severity}
    </span>
  );
}

// ── Add / Edit form ───────────────────────────────────────────────────────────
function AllergyForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial ?? {
    allergen: '', type: 'DRUG', severity: 'MODERATE', reaction: '', notes: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const suggestions = COMMON_ALLERGENS[form.type] ?? [];

  return (
    <div className={styles.formCard}>
      <div className={styles.formRow}>
        {/* Type */}
        <div className={styles.formField}>
          <label className={styles.label}>Type</label>
          <select className={styles.select} value={form.type} onChange={e => set('type', e.target.value)}>
            {ALLERGY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Severity */}
        <div className={styles.formField}>
          <label className={styles.label}>Severity</label>
          <div className={styles.severityGroup}>
            {SEVERITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.severityBtn} ${form.severity === opt.value ? styles.severityActive : ''}`}
                style={form.severity === opt.value ? { background: opt.color, borderColor: opt.color } : {}}
                onClick={() => set('severity', opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Allergen */}
      <div className={styles.formField}>
        <label className={styles.label}>Allergen <span className={styles.req}>*</span></label>
        <input
          className={styles.input}
          placeholder={`e.g. ${suggestions[0] ?? 'Enter allergen name'}`}
          value={form.allergen}
          onChange={e => set('allergen', e.target.value)}
          autoFocus
        />
        {suggestions.length > 0 && (
          <div className={styles.quickChips}>
            {suggestions.map(s => (
              <button
                key={s}
                type="button"
                className={`${styles.quickChip} ${form.allergen === s ? styles.quickChipActive : ''}`}
                onClick={() => set('allergen', s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reaction */}
      <div className={styles.formField}>
        <label className={styles.label}>Reaction / Symptoms</label>
        <input
          className={styles.input}
          placeholder="e.g. Rash, Hives, Anaphylaxis"
          value={form.reaction}
          onChange={e => set('reaction', e.target.value)}
        />
        <div className={styles.quickChips}>
          {REACTION_SUGGESTIONS.map(r => (
            <button
              key={r}
              type="button"
              className={styles.quickChip}
              onClick={() => set('reaction', form.reaction ? `${form.reaction}, ${r}` : r)}
            >
              + {r}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className={styles.formField}>
        <label className={styles.label}>Notes</label>
        <textarea
          className={styles.textarea}
          placeholder="Additional notes (optional)…"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          rows={2}
        />
      </div>

      <div className={styles.formActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={() => onSave(form)}
          disabled={saving || !form.allergen.trim()}
        >
          {saving ? 'Saving…' : initial ? 'Update Allergy' : 'Add Allergy'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PatientAllergies({ patientId, patientName, readOnly = false }) {
  const [allergies, setAllergies] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [adding,    setAdding]    = useState(false);
  const [editing,   setEditing]   = useState(null); // allergy id
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAllergies = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const json = await apiFetch(`${API_BASE}/patients/${patientId}/allergies`);
      setAllergies(json?.allergies ?? json?.data ?? []);
    } catch { setAllergies([]); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { fetchAllergies(); }, [fetchAllergies]);

  async function handleAdd(form) {
    setSaving(true);
    try {
      const json = await apiFetch(`${API_BASE}/patients/${patientId}/allergies`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setAllergies(prev => [json?.data ?? json, ...prev]);
      setAdding(false);
      showToast('Allergy recorded');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleUpdate(id, form) {
    setSaving(true);
    try {
      const json = await apiFetch(`${API_BASE}/patients/${patientId}/allergies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setAllergies(prev => prev.map(a => a.id === id ? (json?.data ?? json) : a));
      setEditing(null);
      showToast('Allergy updated');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this allergy record?')) return;
    setDeleting(id);
    try {
      await apiFetch(`${API_BASE}/patients/${patientId}/allergies/${id}`, { method: 'DELETE' });
      setAllergies(prev => prev.filter(a => a.id !== id));
      showToast('Allergy removed');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setDeleting(null); }
  }

  const hasSevere = allergies.some(a => a.severity === 'SEVERE');

  return (
    <div className={styles.wrap}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.title}>
            🚨 Allergies
            {patientName && <span className={styles.patientLabel}> — {patientName}</span>}
          </h3>
          {hasSevere && (
            <span className={styles.severeBanner}>⚠ SEVERE allergy on record</span>
          )}
        </div>
        {!readOnly && !adding && (
          <button className={styles.addBtn} onClick={() => { setAdding(true); setEditing(null); }}>
            + Add Allergy
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <AllergyForm
          onSave={handleAdd}
          onCancel={() => setAdding(false)}
          saving={saving}
        />
      )}

      {/* List */}
      {loading ? (
        <div className={styles.empty}>Loading allergies…</div>
      ) : allergies.length === 0 && !adding ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>✅</span>
          <p>No known allergies recorded{readOnly ? '.' : ' — click "Add Allergy" to record one.'}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {allergies.map(a => (
            <div key={a.id} className={`${styles.allergyCard} ${a.severity === 'SEVERE' ? styles.severe : ''}`}>
              {editing === a.id ? (
                <AllergyForm
                  initial={{ allergen: a.allergen, type: a.type, severity: a.severity, reaction: a.reaction ?? '', notes: a.notes ?? '' }}
                  onSave={form => handleUpdate(a.id, form)}
                  onCancel={() => setEditing(null)}
                  saving={saving}
                />
              ) : (
                <>
                  <div className={styles.allergyTop}>
                    <div className={styles.allergyMain}>
                      <span className={styles.allergyName}>{a.allergen}</span>
                      <span className={styles.allergyType}>{a.type}</span>
                      <AllergyBadge severity={a.severity} />
                    </div>
                    {!readOnly && (
                      <div className={styles.allergyActions}>
                        <button className={styles.editBtn} onClick={() => { setEditing(a.id); setAdding(false); }}>
                          Edit
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(a.id)}
                          disabled={deleting === a.id}
                        >
                          {deleting === a.id ? '…' : 'Remove'}
                        </button>
                      </div>
                    )}
                  </div>
                  {a.reaction && (
                    <p className={styles.allergyReaction}>
                      <strong>Reaction:</strong> {a.reaction}
                    </p>
                  )}
                  {a.notes && (
                    <p className={styles.allergyNotes}>{a.notes}</p>
                  )}
                  <p className={styles.allergyMeta}>
                    Recorded by {a.recorded_by_name ?? 'staff'}
                    {a.created_at && ` · ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(a.created_at))}`}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`} role="alert">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
