import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './MyLabResults.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

async function downloadLabFile(fileId, fileName) {
  try {
    const token = sessionStorage.getItem('accessToken');
    const csrfRes = await fetch('/api/auth/csrf-token', { credentials: 'include' });
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${API_BASE}/files/${fileId}/download`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName ?? 'lab-result';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[downloadLabFile]', err);
    alert('Could not download file. Please try again.');
  }
}

export default function MyLabResults() {
  const [patientId, setPatientId] = useState(null);
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  // Resolve the patient record ID for the logged-in user
  useEffect(() => {
    apiFetch(`${API_BASE}/patients/my`)
      .then(r => setPatientId(r?.data?.id ?? r?.id ?? null))
      .catch(() => setError('Could not load patient profile.'));
  }, []);

  const fetchResults = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    try {
      const resData = await apiFetch(`${API_BASE}/lab-orders/patient/${patientId}/results?limit=100`);
      setResults(resData?.results ?? []);
    } catch (err) {
      setError('Failed to load lab results.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>My Lab Results</h2>
      </div>

      {loading && <div className={styles.loading}>Loading…</div>}
      {error   && <div className={styles.error}>{error}</div>}

      {!loading && !error && results.length === 0 && (
        <div className={styles.empty}>No lab results found.</div>
      )}

      {results.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Completed Results</h3>
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Lab results">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Result</th>
                  <th>Interpretation</th>
                  <th>Date</th>
                  <th>Report</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id} className={r.is_abnormal ? styles.abnormal : ''}>
                    <td>
                      <div className={styles.testName}>{r.test_name}</div>
                      {r.test_code && <div className={styles.testCode}>{r.test_code}</div>}
                    </td>
                    <td>{r.result_data || '—'}</td>
                    <td>{r.interpretation || '—'}</td>
                    <td>{formatDate(r.performed_at)}</td>
                    <td>
                      {r.file_id
                        ? <button
                            className={styles.fileBtn}
                            onClick={() => downloadLabFile(r.file_id, r.file_name)}
                          >
                            📎 {r.file_name}
                          </button>
                        : '—'
                      }
                    </td>
                    <td>
                      {r.is_abnormal
                        ? <span className={`${styles.badge} ${styles.badgeAbnormal}`}>Abnormal</span>
                        : <span className={`${styles.badge} ${styles.badgeNormal}`}>Normal</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
