import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './VisitorCheckIn.module.scss';

const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'OTHER'];

const EMPTY_FORM = {
  visitorName: '', visitorPhone: '', relationship: '',
  idType: '', idNumber: '', purpose: '',
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`${styles.toast} ${type === 'success' ? styles.toastSuccess : styles.toastError}`}
      role="alert" aria-live="assertive">
      {type === 'success' ? '✓' : '✕'} {message}
      <button className={styles.toastClose} onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Patient lookup
// ---------------------------------------------------------------------------
function PatientLookup({ onFound }) {
  const [mrn, setMrn]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleLookup = async (e) => {
    e.preventDefault();
    if (!mrn.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch(`/patients/lookup?mrn=${encodeURIComponent(mrn.trim())}`);
      if (!res?.data) { setError('No patient found with that MRN'); return; }
      onFound(res.data);
    } catch (err) {
      // apiFetch throws a generic "Resource not found" on 404 — give a clearer message
      const msg = err.message === 'Resource not found'
        ? 'No patient found with that MRN. Check the ID and try again.'
        : (err.message ?? 'Something went wrong');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.step}>
      <p className={styles.stepHint}>Enter the patient's MRN to begin (e.g. MRN-PAT588465).</p>
      <form onSubmit={handleLookup} className={styles.mrnForm}>
        <input
          className={styles.input}
          placeholder="e.g. MRN-PAT588465"
          value={mrn}
          onChange={(e) => setMrn(e.target.value.toUpperCase())}
          autoFocus
        />
        <button className={styles.primaryBtn} disabled={loading || !mrn.trim()}>
          {loading ? 'Searching…' : 'Find Patient'}
        </button>
      </form>
      {error && <p className={styles.errorMsg}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient confirm card
// ---------------------------------------------------------------------------
function PatientCard({ patient, onReset }) {
  return (
    <div className={styles.patientCard}>
      <div className={styles.patientInfo}>
        <span className={styles.patientName}>{patient.first_name} {patient.last_name}</span>
        <span className={styles.patientMrn}>{patient.mrn}</span>
        {patient.gender && <span className={styles.patientMeta}>{patient.gender}</span>}
      </div>
      <button className={styles.resetBtn} onClick={onReset} title="Change patient">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitor name autocomplete
// ---------------------------------------------------------------------------
function VisitorAutocomplete({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen]               = useState(false);
  const debounceRef                   = useRef(null);
  const wrapRef                       = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/visitors/search?q=${encodeURIComponent(val.trim())}`);
        const list = res.data ?? res;
        setSuggestions(Array.isArray(list) ? list : []);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 300);
  };

  return (
    <div className={styles.autocompleteWrap} ref={wrapRef}>
      <input
        className={styles.input}
        placeholder="Visitor full name"
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className={styles.suggestionList} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className={styles.suggestionItem}
              role="option"
              onMouseDown={() => { onSelect(s); setOpen(false); setSuggestions([]); }}
            >
              <span className={styles.suggName}>{s.visitor_name}</span>
              {s.visitor_phone && <span className={styles.suggPhone}>{s.visitor_phone}</span>}
              {s.relationship && <span className={styles.suggRel}>{s.relationship}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past visitor picker (shown when history exists)
// ---------------------------------------------------------------------------
function PastVisitorPicker({ visitors, onSelect, onSkip }) {
  return (
    <div className={styles.pastPicker}>
      <p className={styles.pastPickerHint}>
        This visitor has visited before. Select a record to pre-fill, or add new details.
      </p>
      <ul className={styles.pastList}>
        {visitors.map((v) => (
          <li key={v.id} className={styles.pastItem}>
            <button className={styles.pastSelectBtn} onClick={() => onSelect(v)}>
              <span className={styles.pastName}>{v.visitor_name}</span>
              <span className={styles.pastMeta}>
                {v.relationship && <>{v.relationship} · </>}
                {v.visitor_phone && <>{v.visitor_phone} · </>}
                {v.id_type && <>{v.id_type}</>}
              </span>
              <span className={styles.pastDate}>
                Last visit: {new Date(v.checked_in_at).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className={styles.skipBtn} onClick={onSkip}>+ Enter new visitor details</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitor form
// ---------------------------------------------------------------------------
function VisitorForm({ patientId, onSuccess }) {
  const queryClient               = useQueryClient();
  const [form, setForm]           = useState(EMPTY_FORM);
  const [errors, setErrors]       = useState({});
  const [pastVisitors, setPast]   = useState(null); // null = not checked yet
  const [showPicker, setShowPicker] = useState(false);
  const [checkingHistory, setCheckingHistory] = useState(false);

  // Fetch visitor history for this patient on mount
  useEffect(() => {
    let cancelled = false;
    setCheckingHistory(true);
    apiFetch(`/visitors/patient/${patientId}?limit=10`)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.visitors ?? res.visitors ?? [];
        setPast(list);
        if (list.length > 0) setShowPicker(true);
      })
      .catch(() => { if (!cancelled) setPast([]); })
      .finally(() => { if (!cancelled) setCheckingHistory(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  const mutation = useMutation({
    mutationFn: (body) =>
      apiFetch(`/visitors`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visitors'] });
      onSuccess();
    },
  });

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((p) => ({ ...p, [name]: '' }));
  }

  function validate() {
    const errs = {};
    if (!form.visitorName.trim()) errs.visitorName = 'Visitor name is required';
    return errs;
  }

  function handleSelectPast(v) {
    setForm({
      visitorName  : v.visitor_name  ?? '',
      visitorPhone : v.visitor_phone ?? '',
      relationship : v.relationship  ?? '',
      idType       : v.id_type       ?? '',
      idNumber     : v.id_number     ?? '',
      purpose      : '',
    });
    setShowPicker(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const body = { patientId, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) };
    mutation.mutate(body);
  }

  if (checkingHistory) {
    return <p className={styles.stepHint}>Checking visitor history…</p>;
  }

  if (showPicker && pastVisitors?.length > 0) {
    return (
      <PastVisitorPicker
        visitors={pastVisitors}
        onSelect={handleSelectPast}
        onSkip={() => setShowPicker(false)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className={styles.visitorForm} noValidate>
      <div className={styles.formGroup}>
        <label className={styles.label}>Visitor Name *</label>
        <VisitorAutocomplete
          value={form.visitorName}
          onChange={(val) => { setForm((p) => ({ ...p, visitorName: val })); if (errors.visitorName) setErrors((p) => ({ ...p, visitorName: '' })); }}
          onSelect={handleSelectPast}
        />
        {errors.visitorName && <span className={styles.fieldError}>{errors.visitorName}</span>}
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.label}>Phone</label>
          <input className={styles.input} name="visitorPhone" value={form.visitorPhone} onChange={handleChange} placeholder="+1 555 000 0000" />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Relationship</label>
          <input className={styles.input} name="relationship" value={form.relationship} onChange={handleChange} placeholder="e.g. Spouse, Parent" />
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.label}>ID Type</label>
          <select className={styles.select} name="idType" value={form.idType} onChange={handleChange}>
            <option value="">— Select —</option>
            {ID_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>ID Number</label>
          <input className={styles.input} name="idNumber" value={form.idNumber} onChange={handleChange} placeholder="ID / Passport number" />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Purpose of Visit</label>
        <input className={styles.input} name="purpose" value={form.purpose} onChange={handleChange} placeholder="e.g. Family visit, Post-op check" />
      </div>

      {mutation.isError && (
        <p className={styles.errorMsg}>{mutation.error?.message ?? 'Failed to log visitor'}</p>
      )}

      <div className={styles.formActions}>
        {pastVisitors?.length > 0 && (
          <button type="button" className={styles.secondaryBtn} onClick={() => setShowPicker(true)}>
            ← Past visitors
          </button>
        )}
        <button type="submit" className={styles.primaryBtn} disabled={mutation.isPending}>
          {mutation.isPending ? 'Logging…' : 'Check In Visitor'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default function VisitorCheckIn({ onDone }) {
  const [patient, setPatient] = useState(null);
  const [toast, setToast]     = useState(null);

  const handleSuccess = useCallback(() => {
    setToast({ message: 'Visitor checked in successfully.', type: 'success' });
    setTimeout(() => { setPatient(null); onDone?.(); }, 1500);
  }, [onDone]);

  return (
    <div className={styles.checkInWrap}>
      <h2 className={styles.checkInTitle}>Visitor Check-In</h2>

      {!patient ? (
        <PatientLookup onFound={setPatient} />
      ) : (
        <>
          <PatientCard patient={patient} onReset={() => setPatient(null)} />
          <VisitorForm patientId={patient.id} onSuccess={handleSuccess} />
        </>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
