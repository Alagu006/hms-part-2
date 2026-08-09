import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../shared/utils/api.js';
import PatientAllergies from '../../shared/components/PatientAllergies.jsx';
import styles from './PatientVitalsView.module.scss';

function fmt(iso) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function VitalChart({ data, dataKey, label, color, unit, domain }) {
  const chartData = [...data].reverse()
    .map(v => ({ time: fmt(v.recorded_at), value: v[dataKey] != null ? parseFloat(v[dataKey]) : null }))
    .filter(d => d.value !== null);
  if (!chartData.length) return null;
  return (
    <div className={styles.chartPanel}>
      <h4>{label}</h4>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} domain={domain ?? ['auto', 'auto']} unit={unit} />
          <Tooltip formatter={v => [`${v}${unit ?? ''}`, label]} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Patient search ────────────────────────────────────────────────────────────
function PatientSearch({ onSelect }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // Auto-focus on mount (also triggered by V shortcut)
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const json = await apiFetch(
          `/patients?search=${encodeURIComponent(query.trim())}&limit=10`
        );
        setResults(json?.patients ?? []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  return (
    <div className={styles.searchWrap}>
      <h1 className={styles.title}>Patient Vitals</h1>
      <p className={styles.searchHint}>Search for a patient to view their vitals history.</p>

      <div className={styles.searchBox}>
        <span className={styles.searchIcon} aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Enter patient name or MRN…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search patient"
          autoComplete="off"
        />
        {loading && <span className={styles.searchSpinner} aria-hidden="true" />}
      </div>

      {query.length >= 2 && !loading && results.length === 0 && (
        <p className={styles.noResults}>No patients found for "{query}"</p>
      )}

      {results.length > 0 && (
        <ul className={styles.resultList} role="listbox" aria-label="Patient results">
          {results.map(p => (
            <li
              key={p.id}
              className={styles.resultItem}
              role="option"
              tabIndex={0}
              onClick={() => onSelect(p)}
              onKeyDown={e => e.key === 'Enter' && onSelect(p)}
            >
              <div className={styles.resultMain}>
                <span className={styles.resultName}>{p.first_name} {p.last_name}</span>
                <span className={styles.resultMrn}>{p.mrn}</span>
              </div>
              <div className={styles.resultMeta}>
                {p.date_of_birth && <span>{p.date_of_birth}</span>}
                {p.room_number && <span>Room {p.room_number}{p.bed_number ? ` · Bed ${p.bed_number}` : ''}</span>}
                <span className={`${styles.resultStatus} ${p.status === 'inpatient' ? styles.inpatient : styles.outpatient}`}>
                  {p.status ?? 'outpatient'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PatientVitalsView() {
  const location = useLocation();
  const navigate  = useNavigate();

  // Accept patient from navigation state OR from inline search
  const [selected, setSelected] = useState(
    location.state?.patientId
      ? { id: location.state.patientId, name: location.state.patientName }
      : null
  );

  const [vitals, setVitals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays]     = useState(30);
  const [view, setView]     = useState('table');

  const patientId   = selected?.id;
  const patientName = selected?.name;

  const fetchVitals = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const json = await apiFetch(`/vitals/patient/${patientId}?days=${days}&limit=100`);
      setVitals(json?.vitals ?? []);
    } catch { setVitals([]); }
    finally { setLoading(false); }
  }, [patientId, days]);

  useEffect(() => { fetchVitals(); }, [fetchVitals]);

  // No patient yet — show search
  if (!selected) {
    return (
      <div className={styles.page}>
        <PatientSearch
          onSelect={p => setSelected({ id: p.id, name: `${p.first_name} ${p.last_name}` })}
        />
      </div>
    );
  }

  const latest = vitals[0];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
          <h1 className={styles.title}>Vitals — {patientName}</h1>
        </div>
        <div className={styles.controls}>
          <button className={styles.changeBtn} onClick={() => { setSelected(null); setVitals([]); }}>
            🔍 Change Patient
          </button>
          <select className={styles.select} value={days} onChange={e => setDays(+e.target.value)}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <div className={styles.viewToggle}>
            <button className={`${styles.viewBtn} ${view === 'table' ? styles.active : ''}`} onClick={() => setView('table')}>Table</button>
            <button className={`${styles.viewBtn} ${view === 'chart' ? styles.active : ''}`} onClick={() => setView('chart')}>Charts</button>
            <button className={`${styles.viewBtn} ${view === 'allergies' ? styles.active : ''}`} onClick={() => setView('allergies')}>🚨 Allergies</button>
          </div>
        </div>
      </div>

      {latest && (
        <div className={styles.latestCard}>
          <span className={styles.latestLabel}>Latest — {fmt(latest.recorded_at)} · by {latest.recorded_by_name}</span>
          <div className={styles.latestGrid}>
            {latest.bp_systolic && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.bp_systolic}/{latest.bp_diastolic}</span><span className={styles.latestUnit}>mmHg BP</span></div>}
            {latest.temperature_c && <div className={styles.latestItem}><span className={`${styles.latestVal} ${parseFloat(latest.temperature_c) > 38.5 ? styles.alert : ''}`}>{latest.temperature_c}</span><span className={styles.latestUnit}>°C Temp</span></div>}
            {latest.pulse_bpm && <div className={styles.latestItem}><span className={`${styles.latestVal} ${(latest.pulse_bpm > 130 || latest.pulse_bpm < 40) ? styles.alert : ''}`}>{latest.pulse_bpm}</span><span className={styles.latestUnit}>bpm Pulse</span></div>}
            {latest.spo2_pct && <div className={styles.latestItem}><span className={`${styles.latestVal} ${parseFloat(latest.spo2_pct) < 94 ? styles.alert : ''}`}>{latest.spo2_pct}%</span><span className={styles.latestUnit}>SpO2</span></div>}
            {latest.weight_kg && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.weight_kg}</span><span className={styles.latestUnit}>kg Weight</span></div>}
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : vitals.length === 0 && view !== 'allergies' ? (
        <div className={styles.empty}>No vitals recorded in the last {days} days.</div>
      ) : view === 'chart' ? (
        <div className={styles.chartGrid}>
          <VitalChart data={vitals} dataKey="spo2_pct"        label="SpO2"        color="#1a56db" unit="%" domain={[85,100]} />
          <VitalChart data={vitals} dataKey="temperature_c"   label="Temperature" color="#ef4444" unit="°C" />
          <VitalChart data={vitals} dataKey="pulse_bpm"       label="Pulse"       color="#7c3aed" unit=" bpm" />
          <VitalChart data={vitals} dataKey="bp_systolic"     label="Systolic BP" color="#d97706" unit=" mmHg" />
          <VitalChart data={vitals} dataKey="weight_kg"       label="Weight"      color="#059669" unit=" kg" />
          <VitalChart data={vitals} dataKey="respiratory_rate" label="Resp. Rate" color="#0891b2" unit="/min" />
        </div>
      ) : view === 'allergies' ? (
        <div className={styles.allergiesWrap}>
          <PatientAllergies patientId={patientId} patientName={patientName} />
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Date & Time</th><th>BP (mmHg)</th><th>Temp (°C)</th><th>Pulse (bpm)</th><th>SpO2</th><th>Weight (kg)</th><th>Resp. Rate</th><th>Nurse</th></tr>
            </thead>
            <tbody>
              {vitals.map(v => (
                <tr key={v.id} className={styles.row}>
                  <td>{fmt(v.recorded_at)}</td>
                  <td>{v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                  <td className={parseFloat(v.temperature_c) > 38.5 ? styles.alertCell : ''}>{v.temperature_c ?? '—'}</td>
                  <td className={(v.pulse_bpm > 130 || v.pulse_bpm < 40) ? styles.alertCell : ''}>{v.pulse_bpm ?? '—'}</td>
                  <td className={parseFloat(v.spo2_pct) < 94 ? styles.alertCell : ''}>{v.spo2_pct != null ? `${v.spo2_pct}%` : '—'}</td>
                  <td>{v.weight_kg ?? '—'}</td>
                  <td>{v.respiratory_rate ?? '—'}</td>
                  <td className={styles.nurse}>{v.recorded_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
