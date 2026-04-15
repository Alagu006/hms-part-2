import { useEffect, useState } from 'react';
import api from '../../shared/utils/api.js';
import styles from './OrderlyDashboard.module.scss';

export default function OrderlyDashboard() {
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // No dedicated orderly tasks endpoint — fetch beds for cleaning queue
    api.get('/inventory/beds')
      .then((r) => {
        // Response: { data: [ { id, roomNumber, beds: [{id, bedNumber, status, ...}] } ] }
        const rooms = r.data.data ?? [];
        const flat  = rooms.flatMap((room) =>
          (room.beds ?? []).map((b) => ({ ...b, ward_name: room.roomNumber }))
        );
        setBeds(flat);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const markDone = async (id) => {
    // Optimistically update bed status via inventory endpoint
    await api.patch(`/inventory/beds/${id}`, { status: 'AVAILABLE' }).catch(() => {});
    setBeds((prev) => prev.map((b) => b.id === id ? { ...b, status: 'AVAILABLE' } : b));
  };

  const allBeds   = beds;
  const dirtyBeds = beds.filter((b) => b.status === 'MAINTENANCE');
  const available = beds.filter((b) => b.status === 'AVAILABLE');

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (error)   return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Orderly Dashboard</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{allBeds.length}</span>
          <span className={styles.statLabel}>Total Beds</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{available.length}</span>
          <span className={styles.statLabel}>Available</span>
        </div>
        <div className={`${styles.statCard} ${dirtyBeds.length > 0 ? styles.accentYellow : ''}`}>
          <span className={styles.statValue}>{dirtyBeds.length}</span>
          <span className={styles.statLabel}>In Maintenance</span>
        </div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>Beds In Maintenance ({dirtyBeds.length})</div>
        {dirtyBeds.length === 0 ? (
          <p className={styles.empty}>All beds are clean.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Bed</th><th>Ward</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {dirtyBeds.map((b) => (
                <tr key={b.id}>
                  <td className={styles.mono}>{b.bedNumber}</td>
                  <td>{b.ward_name ?? '—'}</td>
                  <td><span className={styles.statusBadge}>{b.status}</span></td>
                  <td>
                    <button className={styles.doneBtn} onClick={() => markDone(b.id)}>
                      Mark Available
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.panel} style={{ marginTop: 24 }}>
        <div className={styles.panelHeader}>All Beds</div>
        <table className={styles.table}>
          <thead>
            <tr><th>Bed</th><th>Ward</th><th>Status</th></tr>
          </thead>
          <tbody>
            {allBeds.map((b) => (
              <tr key={b.id}>
                <td className={styles.mono}>{b.bedNumber}</td>
                <td>{b.ward_name ?? '—'}</td>
                <td>
                  <span className={`${styles.statusBadge} ${styles[`bed_${b.status}`] ?? ''}`}>
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
            {allBeds.length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>No beds found.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
