import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import SkeletonLoader from '../../shared/components/SkeletonLoader.jsx';
import styles from './MyPrescriptions.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(iso));
}

const STATUS_CONFIG = {
  ISSUED              : { label: 'Issued',             cls: 'badgeIssued'    },
  PARTIALLY_DISPENSED : { label: 'Partially Dispensed', cls: 'badgePartial'  },
  DISPENSED           : { label: 'Dispensed',           cls: 'badgeDispensed' },
  DRAFT               : { label: 'Draft',               cls: 'badgeDraft'    },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.DRAFT;
  return (
    <span className={`${styles.badge} ${styles[cfg.cls]}`}>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail view — PDF-style
// ---------------------------------------------------------------------------
function PrescriptionDetail({ id, onBack }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`${API_BASE}/prescriptions/${id}`)
      .then((data) => setData(data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!data)   return <div className={styles.empty}>Prescription not found.</div>;

  const diagnosisCodes = data.notes?.diagnosisCodes ?? [];
  const freeNotes      = data.notes?.freeNotes ?? '';

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <p className={styles.detailTitle}>Prescription</p>
          <p className={styles.detailMeta}>
            Dr. {data.doctor_first} {data.doctor_last} · {formatDate(data.created_at)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusBadge status={data.status} />
          <button
            className={styles.reminderBtn}
            onClick={() => {
              if ('Notification' in window) {
                Notification.requestPermission().then(perm => {
                  if (perm === 'granted') {
                    new Notification('💊 Medication Reminder Set', {
                      body: `Reminders enabled for your prescription from Dr. ${data.doctor_first} ${data.doctor_last}`,
                      icon: '/icon-192.png',
                    });
                  }
                });
              }
            }}
            title="Set medication reminder"
          >
            🔔 Remind Me
          </button>
          <button className={styles.backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>

      <div className={styles.detailBody}>
        {diagnosisCodes.length > 0 && (
          <>
            <p className={styles.sectionLabel} style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Diagnosis (ICD-10)
            </p>
            <div className={styles.diagnosisRow}>
              {diagnosisCodes.map((code) => (
                <span key={code} className={styles.icdTag}>{code}</span>
              ))}
            </div>
          </>
        )}

        <table className={styles.itemsTable} aria-label="Prescription items">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Dosage</th>
              <th>Frequency</th>
              <th>Duration</th>
              <th>Qty</th>
              <th>Instructions</th>
            </tr>
          </thead>
          <tbody>
            {(data.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.medicineName}>{item.medicine_name}</div>
                  {item.generic_name && (
                    <div className={styles.medicineGeneric}>{item.generic_name}</div>
                  )}
                </td>
                <td>{item.dosage}</td>
                <td>{item.frequency}</td>
                <td>{item.duration_days}d</td>
                <td>{item.quantity}</td>
                <td>{item.instructions ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {freeNotes && (
          <div className={styles.detailNotes}>
            <strong>Notes:</strong> {freeNotes}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------
export default function MyPrescriptions({ patientId }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [loading, setLoading]             = useState(false);
  const [selectedId, setSelectedId]       = useState(null);
  const limit = 10;

  // Determine endpoint: if patientId provided use history route, else use /my
  const endpoint = patientId
    ? `${API_BASE}/prescriptions/patient/${patientId}`
    : `${API_BASE}/prescriptions/my`;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      const data = await apiFetch(`${endpoint}?${params}`);
      setPrescriptions(data?.prescriptions ?? []);
      setTotal(data?.total ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  if (selectedId) {
    return <PrescriptionDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>My Prescriptions</h2>
      </div>

      {loading ? (
        <SkeletonLoader variant="table" rows={4} />
      ) : prescriptions.length === 0 ? (
        <div className={styles.empty}>No prescriptions found.</div>
      ) : (
        <div className={styles.list}>
          {prescriptions.map((p) => (
            <div
              key={p.id}
              className={styles.card}
              onClick={() => setSelectedId(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedId(p.id)}
              aria-label={`Prescription from ${p.doctor_name}, ${formatDate(p.created_at)}`}
            >
              <div className={styles.cardLeft}>
                <div className={styles.cardDate}>{formatDate(p.created_at)}</div>
                <div className={styles.cardDoctor}>Dr. {p.doctor_name}</div>
                <div className={styles.cardItems}>
                  {p.item_count} medicine{p.item_count !== 1 ? 's' : ''}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            ← Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => p + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
