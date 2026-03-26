import { useState, useEffect, useCallback } from 'react';
import styles from './PatientList.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PatientList({ onAdd, onSelect }) {
  const [patients, setPatients]   = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState('');

  const debouncedSearch = useDebounce(search);
  const limit = 20;

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter)    params.set('status', statusFilter);

      const res = await fetch(`${API_BASE}/patients?${params}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch patients');
      const json = await res.json();
      setPatients(json.patients ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Patients</h1>
        <button className={styles.addButton} onClick={onAdd}>
          + Add Patient
        </button>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search by name or MRN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search patients"
        />
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="inpatient">Inpatient</option>
          <option value="outpatient">Outpatient</option>
        </select>
      </div>

      <table className={styles.table} aria-label="Patient list">
        <thead className={styles.thead}>
          <tr>
            <th>Patient</th>
            <th>MRN</th>
            <th>DOB</th>
            <th>Gender</th>
            <th>Status</th>
            <th>Ward / Room</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {loading ? (
            <tr className={styles.loadingRow}>
              <td colSpan={7}>Loading…</td>
            </tr>
          ) : patients.length === 0 ? (
            <tr>
              <td colSpan={7} className={styles.emptyState}>
                No patients found.
              </td>
            </tr>
          ) : (
            patients.map((p) => (
              <tr key={p.id} onClick={() => onSelect?.(p)}>
                <td>
                  <div className={styles.patientName}>
                    {p.first_name} {p.last_name}
                  </div>
                </td>
                <td>
                  <span className={styles.mrn}>{p.mrn}</span>
                </td>
                <td>{p.date_of_birth}</td>
                <td>{p.gender}</td>
                <td>
                  <span
                    className={`${styles.badge} ${
                      p.status === 'inpatient'
                        ? styles.badgeInpatient
                        : styles.badgeOutpatient
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td>
                  {p.room_number
                    ? `${p.room_number} — Bed ${p.bed_number}`
                    : '—'}
                </td>
                <td>
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => { e.stopPropagation(); onSelect?.(p); }}
                    aria-label={`View ${p.first_name} ${p.last_name}`}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

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
