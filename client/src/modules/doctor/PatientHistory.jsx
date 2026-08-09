import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../shared/utils/api.js';
import CDSInsightsPanel from '../cds/CDSInsightsPanel.jsx';
import styles from './PatientHistory.module.scss';

const TYPE_LABELS = {
  appointment   : 'Appointment',
  medical_record: 'Medical Record',
  lab_order     : 'Lab Order',
  vital         : 'Vitals',
  prescription  : 'Prescription',
  discharge     : 'Discharge',
};

const TYPE_ICONS = {
  appointment   : '📅',
  medical_record: '📋',
  lab_order     : '🧪',
  vital         : '💓',
  prescription  : '💊',
  discharge     : '🏥',
};

function fmt(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Patient search
// ---------------------------------------------------------------------------
function PatientSearch({ onSelect }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

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
      <h1 className={styles.title}>Patient History</h1>
      <p className={styles.searchHint}>Search for a patient to view their full medical timeline.</p>

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
                {p.room_number && (
                  <span>Room {p.room_number}{p.bed_number ? ` · Bed ${p.bed_number}` : ''}</span>
                )}
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

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------
function Timeline({ patientId, patientName }) {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/patients/${patientId}/timeline?page=${page}&limit=${limit}`)
      .then(json => {
        setItems(json?.items ?? []);
        setTotal(json?.total ?? 0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [patientId, page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.timelineWrap}>
      <div className={styles.timelineHeader}>
        <div>
          <h2 className={styles.patientTitle}>
            {patientName}
            <span className={styles.timelineLabel}>Medical Timeline</span>
          </h2>
          <p className={styles.totalCount}>{total} record{total !== 1 ? 's' : ''}</p>
        </div>
        <div className={styles.timelineActions}>
          <button
            className={styles.actionBtn}
            onClick={() => navigate('/doctor/patient-vitals', {
              state: { patientId, patientName },
            })}
          >
            📊 View Vitals
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => navigate('/doctor/prescriptions', {
              state: { patientId, patientName },
            })}
          >
            💊 New Prescription
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => navigate('/doctor/discharge', {
              state: { patientId, patientName },
            })}
          >
            🏥 Discharge
          </button>
        </div>
      </div>

      {/* CDS panel */}
      <CDSInsightsPanel patientId={patientId} collapsed={false} />

      {loading ? (
        <div className={styles.loading}>Loading timeline…</div>
      ) : error ? (
        <div className={styles.errorState}>Failed to load timeline: {error}</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>No records found for this patient.</div>
      ) : (
        <ol className={styles.timeline} aria-label="Patient medical timeline">
          {items.map(item => (
            <li key={`${item.type}-${item.id}`} className={styles.item}>
              <div className={`${styles.dot} ${styles[`dot_${item.type}`]}`} aria-hidden="true" />
              <div className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={`${styles.typeTag} ${styles[`tag_${item.type}`]}`}>
                    {TYPE_ICONS[item.type] ?? '📌'} {TYPE_LABELS[item.type] ?? item.type}
                  </span>
                  <span className={styles.date}>{fmt(item.event_date)}</span>
                </div>

                {item.doctor_name && (
                  <p className={styles.doctor}>Dr. <span>{item.doctor_name}</span></p>
                )}

                <div className={styles.meta}>
                  {item.status && <span className={styles.metaTag}>{item.status}</span>}
                  {item.sub_type && <span className={styles.metaTag}>{item.sub_type}</span>}
                </div>

                {item.notes && <p className={styles.notes}>{item.notes}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p - 1)}
            disabled={page === 1}
          >
            ← Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p + 1)}
            disabled={page === totalPages}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PatientHistory() {
  const location = useLocation();
  const navigate = useNavigate();

  const [selected, setSelected] = useState(
    location.state?.patientId
      ? { id: location.state.patientId, name: location.state.patientName ?? '' }
      : null
  );

  if (!selected) {
    return (
      <div className={styles.page}>
        <PatientSearch
          onSelect={p => setSelected({ id: p.id, name: `${p.first_name} ${p.last_name}` })}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <button
          className={styles.changeBtn}
          onClick={() => setSelected(null)}
        >
          🔍 Change Patient
        </button>
      </div>
      <Timeline patientId={selected.id} patientName={selected.name} />
    </div>
  );
}
