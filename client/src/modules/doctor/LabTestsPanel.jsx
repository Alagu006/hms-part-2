import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import EncryptedFileDownload from '../../shared/components/EncryptedFileDownload.jsx';
import styles from './LabTestsPanel.module.scss';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Patient search autocomplete
// ---------------------------------------------------------------------------
function PatientSearch({ value, onChange }) {
  const [query, setQuery]     = useState('');
  const [open, setOpen]       = useState(false);
  const [display, setDisplay] = useState('');
  const ref = useRef(null);

  const { data: patients = [], isFetching } = useQuery({
    queryKey: ['patient-search', query],
    queryFn : () => apiFetch(`/patients?search=${encodeURIComponent(query)}&limit=8`)
                      .then(r => r?.patients ?? []),
    enabled : query.length >= 2,
    staleTime: 10_000,
  });

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(p) {
    onChange(p.id);
    setDisplay(`${p.first_name} ${p.last_name} (${p.mrn})`);
    setQuery('');
    setOpen(false);
  }

  function handleInput(e) {
    setDisplay(e.target.value);
    setQuery(e.target.value);
    onChange('');
    setOpen(true);
  }

  return (
    <div className={styles.patientSearch} ref={ref}>
      <input
        className={styles.input}
        value={display}
        onChange={handleInput}
        onFocus={() => query.length >= 2 && setOpen(true)}
        placeholder="Search by name or MRN…"
        autoComplete="off"
      />
      {open && (query.length >= 2) && (
        <ul className={styles.dropdown}>
          {isFetching && <li className={styles.dropdownHint}>Searching…</li>}
          {!isFetching && patients.length === 0 && (
            <li className={styles.dropdownHint}>No patients found</li>
          )}
          {patients.map(p => (
            <li key={p.id} className={styles.dropdownItem} onMouseDown={() => select(p)}>
              <span className={styles.patientName}>{p.first_name} {p.last_name}</span>
              <span className={styles.patientMrn}>{p.mrn}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order form
// ---------------------------------------------------------------------------
function OrderForm({ onSubmit, loading }) {
  const [patientId, setPatientId] = useState('');
  const [testName, setTestName]   = useState('');
  const [priority, setPriority]   = useState('ROUTINE');
  const [notes, setNotes]         = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!patientId || !testName.trim()) return;
    onSubmit({ patientId, testName: testName.trim(), priority, notes: notes.trim() || undefined });
  }

  return (
    <form className={styles.orderForm} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label}>Patient</label>
          <PatientSearch value={patientId} onChange={setPatientId} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Test Name</label>
          <input
            className={styles.input}
            value={testName}
            onChange={e => setTestName(e.target.value)}
            placeholder="e.g. CBC, LFT, Blood Glucose"
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Priority</label>
          <select className={styles.select} value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="ROUTINE">Routine</option>
            <option value="URGENT">Urgent</option>
            <option value="STAT">STAT</option>
          </select>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Notes (optional)</label>
        <input
          className={styles.input}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Additional instructions for lab"
        />
      </div>
      <button type="submit" className={styles.submitBtn} disabled={loading || !patientId}>
        {loading ? 'Sending…' : 'Send to Lab'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Results viewer
// ---------------------------------------------------------------------------
function ResultsViewer() {
  const [selectedId, setSelectedId] = useState('');
  const [searchedId, setSearchedId] = useState('');

  const { data: results = [], isLoading: resultsLoading, isError: resultsError } = useQuery({
    queryKey: ['patient-lab-results', searchedId],
    queryFn : () => apiFetch(`/lab-orders/patient/${searchedId}/results?limit=100`)
                      .then(r => r?.results ?? []),
    enabled : !!searchedId,
  });

  const { data: pendingOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['patient-lab-orders-pending', searchedId],
    queryFn : () => apiFetch(`/lab-orders?patientId=${searchedId}&limit=100`)
                      .then(r => r?.labOrders?.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED') ?? []),
    enabled : !!searchedId,
  });

  const isLoading = resultsLoading || ordersLoading;

  return (
    <div className={styles.resultsSection}>
      <div className={styles.searchRow}>
        <div className={styles.patientSearchWrap}>
          <PatientSearch value={selectedId} onChange={(id) => setSelectedId(id)} />
        </div>
        <button
          className={styles.searchBtn}
          disabled={!selectedId}
          onClick={() => setSearchedId(selectedId)}
        >
          View Results
        </button>
      </div>

      {isLoading && <div className={styles.loading}>Loading…</div>}
      {resultsError && <div className={styles.error}>Failed to load results.</div>}

      {searchedId && !isLoading && results.length === 0 && pendingOrders.length === 0 && (
        <div className={styles.empty}>No lab records found for this patient.</div>
      )}

      {pendingOrders.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Pending / In Progress</div>
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Pending lab orders">
              <thead>
                <tr><th>Test</th><th>Priority</th><th>Ordered</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pendingOrders.map(o => (
                  <tr key={o.id}>
                    <td><div className={styles.testName}>{o.test_name}</div></td>
                    <td>{o.priority}</td>
                    <td className={styles.dateCell}>{formatDate(o.ordered_at)}</td>
                    <td>
                      <span className={styles[`orderStatus${o.status}`] ?? styles.orderStatusDefault}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {results.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Completed Results</div>
          <div className={styles.tableScroll}>
            <table className={styles.table} aria-label="Patient lab results">
            <thead>
              <tr>
                <th>Test</th>
                <th>Result</th>
                <th>Interpretation</th>
                <th>Performed By</th>
                <th>Date</th>
                <th>Order Status</th>
                <th>File</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id} className={r.is_abnormal ? styles.abnormalRow : ''}>
                  <td>
                    <div className={styles.testName}>{r.test_name}</div>
                    {r.test_code && <div className={styles.testCode}>{r.test_code}</div>}
                  </td>
                  <td className={styles.resultData}>{r.result_data || '—'}</td>
                  <td>{r.interpretation || '—'}</td>
                  <td>{r.performed_by_name}</td>
                  <td className={styles.dateCell}>{formatDate(r.performed_at)}</td>
                  <td>
                    <span className={styles[`orderStatus${r.order_status}`] ?? styles.orderStatusDefault}>
                      {r.order_status ?? '—'}
                    </span>
                  </td>
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
                      ? <span className={styles.badgeAbnormal}>Abnormal</span>
                      : <span className={styles.badgeNormal}>Normal</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function LabTestsPanel() {
  const qc = useQueryClient();
  const [tab, setTab]       = useState('order');
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState('');

  const mutation = useMutation({
    mutationFn: (form) => apiFetch(`/lab-orders`, {
      method: 'POST',
      body  : JSON.stringify({
        patientId: form.patientId,
        testName : form.testName,
        priority : form.priority,
        notes    : form.notes,
      }),
    }),
    onSuccess: () => {
      setSuccess('Lab test ordered — lab technicians have been notified.');
      setError('');
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      setTimeout(() => setSuccess(''), 4000);
    },
    onError: (err) => {
      setError(err.message ?? 'Failed to send lab order.');
      setSuccess('');
    },
  });

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'order' ? styles.tabActive : ''}`}
          onClick={() => setTab('order')}
        >
          Order Test
        </button>
        <button
          className={`${styles.tab} ${tab === 'results' ? styles.tabActive : ''}`}
          onClick={() => setTab('results')}
        >
          View Results
        </button>
      </div>

      {tab === 'order' && (
        <>
          {success && <div className={styles.successMsg}>{success}</div>}
          {error   && <div className={styles.errorMsg}>{error}</div>}
          <OrderForm onSubmit={(form) => mutation.mutate(form)} loading={mutation.isPending} />
        </>
      )}

      {tab === 'results' && <ResultsViewer />}
    </div>
  );
}
