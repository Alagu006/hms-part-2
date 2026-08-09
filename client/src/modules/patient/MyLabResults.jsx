import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/api.js';
import EncryptedFileDownload from '../../shared/components/EncryptedFileDownload.jsx';
import styles from './MyLabResults.module.scss';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default function MyLabResults() {
  const [patientId, setPatientId] = useState(null);
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  // Resolve the patient record ID for the logged-in user
  useEffect(() => {
    apiFetch(`/patients/my`)
      .then(r => setPatientId(r?.data?.id ?? r?.id ?? null))
      .catch(() => setError('Could not load patient profile.'));
  }, []);

  const fetchResults = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    try {
      const resData = await apiFetch(`/lab-orders/patient/${patientId}/results?limit=100`);
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
                        ? <EncryptedFileDownload
                            fileId={r.file_id}
                            fileName={r.file_name ?? `lab-result_${r.id}`}
                          />
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
