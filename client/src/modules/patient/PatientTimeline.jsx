import { useState, useEffect, useCallback } from 'react';
import styles from './PatientTimeline.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

const TYPE_LABELS = {
  appointment   : 'Appointment',
  medical_record: 'Medical Record',
  lab_order     : 'Lab Order',
};

const TYPE_ICONS = {
  appointment   : '📅',
  medical_record: '📋',
  lab_order     : '🧪',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default function PatientTimeline({ patientId, patientName }) {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const limit = 20;

  const fetchTimeline = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      const res = await fetch(`${API_BASE}/patients/${patientId}/timeline?${params}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
      });
      if (!res.ok) throw new Error('Failed to load timeline');
      const json = await res.json();
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [patientId, page]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Patient Timeline</h2>
        {patientName && <p>{patientName}</p>}
      </div>

      {loading ? (
        <div className={styles.loading} aria-live="polite">Loading timeline…</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>No records found for this patient.</div>
      ) : (
        <ol className={styles.timeline} aria-label="Patient timeline">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className={styles.item}>
              <div className={`${styles.dot} ${styles[item.type]}`} aria-hidden="true" />
              <div className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={`${styles.typeTag} ${styles[item.type]}`}>
                    {TYPE_ICONS[item.type]} {TYPE_LABELS[item.type] ?? item.type}
                  </span>
                  <span className={styles.date}>{formatDate(item.event_date)}</span>
                </div>

                {item.doctor_name && (
                  <p className={styles.doctor}>
                    Dr. <span>{item.doctor_name}</span>
                  </p>
                )}

                <div className={styles.meta}>
                  {item.status && (
                    <span className={styles.metaTag}>{item.status}</span>
                  )}
                  {item.sub_type && (
                    <span className={styles.metaTag}>{item.sub_type}</span>
                  )}
                </div>

                {item.notes && (
                  <p className={styles.notes}>{item.notes}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
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
