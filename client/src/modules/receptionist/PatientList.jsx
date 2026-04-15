import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../shared/utils/authHeaders.js';
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
  const navigate = useNavigate();
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

      const json = await apiFetch(`${API_BASE}/patients?${params}`);
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
        <button className={styles.addButton} onClick={() => onAdd ? onAdd() : navigate('/receptionist/patients/new')}>
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

      {/* ── Desktop table ── */}
      <div className={styles.tableWrap}>
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
              <tr className={styles.loadingRow}><td colSpan={7}>Loading…</td></tr>
            ) : patients.length === 0 ? (
              <tr><td colSpan={7} className={styles.emptyState}>No patients found.</td></tr>
            ) : (
              patients.map((p) => (
                <tr key={p.id} onClick={() => onSelect?.(p)}>
                  <td><div className={styles.patientName}>{p.first_name} {p.last_name}</div></td>
                  <td><span className={styles.mrn}>{p.mrn}</span></td>
                  <td>{p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td>{p.gender}</td>
                  <td>
                    <span className={`${styles.badge} ${p.status === 'inpatient' ? styles.badgeInpatient : styles.badgeOutpatient}`}>
                      {p.status}
                    </span>
                  </td>
                  <td>{p.room_number ? `${p.room_number} — Bed ${p.bed_number}` : '—'}</td>
                  <td>
                    <button className={styles.actionBtn}
                      onClick={(e) => { e.stopPropagation(); onSelect?.(p); }}
                      aria-label={`View ${p.first_name} ${p.last_name}`}>
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card list ── */}
      <div className={styles.mobileList} aria-label="Patient list">
        {loading ? (
          <div className={styles.emptyState}>Loading…</div>
        ) : patients.length === 0 ? (
          <div className={styles.emptyState}>No patients found.</div>
        ) : (
          patients.map((p) => (
            <div key={p.id} className={styles.patientCard}
              onClick={() => onSelect?.(p)}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect?.(p)}
              aria-label={`${p.first_name} ${p.last_name}`}>
              <div className={styles.patientCardTop}>
                <div>
                  <div className={styles.patientName}>{p.first_name} {p.last_name}</div>
                  <div className={styles.mrn}>{p.mrn}</div>
                </div>
                <span className={`${styles.badge} ${p.status === 'inpatient' ? styles.badgeInpatient : styles.badgeOutpatient}`}>
                  {p.status}
                </span>
              </div>
              <div className={styles.patientCardMeta}>
                {p.gender && <span>{p.gender}</span>}
                {p.date_of_birth && <span>DOB: {new Date(p.date_of_birth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                {p.room_number && <span>Room {p.room_number} · Bed {p.bed_number}</span>}
              </div>
              <div className={styles.patientCardActions}>
                <button className={styles.actionBtn}
                  onClick={(e) => { e.stopPropagation(); onSelect?.(p); }}
                  aria-label={`View ${p.first_name} ${p.last_name}`}>
                  View Details
                </button>
              </div>
            </div>
          ))
        )}
      </div>

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
