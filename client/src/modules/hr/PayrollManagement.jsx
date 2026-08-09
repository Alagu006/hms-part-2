import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './PayrollManagement.module.scss';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
const fetchRuns = (year) =>
  apiFetch(`/payroll/runs${year ? `?year=${year}` : ''}`);

const fetchRunDetails = (runId) =>
  apiFetch(`/payroll/runs/${runId}/details?limit=100`);

const createRun = (body) =>
  apiFetch(`/payroll/runs`, { method: 'POST', body: JSON.stringify(body) });

const processRun = (runId) =>
  apiFetch(`/payroll/runs/${runId}/process`, { method: 'POST', body: JSON.stringify({}) });

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  const map = {
    DRAFT      : { label: 'Draft',      color: '#6b7280', bg: '#f3f4f6' },
    PROCESSING : { label: 'Processing', color: '#d97706', bg: '#fef3c7' },
    PROCESSED  : { label: 'Processed',  color: '#059669', bg: '#d1fae5' },
    ERROR      : { label: 'Error',      color: '#dc2626', bg: '#fee2e2' },
  };
  const s = map[status] ?? { label: status, color: '#6b7280', bg: '#f3f4f6' };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create run modal
// ---------------------------------------------------------------------------
function CreateRunModal({ onClose, onCreated }) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createRun({ periodYear: year, periodMonth: month, notes: notes || undefined });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Create payroll run">
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>Create Payroll Run</h3>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formRow}>
            <label className={styles.label}>Year</label>
            <input type="number" className={styles.input} value={year}
              onChange={e => setYear(parseInt(e.target.value, 10))}
              min={2020} max={2099} required />
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>Month</label>
            <select className={styles.input} value={month} onChange={e => setMonth(parseInt(e.target.value, 10))}>
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className={styles.formRow}>
            <label className={styles.label}>Notes</label>
            <input type="text" className={styles.input} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.modalActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? 'Creating…' : 'Create Run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run details panel
// ---------------------------------------------------------------------------
function RunDetailsPanel({ run, onClose }) {
  const queryClient = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-run-details', run.id],
    queryFn : () => fetchRunDetails(run.id),
    enabled : !!run.id,
  });

  const details = data?.details ?? [];

  async function handleProcess() {
    setProcessing(true);
    setProcessError('');
    try {
      await processRun(run.id);
      queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-run-details', run.id] });
    } catch (err) {
      setProcessError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className={styles.detailsPanel}>
      <div className={styles.detailsHeader}>
        <div>
          <h3 className={styles.detailsTitle}>
            {MONTHS[run.period_month - 1]} {run.period_year} Payroll
          </h3>
          <StatusBadge status={run.status} />
        </div>
        <div className={styles.detailsActions}>
          {(run.status === 'DRAFT' || run.status === 'ERROR') && (
            <button className={styles.primaryBtn} onClick={handleProcess} disabled={processing}>
              {processing ? 'Processing…' : 'Process Run'}
            </button>
          )}
          <button className={styles.cancelBtn} onClick={onClose}>Close</button>
        </div>
      </div>

      {processError && <div className={styles.error}>{processError}</div>}

      {run.status === 'PROCESSED' && (
        <div className={styles.summaryRow}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Total Gross</span>
            <span className={styles.summaryValue}>₹{Number(run.total_gross ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Total Deductions</span>
            <span className={styles.summaryValue}>₹{Number(run.total_deductions ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Total Net Pay</span>
            <span className={`${styles.summaryValue} ${styles.netPay}`}>₹{Number(run.total_net ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {run.error_count > 0 && (
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Errors</span>
              <span className={`${styles.summaryValue} ${styles.errorValue}`}>{run.error_count}</span>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className={styles.loading}>Loading payslips…</div>
      ) : details.length === 0 ? (
        <div className={styles.empty}>No payslips yet. Process the run to generate them.</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Working Days</th>
                <th>Present</th>
                <th>Leave</th>
                <th>Gross</th>
                <th>Tax</th>
                <th>PF</th>
                <th>Net Pay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {details.map(d => (
                <tr key={d.id} className={d.has_error ? styles.errorRow : ''}>
                  <td>
                    <div className={styles.empName}>{d.first_name} {d.last_name}</div>
                    <div className={styles.empId}>{d.employee_id}</div>
                  </td>
                  <td>{d.department_name ?? '—'}</td>
                  <td className={styles.numCell}>{d.working_days}</td>
                  <td className={styles.numCell}>{d.present_days}</td>
                  <td className={styles.numCell}>{d.leave_days}</td>
                  <td className={styles.numCell}>₹{Number(d.gross_salary).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className={styles.numCell}>₹{Number(d.tax_deduction).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className={styles.numCell}>₹{Number(d.pf_deduction).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className={`${styles.numCell} ${styles.netCell}`}>₹{Number(d.net_salary).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td>
                    {d.has_error
                      ? <span className={styles.errorBadge} title={d.error_reason}>Error</span>
                      : <span className={styles.okBadge}>OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function PayrollManagement() {
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showCreate, setShowCreate]     = useState(false);
  const [selectedRun, setSelectedRun]   = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payroll-runs', selectedYear],
    queryFn : () => fetchRuns(selectedYear),
  });

  const runs = data?.runs ?? [];

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Payroll Management</h1>
        <div className={styles.headerActions}>
          <select className={styles.yearSelect} value={selectedYear}
            onChange={e => setSelectedYear(parseInt(e.target.value, 10))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className={styles.primaryBtn} onClick={() => setShowCreate(true)}>
            + New Run
          </button>
        </div>
      </div>

      {isLoading && <div className={styles.loading}>Loading payroll runs…</div>}
      {isError   && <div className={styles.error}>Failed to load payroll runs.</div>}

      {!isLoading && !isError && (
        <div className={styles.runsGrid}>
          {runs.length === 0 ? (
            <div className={styles.empty}>No payroll runs for {selectedYear}. Create one to get started.</div>
          ) : (
            runs.map(run => (
              <div key={run.id} className={`${styles.runCard} ${selectedRun?.id === run.id ? styles.active : ''}`}
                onClick={() => setSelectedRun(run)} role="button" tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelectedRun(run)}>
                <div className={styles.runMonth}>{MONTHS[run.period_month - 1]} {run.period_year}</div>
                <StatusBadge status={run.status} />
                {run.status === 'PROCESSED' && (
                  <div className={styles.runNet}>
                    Net: ₹{Number(run.total_net ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                )}
                {run.error_count > 0 && (
                  <div className={styles.runErrors}>{run.error_count} error{run.error_count > 1 ? 's' : ''}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {selectedRun && (
        <RunDetailsPanel
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}

      {showCreate && (
        <CreateRunModal
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })}
        />
      )}
    </div>
  );
}
