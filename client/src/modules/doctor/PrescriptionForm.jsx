import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './PrescriptionForm.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const FREQ_OPTIONS = ['1x', '2x', '3x', 'SOS'];
const DOSES = { '1x': 1, '2x': 2, '3x': 3, 'SOS': 1 };

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
    _key        : crypto.randomUUID(),
    medicineId  : '',
    medicineName: '',
    genericName : '',
    form        : '',
    strength    : '',
    dosage      : '',
    frequency   : '1x',
    durationDays: 7,
    instructions: '',
    searchQuery : '',
    searchResults: [],
    showDropdown: false,
  };
}

// ---------------------------------------------------------------------------
// Medicine search dropdown for a single item row
// ---------------------------------------------------------------------------
function MedicineSearch({ item, onChange }) {
  const [loading, setLoading] = useState(false);
  const debouncedQ = useDebounce(item.searchQuery);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        onChange({ showDropdown: false });
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onChange]);

  useEffect(() => {
    if (debouncedQ.length < 3) {
      onChange({ searchResults: [], showDropdown: false });
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/medicines/search?q=${encodeURIComponent(debouncedQ)}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) onChange({ searchResults: json.data ?? [], showDropdown: true });
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectMedicine(med) {
    onChange({
      medicineId  : med.id,
      medicineName: med.name,
      genericName : med.generic_name ?? '',
      form        : med.form ?? '',
      strength    : med.strength ?? '',
      dosage      : med.strength ?? '',
      searchQuery : med.name,
      showDropdown: false,
      searchResults: [],
    });
  }

  return (
    <div className={styles.searchWrapper} ref={wrapperRef}>
      <input
        className={styles.input}
        placeholder="Search medicine (min 3 chars)…"
        value={item.searchQuery}
        onChange={(e) => onChange({ searchQuery: e.target.value, medicineId: '' })}
        aria-label="Search medicine"
        aria-autocomplete="list"
        aria-expanded={item.showDropdown}
      />
      {item.showDropdown && (
        <div className={styles.dropdown} role="listbox">
          {loading && <div className={styles.noResults}>Searching…</div>}
          {!loading && item.searchResults.length === 0 && (
            <div className={styles.noResults}>No medicines found</div>
          )}
          {item.searchResults.map((med) => (
            <div
              key={med.id}
              className={styles.dropdownItem}
              role="option"
              aria-selected={item.medicineId === med.id}
              onMouseDown={() => selectMedicine(med)}
            >
              <div className={styles.drugName}>
                {med.name}
                {med.is_controlled && (
                  <span className={styles.controlledBadge}>Controlled</span>
                )}
              </div>
              <div className={styles.drugMeta}>
                {[med.generic_name, med.form, med.strength].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single prescription item row
// ---------------------------------------------------------------------------
function ItemRow({ item, index, onUpdate, onRemove }) {
  const qty = DOSES[item.frequency] * item.durationDays;

  return (
    <div className={styles.itemCard}>
      <div className={styles.itemHeader}>
        <div>
          <span className={styles.itemName}>
            {item.medicineName || `Medicine ${index + 1}`}
          </span>
          {item.strength && (
            <span className={styles.itemStrength}>{item.strength}</span>
          )}
        </div>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={onRemove}
          aria-label={`Remove ${item.medicineName || 'medicine'}`}
        >
          ✕
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Medicine <span className={styles.req}>*</span></label>
        <MedicineSearch item={item} onChange={(patch) => onUpdate(patch)} />
      </div>

      <div className={styles.itemGrid}>
        <div className={styles.field}>
          <label className={styles.label}>Dosage / Strength</label>
          <input
            className={styles.input}
            value={item.dosage}
            onChange={(e) => onUpdate({ dosage: e.target.value })}
            placeholder="e.g. 500mg"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Frequency</label>
          <div className={styles.freqGroup} role="group" aria-label="Frequency">
            {FREQ_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.freqBtn} ${item.frequency === f ? styles.active : ''}`}
                onClick={() => onUpdate({ frequency: f })}
                aria-pressed={item.frequency === f}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>
            Duration: <strong>{item.durationDays} day{item.durationDays !== 1 ? 's' : ''}</strong>
          </label>
          <div className={styles.sliderRow}>
            <input
              type="range"
              className={styles.slider}
              min={1}
              max={30}
              value={item.durationDays}
              onChange={(e) => onUpdate({ durationDays: Number(e.target.value) })}
              aria-label="Duration in days"
            />
            <span className={styles.sliderValue}>{item.durationDays}d</span>
          </div>
          <div className={styles.quantityDisplay}>
            Quantity: <span>{qty} unit{qty !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Instructions</label>
          <input
            className={styles.input}
            value={item.instructions}
            onChange={(e) => onUpdate({ instructions: e.target.value })}
            placeholder="e.g. Take after meals"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------
export default function PrescriptionForm({ patientId, patientName, onClose, onSuccess }) {
  const [items, setItems]             = useState([newItem()]);
  const [diagnosisCodes, setDiagnosis] = useState('');
  const [notes, setNotes]             = useState('');
  const [warnings, setWarnings]       = useState({ interactions: [], allergies: [] });
  const [loading, setLoading]         = useState(false);
  const [success, setSuccess]         = useState(false);
  const [error, setError]             = useState('');

  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((prev) => [...prev, newItem()]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const validItems = items.filter((it) => it.medicineId);
    if (validItems.length === 0) { setError('Add at least one medicine.'); return; }

    const codes = diagnosisCodes.split(',').map((s) => s.trim()).filter(Boolean);
    if (codes.length === 0) { setError('Enter at least one ICD-10 diagnosis code.'); return; }

    const payload = {
      patientId,
      diagnosisCodes: codes,
      notes         : notes || undefined,
      items         : validItems.map((it) => ({
        medicineId  : it.medicineId,
        medicineName: it.medicineName,
        dosage      : it.dosage || it.strength || '—',
        frequency   : it.frequency,
        durationDays: it.durationDays,
        quantity    : DOSES[it.frequency] * it.durationDays,
        instructions: it.instructions || undefined,
      })),
    };

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/prescriptions`, {
        method : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create prescription');

      // Surface non-blocking warnings
      setWarnings({
        interactions: json.data?.interactions    ?? [],
        allergies   : json.data?.allergyWarnings ?? [],
      });
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
          <p>Sent to pharmacy. Patient has been notified.</p>
          {warnings.interactions.length > 0 && (
            <div className={`${styles.warningBox} ${styles.interaction}`} style={{ marginTop: 16, textAlign: 'left' }}>
              <div className={styles.warningTitle}>⚠ Drug interaction warnings</div>
              {warnings.interactions.map((w, i) => (
                <div key={i}>{w.drug1} + {w.drug2} ({w.severity}): {w.description}</div>
              ))}
            </div>
          )}
          {warnings.allergies.length > 0 && (
            <div className={`${styles.warningBox} ${styles.allergy}`} style={{ marginTop: 12, textAlign: 'left' }}>
              <div className={styles.warningTitle}>⚠ Allergy warnings</div>
              {warnings.allergies.map((w, i) => (
                <div key={i}>{w.medicine} — patient is allergic to {w.allergen}</div>
              ))}
            </div>
          )}
          <button className={styles.submitBtn} style={{ marginTop: 20 }} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>
        New Prescription{patientName ? ` — ${patientName}` : ''}
      </h1>

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.section}>
          <p className={styles.sectionTitle}>Diagnosis</p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="diagnosisCodes">
              ICD-10 Codes <span className={styles.req}>*</span>
            </label>
            <input
              id="diagnosisCodes"
              className={styles.input}
              value={diagnosisCodes}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. J06.9, R50.9 (comma-separated)"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              className={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Clinical notes…"
            />
          </div>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>Medicines</p>

          {items.map((item, i) => (
            <ItemRow
              key={item._key}
              item={item}
              index={i}
              onUpdate={(patch) => updateItem(i, patch)}
              onRemove={() => removeItem(i)}
            />
          ))}

          <button type="button" className={styles.addItemBtn} onClick={addItem}>
            + Add another medicine
          </button>
        </div>

        {error && <div className={styles.errorText} role="alert">{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Issuing…' : 'Issue Prescription'}
          </button>
        </div>
      </form>
    </div>
  );
}
