import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './MyVitals.module.scss';

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

function VitalRow({ vital }) {
  return (
    <tr className={styles.row}>
      <td>{fmt(vital.recorded_at)}</td>
      <td>{vital.bp_systolic && vital.bp_diastolic ? `${vital.bp_systolic}/${vital.bp_diastolic}` : '—'}</td>
      <td>{vital.temperature_c ?? '—'}</td>
      <td>{vital.pulse_bpm ?? '—'}</td>
      <td>{vital.spo2_pct != null ? `${vital.spo2_pct}%` : '—'}</td>
      <td>{vital.weight_kg ?? '—'}</td>
      <td>{vital.respiratory_rate ?? '—'}</td>
      <td className={styles.nurse}>{vital.recorded_by_name ?? '—'}</td>
    </tr>
  );
}

export default function MyVitals() {
  const [patientId, setPatientId] = useState(null);
  const [vitals, setVitals]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState('table'); // table | chart
  const [days, setDays]           = useState(30);

  // Resolve own patient ID
  useEffect(() => {
    apiFetch(`/patients/my`)
      .then(d => setPatientId(d?.data?.id))
      .catch(console.error);
  }, []);

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

  const latest = vitals[0];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Vitals</h1>
        <div className={styles.controls}>
          <select className={styles.select} value={days} onChange={e => setDays(+e.target.value)}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <div className={styles.viewToggle}>
            <button className={`${styles.viewBtn} ${view === 'table' ? styles.active : ''}`} onClick={() => setView('table')}>Table</button>
            <button className={`${styles.viewBtn} ${view === 'chart' ? styles.active : ''}`} onClick={() => setView('chart')}>Charts</button>
          </div>
        </div>
      </div>

      {/* Latest reading summary */}
      {latest && (
        <div className={styles.latestCard}>
          <span className={styles.latestLabel}>Latest reading — {fmt(latest.recorded_at)}</span>
          <div className={styles.latestGrid}>
            {latest.bp_systolic && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.bp_systolic}/{latest.bp_diastolic}</span><span className={styles.latestUnit}>mmHg BP</span></div>}
            {latest.temperature_c && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.temperature_c}</span><span className={styles.latestUnit}>°C Temp</span></div>}
            {latest.pulse_bpm && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.pulse_bpm}</span><span className={styles.latestUnit}>bpm Pulse</span></div>}
            {latest.spo2_pct && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.spo2_pct}%</span><span className={styles.latestUnit}>SpO2</span></div>}
            {latest.weight_kg && <div className={styles.latestItem}><span className={styles.latestVal}>{latest.weight_kg}</span><span className={styles.latestUnit}>kg Weight</span></div>}
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>Loading…</div>
      ) : vitals.length === 0 ? (
        <div className={styles.empty}>No vitals recorded yet.</div>
      ) : view === 'chart' ? (
        <div className={styles.chartGrid}>
          <VitalChart data={vitals} dataKey="spo2_pct"        label="SpO2"        color="#1a56db" unit="%" domain={[85,100]} />
          <VitalChart data={vitals} dataKey="temperature_c"   label="Temperature" color="#ef4444" unit="°C" />
          <VitalChart data={vitals} dataKey="pulse_bpm"       label="Pulse"       color="#7c3aed" unit=" bpm" />
          <VitalChart data={vitals} dataKey="bp_systolic"     label="Systolic BP" color="#d97706" unit=" mmHg" />
          <VitalChart data={vitals} dataKey="weight_kg"       label="Weight"      color="#059669" unit=" kg" />
          <VitalChart data={vitals} dataKey="respiratory_rate" label="Resp. Rate" color="#0891b2" unit="/min" />
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date & Time</th><th>BP (mmHg)</th><th>Temp (°C)</th>
                <th>Pulse (bpm)</th><th>SpO2</th><th>Weight (kg)</th>
                <th>Resp. Rate</th><th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map(v => <VitalRow key={v.id} vital={v} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
