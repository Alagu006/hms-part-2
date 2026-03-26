import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import EncryptedFileUpload from '../../shared/components/EncryptedFileUpload.jsx';
import styles from './LabDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionStorage.getItem('accessToken')}`,
  };
}

function today() {
  return new Date().toISOString().split('T')[0];
}

async function fetchOrders(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) q.set(k, v); });
  const res = await fetch(`${API_BASE}/lab-orders?${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load orders');
  const json = await res.json();
  return json.labOrders ?? [];
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Inline upload panel for a single order
// ---------------------------------------------------------------------------
function UploadPanel({ order, onClose, onComplete }) {
  const [resultText, setResultText] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const qc = useQueryClient();

  function handleFileSuccess({ fileId, fileName, ivB64, keyB64 }) {
    setUploadedFile({ fileId, fileName, ivB64, keyB64 });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!resultText.trim() && !uploadedFile) {
      setError('Provide a result or upload a file.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/lab-orders/results`, {
        method : 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          labOrderId     : order.id,
          resultText     : resultText.trim() || undefined,
          interpretation: resultText.trim() || undefined,
          fileId         : uploadedFile?.fileId,
          fileKey        : uploadedFile?.keyB64,
          fileIv         : uploadedFile?.ivB64,
          isAbnormal     : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to submit result');

      // Mark order as completed
      await fetch(`${API_BASE}/lab-orders/${order.id}`, {
        method : 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.uploadPanel}>
      <div className={styles.uploadHeader}>
        <span className={styles.uploadTitle}>
          Upload Result — {order.test_name}
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className={styles.uploadField}>
          <label className={styles.label} htmlFor={`result-${order.id}`}>
            Result Text
          </label>
          <textarea
            id={`result-${order.id}`}
            className={styles.textarea}
            value={resultText}
            onChange={e => setResultText(e.target.value)}
            placeholder="Enter lab result values, observations, and findings…"
            rows={4}
          />
        </div>
        <div className={styles.uploadField}>
          <label className={styles.label}>Attach Report (optional)</label>
          <EncryptedFileUpload
            entityType="lab_result"
            entityId={order.id}
            onSuccess={handleFileSuccess}
          />
          {uploadedFile && (
            <span className={styles.fileAttached}>
              ✓ {uploadedFile.fileName} attached
            </span>
          )}
        </div>
        {error && <p className={styles.fieldError}>{error}</p>}
        <div className={styles.uploadActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting || (!resultText.trim() && !uploadedFile)}
          >
            {submitting ? 'Submitting…' : 'Submit & Complete'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order table row
// ---------------------------------------------------------------------------
function OrderRow({ order, action, qc }) {
  const [showUpload, setShowUpload] = useState(false);

  const priorityClass = {
    STAT   : styles.priorityStat,
    URGENT : styles.priorityUrgent,
    ROUTINE: styles.priorityRoutine,
  }[order.priority] ?? styles.priorityRoutine;

  async function handleAction(newStatus) {
    try {
      await fetch(`${API_BASE}/lab-orders/${order.id}`, {
        method : 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
    } catch { /* silent */ }
  }

  const completedAt = order.collected_at
    ? timeAgo(order.collected_at)
    : null;

  return (
    <>
      <tr className={styles.tableRow}>
        <td>
          <div className={styles.patientName}>
            {order.patient_first_name} {order.patient_last_name}
          </div>
          <div className={styles.mrn}>{order.mrn}</div>
        </td>
        <td className={styles.testName}>{order.test_name}</td>
        <td>
          <span className={`${styles.priorityBadge} ${priorityClass}`}>
            {order.priority}
          </span>
        </td>
        <td className={styles.orderedBy}>{order.ordered_by_name}</td>
        <td className={styles.timeCell}>{timeAgo(order.ordered_at)}</td>
        <td className={styles.actionsCell}>
          {action === 'pending' && (
            <>
              <button
                className={styles.actionBtn}
                onClick={() => handleAction('PROCESSING')}
              >
                Start
              </button>
              <button
                className={styles.uploadBtn}
                onClick={() => setShowUpload(true)}
              >
                Upload Result
              </button>
            </>
          )}
          {action === 'in_progress' && (
            <>
              <button
                className={styles.completeBtn}
                onClick={() => handleAction('COMPLETED')}
              >
                Complete
              </button>
              <button
                className={styles.uploadBtn}
                onClick={() => setShowUpload(true)}
              >
                Upload Result
              </button>
            </>
          )}
          {action === 'completed' && completedAt && (
            <span className={styles.completedAt}>{completedAt}</span>
          )}
        </td>
      </tr>
      {showUpload && (
        <tr>
          <td colSpan={6} className={styles.uploadRow}>
            <UploadPanel
              order={order}
              onClose={() => setShowUpload(false)}
              onComplete={() => setShowUpload(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function OrderTable({ orders, action, loading, emptyMsg, qc }) {
  return (
    <div className={styles.tableWrapper}>
      {loading ? (
        <div className={styles.loadingRow}>
          {[1, 2, 3].map(i => (
            <div key={i} className={styles.skeleton} style={{ height: 52, marginBottom: 1 }} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className={styles.emptyState}>{emptyMsg}</div>
      ) : (
        <table className={styles.table} aria-label={`Lab orders — ${action}`}>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Test</th>
              <th>Priority</th>
              <th>Ordered By</th>
              <th>Ordered</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <OrderRow key={o.id} order={o} action={action} qc={qc} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, alert, loading }) {
  return (
    <div className={`${styles.statCard} ${alert ? styles.statAlert : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      {loading
        ? <div className={styles.skeleton} style={{ width: 40, height: 32, marginTop: 6 }} />
        : <span className={`${styles.statValue} ${alert ? styles.statAlertVal : ''}`}>{value}</span>
      }
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function LabDashboard() {
  const qc = useQueryClient();
  const todayDate = today();

  const { data: pendingOrders = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['lab-orders', 'PENDING'],
    queryFn: () => fetchOrders({ status: 'PENDING' }),
    refetchInterval: 30_000,
  });

  const { data: inProgressOrders = [], isLoading: ipLoading } = useQuery({
    queryKey: ['lab-orders', 'PROCESSING'],
    queryFn: () => fetchOrders({ status: 'PROCESSING' }),
    refetchInterval: 30_000,
  });

  const { data: completedOrders = [], isLoading: completedLoading } = useQuery({
    queryKey: ['lab-orders', 'COMPLETED', todayDate],
    queryFn: () => fetchOrders({ status: 'COMPLETED', date: todayDate }),
    refetchInterval: 60_000,
  });

  const statPending   = pendingOrders.length;
  const statInProgress = inProgressOrders.length;
  const statCompleted = completedOrders.length;
  const statStatOrders = pendingOrders.filter(o => o.priority === 'STAT').length;

  return (
    <div className={styles.page}>

      {/* ── Stats ── */}
      <div className={styles.statsRow}>
        <StatCard label="Pending"        value={statPending}    loading={pendingLoading} />
        <StatCard label="In Progress"   value={statInProgress} loading={ipLoading} />
        <StatCard label="Completed Today" value={statCompleted}  loading={completedLoading} />
        <StatCard
          label="STAT Pending"
          value={statStatOrders}
          alert={statStatOrders > 0}
          loading={pendingLoading}
        />
      </div>

      {/* ── Pending ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Pending Orders</h2>
          {statPending > 0 && <span className={styles.countBadge}>{statPending}</span>}
        </div>
        <OrderTable
          orders={pendingOrders}
          action="pending"
          loading={pendingLoading}
          emptyMsg="No pending orders."
          qc={qc}
        />
      </section>

      {/* ── In Progress ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>In Progress</h2>
          {statInProgress > 0 && <span className={styles.countBadge}>{statInProgress}</span>}
        </div>
        <OrderTable
          orders={inProgressOrders}
          action="in_progress"
          loading={ipLoading}
          emptyMsg="No orders in progress."
          qc={qc}
        />
      </section>

      {/* ── Completed Today ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Completed Today</h2>
          <span className={styles.countBadge}>{statCompleted}</span>
        </div>
        <OrderTable
          orders={completedOrders}
          action="completed"
          loading={completedLoading}
          emptyMsg="No completed orders today."
          qc={qc}
        />
      </section>

    </div>
  );
}
