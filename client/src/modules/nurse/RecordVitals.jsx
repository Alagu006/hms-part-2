import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import PatientAllergies from '../../shared/components/PatientAllergies.jsx';
import styles from './RecordVitals.module.scss';

// Alert thresholds (mirrors server-side)
const ALERTS = {
  spo2        : { check: (v) => v < 94,          msg: 'SpO2 below 94% — critical' },
  temperature : { check: (v) => v > 38.5,         msg: 'Temperature above 38.5°C' },
  pulseBpm    : { check: (v) => v > 130 || v < 40, msg: 'Abnormal pulse rate' },
  bpSystolic  : { check: (v) => v > 180 || v < 80, msg: 'Abnormal systolic BP' },
  bloodGlucose: { check: (v) => v > 20 || v < 2.8, msg: 'Abnormal blood glucose' },
};

const INITIAL_FORM = {
  bpSystolic: '', bpDiastolic: '', temperature: '',
  pulseBpm: '', spo2: '', weightKg: '', bloodGlucose: '',
  respiratoryRate: '', notes: '',
};

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`${styles.toast} ${styles[type]}`} role="alert" aria-live="assertive">
      {message}
    </div>
  );
}

function formatChartDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Chart panel for a single vital
// ---------------------------------------------------------------------------
function VitalChart({ data, dataKey, label, color, unit, domain }) {
  const chartData = [...data]
    .reverse()
    .map((v) => ({
      time : formatChartDate(v.recorded_at),
      value: v[dataKey] != null ? parseFloat(v[dataKey]) : null,
    }))
    .filter((d) => d.value !== null);

  if (!chartData.length) return null;

  return (
    <div className={styles.chartPanel}>
      <h4>{label}</h4>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} domain={domain ?? ['auto', 'auto']} unit={unit} />
          <Tooltip
            formatter={(v) => [`${v}${unit ?? ''}`, label]}
            labelStyle={{ fontSize: 11 }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient search
// ---------------------------------------------------------------------------
function PatientSearch({ onSelect }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const json = await apiFetch(`${API_BASE}/patients?search=${encodeURIComponent(query.trim())}&limit=10`);
        setResults(json?.patients ?? []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className={styles.patientSearchWrap}>
      <label className={styles.label}>Search Patient</label>
      <input
        className={styles.input}
        placeholder="Enter patient name or MRN (e.g. PAT588465)…"
        value={query}
        onChange={e => { setQuery(e.target.value); setTouched(true); }}
        aria-label="Search patient"
        autoFocus
      />
      {loading && <div className={styles.searchHint}>Searching…</div>}
      {touched && !loading && query.length >= 2 && results.length === 0 && (
        <div className={styles.searchHint}>No patients found.</div>
      )}
      {results.length > 0 && (
        <ul className={styles.patientList} role="listbox">
          {results.map(p => (
            <li key={p.id} role="option" tabIndex={0}
              className={styles.patientItem}
              onClick={() => onSelect(p)}
              onKeyDown={e => e.key === 'Enter' && onSelect(p)}>
              <div className={styles.patientItemMain}>
                <span className={styles.patientName}>{p.first_name} {p.last_name}</span>
                <span className={styles.patientMrn}>{p.mrn}</span>
              </div>
              {(p.room_number || p.bed_number) && (
                <span className={styles.patientRoom}>Room {p.room_number} · Bed {p.bed_number}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function RecordVitals({ patientId: propPatientId, patientName: propPatientName }) {
  const location = useLocation();
  const statePatientId   = location.state?.patientId;
  const statePatientName = location.state?.patientName;

  const [selectedPatient, setSelectedPatient] = useState(
    propPatientId || statePatientId
      ? { id: propPatientId ?? statePatientId, name: propPatientName ?? statePatientName }
      : null
  );
  const [tab, setTab]         = useState('form');
  const [form, setForm]       = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState(null);
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const patientId   = selectedPatient?.id;
  const patientName = selectedPatient?.name;

  const fetchHistory = useCallback(async () => {
    if (!patientId) return;
    setHistLoading(true);
    try {
      const data = await apiFetch(`${API_BASE}/vitals/patient/${patientId}?days=7&limit=50`);
      setHistory(data.vitals ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setHistLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (tab === 'chart') fetchHistory();
  }, [tab, fetchHistory]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function getAlert(field) {
    const val = parseFloat(form[field]);
    if (isNaN(val)) return null;
    return ALERTS[field]?.check(val) ? ALERTS[field].msg : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { patientId };
      const numFields = [
        'bpSystolic', 'bpDiastolic', 'temperature', 'pulseBpm',
        'spo2', 'weightKg', 'bloodGlucose', 'respiratoryRate',
      ];
      for (const f of numFields) {
        if (form[f] !== '') payload[f] = parseFloat(form[f]);
      }
      if (form.notes) payload.notes = form.notes;

      const data = await apiFetch(`${API_BASE}/vitals`, {
        method : 'POST',
        body: JSON.stringify(payload),
      });

      setToast({ message: 'Vitals recorded successfully', type: 'success' });
      setForm(INITIAL_FORM);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Record Vitals{patientName ? ` — ${patientName}` : ''}</h2>
        {selectedPatient && (
          <button className={styles.changePatientBtn}
            onClick={() => { setSelectedPatient(null); setHistory([]); setForm(INITIAL_FORM); }}>
            Change Patient
          </button>
        )}
        {selectedPatient && (
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={tab === 'form'}
              className={`${styles.tab} ${tab === 'form' ? styles.active : ''}`}
              onClick={() => setTab('form')}>Record</button>
            <button role="tab" aria-selected={tab === 'chart'}
              className={`${styles.tab} ${tab === 'chart' ? styles.active : ''}`}
              onClick={() => setTab('chart')}>Chart (7d)</button>
            <button role="tab" aria-selected={tab === 'allergies'}
              className={`${styles.tab} ${tab === 'allergies' ? styles.active : ''} ${styles.tabAllergies}`}
              onClick={() => setTab('allergies')}>🚨 Allergies</button>
          </div>
        )}
      </div>

      {!selectedPatient && (
        <PatientSearch onSelect={p => setSelectedPatient({ id: p.id, name: `${p.first_name} ${p.last_name}` })} />
      )}

      {selectedPatient && tab === 'form' && (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.grid}>
            {/* Blood Pressure */}
            <div className={styles.field}>
              <label className={styles.label}>
                Blood Pressure <span className={styles.unit}>mmHg</span>
              </label>
              <div className={styles.bpRow}>
                <input
                  type="number" name="bpSystolic" className={`${styles.input} ${getAlert('bpSystolic') ? styles.alert : ''}`}
                  value={form.bpSystolic} onChange={handleChange}
                  placeholder="Sys" min={50} max={300} aria-label="Systolic BP"
                />
                <span>/</span>
                <input
                  type="number" name="bpDiastolic" className={styles.input}
                  value={form.bpDiastolic} onChange={handleChange}
                  placeholder="Dia" min={20} max={200} aria-label="Diastolic BP"
                />
              </div>
              {getAlert('bpSystolic') && <span className={styles.alertHint}>⚠ {getAlert('bpSystolic')}</span>}
            </div>

            {/* Temperature */}
            <div className={styles.field}>
              <label className={styles.label}>Temperature <span className={styles.unit}>°C</span></label>
              <input
                type="number" name="temperature" step="0.1"
                className={`${styles.input} ${getAlert('temperature') ? styles.alert : ''}`}
                value={form.temperature} onChange={handleChange}
                placeholder="37.0" min={30} max={45}
              />
              {getAlert('temperature') && <span className={styles.alertHint}>⚠ {getAlert('temperature')}</span>}
            </div>

            {/* Pulse */}
            <div className={styles.field}>
              <label className={styles.label}>Pulse <span className={styles.unit}>bpm</span></label>
              <input
                type="number" name="pulseBpm"
                className={`${styles.input} ${getAlert('pulseBpm') ? styles.alert : ''}`}
                value={form.pulseBpm} onChange={handleChange}
                placeholder="72" min={20} max={300}
              />
              {getAlert('pulseBpm') && <span className={styles.alertHint}>⚠ {getAlert('pulseBpm')}</span>}
            </div>

            {/* SpO2 */}
            <div className={styles.field}>
              <label className={styles.label}>SpO2 <span className={styles.unit}>%</span></label>
              <input
                type="number" name="spo2" step="0.1"
                className={`${styles.input} ${getAlert('spo2') ? styles.alert : ''}`}
                value={form.spo2} onChange={handleChange}
                placeholder="98" min={50} max={100}
              />
              {getAlert('spo2') && <span className={styles.alertHint}>⚠ {getAlert('spo2')}</span>}
            </div>

            {/* Weight */}
            <div className={styles.field}>
              <label className={styles.label}>Weight <span className={styles.unit}>kg</span></label>
              <input
                type="number" name="weightKg" step="0.1"
                className={styles.input} value={form.weightKg} onChange={handleChange}
                placeholder="70.0" min={0.5} max={500}
              />
            </div>

            {/* Blood Glucose */}
            <div className={styles.field}>
              <label className={styles.label}>Blood Glucose <span className={styles.unit}>mmol/L</span></label>
              <input
                type="number" name="bloodGlucose" step="0.1"
                className={`${styles.input} ${getAlert('bloodGlucose') ? styles.alert : ''}`}
                value={form.bloodGlucose} onChange={handleChange}
                placeholder="5.5" min={1} max={100}
              />
              {getAlert('bloodGlucose') && <span className={styles.alertHint}>⚠ {getAlert('bloodGlucose')}</span>}
            </div>

            {/* Respiratory Rate */}
            <div className={styles.field}>
              <label className={styles.label}>Resp. Rate <span className={styles.unit}>/min</span></label>
              <input
                type="number" name="respiratoryRate"
                className={styles.input} value={form.respiratoryRate} onChange={handleChange}
                placeholder="16" min={1} max={100}
              />
            </div>
          </div>

          <div className={`${styles.field} ${styles.notesField}`}>
            <label className={styles.label}>Notes</label>
            <textarea
              name="notes" className={styles.textarea}
              value={form.notes} onChange={handleChange}
              placeholder="Additional observations…"
            />
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Saving…' : 'Record Vitals'}
            </button>
          </div>
        </form>
      )}

      {selectedPatient && tab === 'chart' && (
        <div className={styles.chartContainer}>
          {histLoading ? (
            <div className={styles.noData}>Loading chart data…</div>
          ) : history.length === 0 ? (
            <div className={styles.noData}>No vitals recorded in the last 7 days.</div>
          ) : (
            <div className={styles.chartGrid}>
              <VitalChart data={history} dataKey="spo2_pct"      label="SpO2"        color="#1a56db" unit="%" domain={[85, 100]} />
              <VitalChart data={history} dataKey="temperature_c" label="Temperature" color="#ef4444" unit="°C" />
              <VitalChart data={history} dataKey="pulse_bpm"     label="Pulse"       color="#7c3aed" unit=" bpm" />
              <VitalChart data={history} dataKey="bp_systolic"   label="Systolic BP" color="#d97706" unit=" mmHg" />
              <VitalChart data={history} dataKey="weight_kg"     label="Weight"      color="#059669" unit=" kg" />
              <VitalChart data={history} dataKey="respiratory_rate" label="Resp. Rate" color="#0891b2" unit="/min" />
            </div>
          )}
        </div>
      )}

      {selectedPatient && tab === 'allergies' && (
        <div className={styles.allergiesContainer}>
          <PatientAllergies
            patientId={patientId}
            patientName={patientName}
          />
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
