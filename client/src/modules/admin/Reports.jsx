import { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './Reports.module.scss';

const REPORT_TYPES = [
  { value: 'patient',   label: 'Patient Statistics' },
  { value: 'financial', label: 'Financial Summary' },
  { value: 'staff',     label: 'Staff Performance' },
];

const FORMATS = [
  { value: 'csv',  label: 'CSV' },
  { value: 'pdf',  label: 'PDF / JSON' },
];

const PERIODS = [
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const POLL_INTERVAL = 2500; // ms

export default function Reports() {
  const [form, setForm]       = useState({ type: 'patient', format: 'csv', period: '30d' });
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId]     = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError]     = useState(null);
  const pollRef               = useRef(null);

  // ---------------------------------------------------------------------------
  // Load history on mount
  // ---------------------------------------------------------------------------
  const fetchHistory = useCallback(async () => {
    try {
      const json = await apiFetch(`/analytics/reports/history`);
      setHistory(json?.history ?? json ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchHistory();
    return () => clearInterval(pollRef.current);
  }, [fetchHistory]);

  const startPolling = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await apiFetch(`/analytics/reports/status/${id}`);
        setJobStatus(status);
        if (status?.status === 'completed' || status?.status === 'failed') {
          clearInterval(pollRef.current);
          setGenerating(false);
          fetchHistory();
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL);
  }, [fetchHistory]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setJobId(null);
    setJobStatus(null);
    setError(null);

    try {
      const params = new URLSearchParams(form).toString();
      const json = await apiFetch(`/analytics/reports/generate?${params}`);
      const id = json?.jobId;
      if (!id) throw new Error(json?.error ?? 'Failed to enqueue');
      setJobId(id);
      setJobStatus({ status: 'pending' });
      startPolling(id);
    } catch (e) {
      setError(e.message);
      setGenerating(false);
    }
  };

  const handleDownload = async (downloadKey, filename) => {
    const filenamePart = downloadKey.startsWith('report:file:')
      ? downloadKey.slice('report:file:'.length)
      : downloadKey;
    const blob = await apiFetch(`/analytics/reports/download/${encodeURIComponent(filenamePart)}`);
    if (!blob) { setError('Download failed or file expired'); return; }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename ?? filenamePart;
    a.click();
    URL.revokeObjectURL(url);
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Reports</h1>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.grid}>
        {/* Generate form */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Generate Report</h2>
          <form className={styles.form} onSubmit={handleGenerate}>
            <label className={styles.label}>
              Report Type
              <select value={form.type} onChange={set('type')}>
                {REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>

            <div className={styles.row}>
              <label className={styles.label}>
                Period
                <select value={form.period} onChange={set('period')}>
                  {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              <label className={styles.label}>
                Format
                <select value={form.format} onChange={set('format')}>
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
            </div>

            <button type="submit" className={styles.generateBtn} disabled={generating}>
              {generating && <span className={styles.spinner} />}
              {generating ? 'Generating…' : 'Generate Report'}
            </button>
          </form>

          {/* Job status */}
          {jobStatus && (
            <div className={`${styles.statusBox} ${styles[jobStatus.status]}`}>
              <span>
                {jobStatus.status === 'pending'   && 'Report is being generated…'}
                {jobStatus.status === 'completed' && `Ready: ${jobStatus.filename}`}
                {jobStatus.status === 'failed'    && `Failed: ${jobStatus.error ?? 'Unknown error'}`}
              </span>
              {jobStatus.status === 'completed' && jobStatus.downloadKey && (
                <button
                  className={styles.downloadBtn}
                  onClick={() => handleDownload(jobStatus.downloadKey, jobStatus.filename)}
                >
                  Download
                </button>
              )}
            </div>
          )}
        </div>

        {/* Info card */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>About Reports</h2>
          <p className={styles.infoText}>
            Reports are generated asynchronously. Once submitted, the status updates automatically.
            Download links are valid for <strong>1 hour</strong>.
          </p>
          <ul className={styles.infoList}>
            <li><strong>Patient</strong> — admissions trend, occupancy, dept distribution</li>
            <li><strong>Financial</strong> — daily revenue, outstanding, payment methods</li>
            <li><strong>Staff</strong> — doctor performance, prescriptions, appointments</li>
          </ul>
        </div>

        {/* History */}
        <div className={`${styles.card} ${styles.historySection}`}>
          <h2 className={styles.cardTitle}>Report History</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Type</th><th>Period</th><th>Format</th>
                  <th>Status</th><th>Created</th><th>Download</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id ?? r.job_id}>
                    <td style={{ textTransform: 'capitalize' }}>{r.type}</td>
                    <td>{r.period}</td>
                    <td style={{ textTransform: 'uppercase' }}>{r.format}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                    <td>
                      {r.status === 'completed' && r.download_key ? (
                        <button
                          className={styles.dlLink}
                          onClick={() => handleDownload(r.download_key, r.filename)}
                        >
                          Download
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
                {!history.length && (
                  <tr><td colSpan={6} className={styles.empty}>No reports generated yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
