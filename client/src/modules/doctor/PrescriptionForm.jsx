import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './PrescriptionForm.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const FREQ_OPTIONS = ['1x', '2x', '3x', 'SOS'];
const DOSES = { '1x': 1, '2x': 2, '3x': 3, 'SOS': 1 };
const MED_FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'INHALER', 'PATCH', 'OTHER'];

function useDebounce(value, delay = 300) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

function newItem() {
  return {
    _key: crypto.randomUUID(),
    medicineId: '', medicineName: '', genericName: '',
    form: '', strength: '', dosage: '', frequency: '1x',
    durationDays: 7, instructions: '',
    searchQuery: '', searchResults: [], showDropdown: false,
  };
}

// ---------------------------------------------------------------------------
// Common symptoms list for quick-add chips
// ---------------------------------------------------------------------------
const COMMON_SYMPTOMS = [
  'Fever', 'Headache', 'Cough', 'Sore throat', 'Runny nose',
  'Fatigue', 'Nausea', 'Vomiting', 'Diarrhoea', 'Abdominal pain',
  'Chest pain', 'Shortness of breath', 'Dizziness', 'Body aches',
  'Loss of appetite', 'Chills', 'Sweating', 'Rash', 'Joint pain',
  'Back pain', 'Palpitations', 'Swelling', 'Blurred vision', 'Insomnia',
];

const SEVERITY_OPTIONS = [
  { value: 'mild',     label: 'Mild',     color: '#16a34a' },
  { value: 'moderate', label: 'Moderate', color: '#d97706' },
  { value: 'severe',   label: 'Severe',   color: '#dc2626' },
];

// ---------------------------------------------------------------------------
// Symptoms section component
// ---------------------------------------------------------------------------
function SymptomsSection({ symptoms, onChange }) {
  const [input, setInput] = useState('');

  function addSymptom(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (symptoms.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...symptoms, { name: trimmed, severity: 'moderate', duration: '' }]);
    setInput('');
  }

  function removeSymptom(index) {
    onChange(symptoms.filter((_, i) => i !== index));
  }

  function updateSymptom(index, patch) {
    onChange(symptoms.map((s, i) => i === index ? { ...s, ...patch } : s));
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addSymptom(input); }
    if (e.key === ',' && input.trim()) { e.preventDefault(); addSymptom(input); }
  }

  const available = COMMON_SYMPTOMS.filter(
    s => !symptoms.some(sym => sym.name.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>Symptoms <span className={styles.req}>*</span></p>

      {/* Free-text input */}
      <div className={styles.symptomInputRow}>
        <input
          className={styles.input}
          placeholder="Type a symptom and press Enter…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          aria-label="Add symptom"
        />
        <button
          type="button"
          className={styles.addSymptomBtn}
          onClick={() => addSymptom(input)}
          disabled={!input.trim()}
        >
          Add
        </button>
      </div>

      {/* Quick-add chips */}
      <div className={styles.quickChips}>
        {available.slice(0, 12).map(s => (
          <button
            key={s}
            type="button"
            className={styles.quickChip}
            onClick={() => addSymptom(s)}
          >
            + {s}
          </button>
        ))}
      </div>

      {/* Added symptoms */}
      {symptoms.length > 0 && (
        <div className={styles.symptomList}>
          {symptoms.map((sym, i) => (
            <div key={i} className={styles.symptomRow}>
              <div className={styles.symptomName}>
                <span className={styles.symptomDot} style={{
                  background: SEVERITY_OPTIONS.find(s => s.value === sym.severity)?.color ?? '#6b7280'
                }} />
                {sym.name}
              </div>

              <div className={styles.symptomControls}>
                {/* Severity */}
                <div className={styles.severityGroup}>
                  {SEVERITY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.severityBtn} ${sym.severity === opt.value ? styles.severityActive : ''}`}
                      style={sym.severity === opt.value ? { background: opt.color, borderColor: opt.color } : {}}
                      onClick={() => updateSymptom(i, { severity: opt.value })}
                      aria-pressed={sym.severity === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Duration */}
                <input
                  className={styles.durationInput}
                  placeholder="Duration (e.g. 3 days)"
                  value={sym.duration}
                  onChange={e => updateSymptom(i, { duration: e.target.value })}
                  aria-label={`Duration for ${sym.name}`}
                />

                <button
                  type="button"
                  className={styles.removeSymptomBtn}
                  onClick={() => removeSymptom(i)}
                  aria-label={`Remove ${sym.name}`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {symptoms.length === 0 && (
        <p className={styles.symptomEmpty}>No symptoms added yet. Use the input above or click a quick-add chip.</p>
      )}
    </div>
  );
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
      <label className={styles.label}>Search Patient <span className={styles.req}>*</span></label>
      <input className={styles.input} placeholder="Name or MRN (e.g. PAT588465)…"
        value={q} onChange={e => setQ(e.target.value)} autoFocus />
      {loading && <div className={styles.hint}>Searching…</div>}
      {results.length > 0 && (
        <ul className={styles.patientList}>
          {results.map(p => (
            <li key={p.id} className={styles.patientItem}
              onClick={() => { onSelect(p); setResults([]); setQ(''); }}
              tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect(p)}>
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
// Add new medicine modal
// ---------------------------------------------------------------------------
function AddMedicineModal({ onAdded, onClose }) {
  const [form, setForm] = useState({ name: '', genericName: '', form: 'TABLET', strength: '', category: 'GENERAL' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function handleSave() {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    try {
      const json = await apiFetch(`${API_BASE}/prescriptions/medicines`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onAdded(json?.data);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>Add New Medicine</h3>
        <div className={styles.field}>
          <label className={styles.label}>Brand Name <span className={styles.req}>*</span></label>
          <input className={styles.input} value={form.name} onChange={set('name')} placeholder="e.g. Paracetamol 500mg" autoFocus />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Generic Name</label>
          <input className={styles.input} value={form.genericName} onChange={set('genericName')} placeholder="e.g. Acetaminophen" />
        </div>
        <div className={styles.twoCol}>
          <div className={styles.field}>
            <label className={styles.label}>Form</label>
            <select className={styles.input} value={form.form} onChange={set('form')}>
              {MED_FORMS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Strength</label>
            <input className={styles.input} value={form.strength} onChange={set('strength')} placeholder="e.g. 500mg" />
          </div>
        </div>
        {err && <p className={styles.errorText}>{err}</p>}
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button className={styles.submitBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Adding…' : 'Add Medicine'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nurse search
// ---------------------------------------------------------------------------
function NurseSearch({ onSelect }) {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debouncedQ = useDebounce(q);

  useEffect(() => {
    if (debouncedQ.length < 2) { setResults([]); return; }
    setLoading(true);
    apiFetch(`${API_BASE}/messaging/users`)
      .then(json => {
        const all = json?.data ?? [];
        const q = debouncedQ.toLowerCase();
        const nurses = all.filter(u =>
          u.roles?.includes('NURSE') &&
          (`${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
           u.employee_id?.toLowerCase().includes(q))
        ).slice(0, 8);
        setResults(nurses);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  return (
    <div className={styles.patientSearchWrap}>
      <label className={styles.label}>Search Nurse by ID or Name</label>
      <input className={styles.input} placeholder="e.g. NUR123456 or nurse name…"
        value={q} onChange={e => setQ(e.target.value)} />
      {loading && <div className={styles.hint}>Searching…</div>}
      {results.length > 0 && (
        <ul className={styles.patientList}>
          {results.map(n => (
            <li key={n.id} className={styles.patientItem}
              onClick={() => { onSelect(n); setResults([]); setQ(''); }}
              tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect(n)}>
              <span className={styles.patientName}>{n.first_name} {n.last_name}</span>
              <span className={styles.patientMrn}>{n.employee_id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medicine search dropdown
// ---------------------------------------------------------------------------
function MedicineSearch({ item, onChange, onAddNew }) {
  const [loading, setLoading] = useState(false);
  const debouncedQ = useDebounce(item.searchQuery);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) onChange({ showDropdown: false });
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onChange]);

  useEffect(() => {
    if (debouncedQ.length < 3) { onChange({ searchResults: [], showDropdown: false }); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch(`${API_BASE}/prescriptions/medicines/search?q=${encodeURIComponent(debouncedQ)}`)
      .then(json => { if (!cancelled) onChange({ searchResults: json?.data ?? [], showDropdown: true }); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectMedicine(med) {
    onChange({
      medicineId: med.id, medicineName: med.name,
      genericName: med.generic_name ?? '', form: med.form ?? '',
      strength: med.strength ?? '', dosage: med.strength ?? '',
      searchQuery: med.name, showDropdown: false, searchResults: [],
    });
  }

  return (
    <div className={styles.searchWrapper} ref={wrapperRef}>
      <input className={styles.input} placeholder="Search medicine (min 3 chars)…"
        value={item.searchQuery}
        onChange={e => onChange({ searchQuery: e.target.value, medicineId: '' })}
        aria-label="Search medicine" aria-autocomplete="list" aria-expanded={item.showDropdown} />
      {item.showDropdown && (
        <div className={styles.dropdown} role="listbox">
          {loading && <div className={styles.noResults}>Searching…</div>}
          {!loading && item.searchResults.length === 0 && (
            <div className={styles.noResults}>
              No medicines found.{' '}
              <button type="button" className={styles.addMedLink} onClick={onAddNew}>
                + Add to database
              </button>
            </div>
          )}
          {item.searchResults.map(med => (
            <div key={med.id} className={styles.dropdownItem} role="option"
              aria-selected={item.medicineId === med.id} onMouseDown={() => selectMedicine(med)}>
              <div className={styles.drugName}>
                {med.name}
                {med.is_controlled && <span className={styles.controlledBadge}>Controlled</span>}
              </div>
              <div className={styles.drugMeta}>
                {[med.generic_name, med.form, med.strength].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 12px' }}>
            <button type="button" className={styles.addMedLink} onClick={onAddNew}>
              + Add new medicine to database
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single item row
// ---------------------------------------------------------------------------
function ItemRow({ item, index, onUpdate, onRemove, onAddNew }) {
  const qty = DOSES[item.frequency] * item.durationDays;
  return (
    <div className={styles.itemCard}>
      <div className={styles.itemHeader}>
        <span className={styles.itemName}>{item.medicineName || `Medicine ${index + 1}`}</span>
        {item.strength && <span className={styles.itemStrength}>{item.strength}</span>}
        <button type="button" className={styles.removeBtn} onClick={onRemove}>✕</button>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Medicine <span className={styles.req}>*</span></label>
        <MedicineSearch item={item} onChange={patch => onUpdate(patch)} onAddNew={onAddNew} />
      </div>
      <div className={styles.itemGrid}>
        <div className={styles.field}>
          <label className={styles.label}>Dosage / Strength</label>
          <input className={styles.input} value={item.dosage}
            onChange={e => onUpdate({ dosage: e.target.value })} placeholder="e.g. 500mg" />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Frequency</label>
          <div className={styles.freqGroup} role="group">
            {FREQ_OPTIONS.map(f => (
              <button key={f} type="button"
                className={`${styles.freqBtn} ${item.frequency === f ? styles.active : ''}`}
                onClick={() => onUpdate({ frequency: f })} aria-pressed={item.frequency === f}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Duration: <strong>{item.durationDays} day{item.durationDays !== 1 ? 's' : ''}</strong></label>
          <div className={styles.sliderRow}>
            <input type="range" className={styles.slider} min={1} max={30} value={item.durationDays}
              onChange={e => onUpdate({ durationDays: Number(e.target.value) })} />
            <span className={styles.sliderValue}>{item.durationDays}d</span>
          </div>
          <div className={styles.quantityDisplay}>Quantity: <span>{qty} unit{qty !== 1 ? 's' : ''}</span></div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Instructions</label>
          <input className={styles.input} value={item.instructions}
            onChange={e => onUpdate({ instructions: e.target.value })} placeholder="e.g. Take after meals" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------
export default function PrescriptionForm({ patientId: propPatientId, patientName: propPatientName, onClose, onSuccess }) {
  const location = useLocation();
  const statePatientId   = location.state?.patientId;
  const statePatientName = location.state?.patientName;

  const [patient, setPatient]         = useState(
    propPatientId ? { id: propPatientId, name: propPatientName } :
    statePatientId ? { id: statePatientId, name: statePatientName } : null
  );
  const [symptoms, setSymptoms]       = useState([]);
  const [items, setItems]             = useState([newItem()]);
  const [diagnosisCodes, setDiagnosis] = useState('');
  const [notes, setNotes]             = useState('');
  const [nurseNeeded, setNurseNeeded] = useState(null); // null | true | false
  const [nurse, setNurse]             = useState(null);
  const [nurseInstructions, setNurseInstructions] = useState('');
  const [showAddMed, setShowAddMed]   = useState(false);
  const [addMedForIndex, setAddMedForIndex] = useState(null);
  const [warnings, setWarnings]       = useState({ interactions: [], allergies: [] });
  const [loading, setLoading]         = useState(false);
  const [success, setSuccess]         = useState(false);
  const [error, setError]             = useState('');

  function updateItem(index, patch) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
  }

  function handleAddNew(index) {
    setAddMedForIndex(index);
    setShowAddMed(true);
  }

  function handleMedicineAdded(med) {
    if (addMedForIndex !== null) {
      updateItem(addMedForIndex, {
        medicineId: med.id, medicineName: med.name,
        genericName: med.generic_name ?? '', form: med.form ?? '',
        strength: med.strength ?? '', dosage: med.strength ?? '',
        searchQuery: med.name, showDropdown: false, searchResults: [],
      });
    }
    setShowAddMed(false);
    setAddMedForIndex(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!patient) { setError('Select a patient first.'); return; }
    const validItems = items.filter(it => it.medicineId);
    if (!validItems.length) { setError('Add at least one medicine.'); return; }
    if (!symptoms.length) { setError('Add at least one symptom.'); return; }
    const codes = diagnosisCodes.split(',').map(s => s.trim()).filter(Boolean);
    if (!codes.length) { setError('Enter at least one ICD-10 diagnosis code.'); return; }
    if (nurseNeeded === true && !nurse) { setError('Select a nurse or choose "No".'); return; }

    const payload = {
      patientId: patient.id,
      symptoms: symptoms.map(s => ({
        name: s.name,
        severity: s.severity,
        duration: s.duration || undefined,
      })),
      diagnosisCodes: codes,
      notes: notes || undefined,
      nurseId: nurseNeeded && nurse ? nurse.id : undefined,
      nurseInstructions: nurseNeeded && nurseInstructions ? nurseInstructions : undefined,
      items: validItems.map(it => ({
        medicineId: it.medicineId, medicineName: it.medicineName,
        dosage: it.dosage || it.strength || '—',
        frequency: it.frequency, durationDays: it.durationDays,
        quantity: DOSES[it.frequency] * it.durationDays,
        instructions: it.instructions || undefined,
      })),
    };

    setLoading(true);
    try {
      const json = await apiFetch(`${API_BASE}/prescriptions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setWarnings({ interactions: json?.data?.interactions ?? [], allergies: json?.data?.allergyWarnings ?? [] });
      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className={styles.container}>
        <div className={styles.successBox}>
          <h3>✓ Prescription issued</h3>
          <p>Sent to pharmacy. Patient has been notified.{nurse ? ` Nurse ${nurse.first_name} ${nurse.last_name} has been assigned.` : ''}</p>
          {symptoms.length > 0 && (
            <div className={styles.successSymptoms}>
              <strong>Symptoms recorded:</strong>{' '}
              {symptoms.map(s => `${s.name} (${s.severity}${s.duration ? ', ' + s.duration : ''})`).join(' · ')}
            </div>
          )}
          {warnings.interactions.length > 0 && (
            <div className={`${styles.warningBox} ${styles.interaction}`}>
              <div className={styles.warningTitle}>⚠ Drug interaction warnings</div>
              {warnings.interactions.map((w, i) => <div key={i}>{w.drug1} + {w.drug2} ({w.severity}): {w.description}</div>)}
            </div>
          )}
          {warnings.allergies.length > 0 && (
            <div className={`${styles.warningBox} ${styles.allergy}`}>
              <div className={styles.warningTitle}>⚠ Allergy warnings</div>
              {warnings.allergies.map((w, i) => <div key={i}>{w.medicine} — patient is allergic to {w.allergen}</div>)}
            </div>
          )}
          <button className={styles.submitBtn} style={{ marginTop: 20 }} onClick={onClose ?? (() => setSuccess(false))}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>New Prescription{patient ? ` — ${patient.name}` : ''}</h1>

      <form onSubmit={handleSubmit} noValidate>
        {/* Patient selection */}
        {!patient ? (
          <div className={styles.section}>
            <PatientSearch onSelect={p => setPatient({ id: p.id, name: `${p.first_name} ${p.last_name}` })} />
          </div>
        ) : (
          <div className={styles.patientChip}>
            <span>👤 {patient.name}</span>
            <button type="button" className={styles.changeBtn} onClick={() => setPatient(null)}>Change</button>
          </div>
        )}

        {patient && (
          <>
            {/* Symptoms */}
            <SymptomsSection symptoms={symptoms} onChange={setSymptoms} />

            {/* Diagnosis */}
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Diagnosis</p>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="diagnosisCodes">ICD-10 Codes <span className={styles.req}>*</span></label>
                <input id="diagnosisCodes" className={styles.input} value={diagnosisCodes}
                  onChange={e => setDiagnosis(e.target.value)} placeholder="e.g. J06.9, R50.9 (comma-separated)" />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="notes">Clinical Notes</label>
                <textarea id="notes" className={styles.textarea} value={notes}
                  onChange={e => setNotes(e.target.value)} placeholder="Clinical notes…" />
              </div>
            </div>

            {/* Medicines */}
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Medicines</p>
              {items.map((item, i) => (
                <ItemRow key={item._key} item={item} index={i}
                  onUpdate={patch => updateItem(i, patch)}
                  onRemove={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                  onAddNew={() => handleAddNew(i)} />
              ))}
              <button type="button" className={styles.addItemBtn}
                onClick={() => setItems(prev => [...prev, newItem()])}>
                + Add another medicine
              </button>
            </div>

            {/* Nurse assignment */}
            <div className={styles.section}>
              <p className={styles.sectionTitle}>Nurse Medication Administration</p>
              <p className={styles.hint}>Should a nurse attend to this patient for medication?</p>
              <div className={styles.nurseToggle}>
                <button type="button"
                  className={`${styles.nurseToggleBtn} ${nurseNeeded === true ? styles.active : ''}`}
                  onClick={() => setNurseNeeded(true)}>
                  ✅ Yes, assign a nurse
                </button>
                <button type="button"
                  className={`${styles.nurseToggleBtn} ${nurseNeeded === false ? styles.active : ''}`}
                  onClick={() => { setNurseNeeded(false); setNurse(null); }}>
                  ❌ No
                </button>
              </div>

              {nurseNeeded === true && (
                <div style={{ marginTop: 14 }}>
                  {nurse ? (
                    <div className={styles.patientChip}>
                      <span>🩺 {nurse.first_name} {nurse.last_name} ({nurse.employee_id})</span>
                      <button type="button" className={styles.changeBtn} onClick={() => setNurse(null)}>Change</button>
                    </div>
                  ) : (
                    <NurseSearch onSelect={n => setNurse(n)} />
                  )}
                  <div className={styles.field} style={{ marginTop: 10 }}>
                    <label className={styles.label}>Nurse Instructions</label>
                    <textarea className={styles.textarea} value={nurseInstructions}
                      onChange={e => setNurseInstructions(e.target.value)}
                      placeholder="e.g. Administer IV drip every 8 hours, monitor BP…" rows={2} />
                  </div>
                </div>
              )}
            </div>

            {error && <div className={styles.errorText} role="alert">{error}</div>}

            <div className={styles.actions}>
              {onClose && <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>}
              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading ? 'Issuing…' : 'Issue Prescription'}
              </button>
            </div>
          </>
        )}
      </form>

      {showAddMed && (
        <AddMedicineModal
          onAdded={handleMedicineAdded}
          onClose={() => { setShowAddMed(false); setAddMedForIndex(null); }}
        />
      )}
    </div>
  );
}
