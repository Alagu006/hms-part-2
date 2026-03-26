import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import styles from './PatientAppointments.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function authHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` };
}

async function fetchAppointments() {
  const res = await fetch(`${API_BASE}/appointments?patientId=me&limit=50`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load appointments');
  const json = await res.json();
  return json.appointments ?? [];
}

function SkeletonRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}><div className={styles.skeleton} style={{ width: `${50 + Math.random() * 40}%` }} /></td>
      ))}
    </tr>
  );
}

function TypeBadge({ type }) {
  const map = {
    TELEMEDICINE: styles.badgeTele,
    FOLLOW_UP   : styles.badgeFollow,
    EMERGENCY   : styles.badgeEmergency,
    IN_PERSON   : styles.badgeInPerson,
  };
  return <span className={`${styles.badge} ${map[type] ?? ''}`}>{type.replace('_', ' ')}</span>;
}

function StatusBadge({ status }) {
  const map = {
    SCHEDULED  : styles.statusSched,
    CONFIRMED  : styles.statusConfirm,
    IN_PROGRESS: styles.statusProgress,
    COMPLETED  : styles.statusDone,
    CANCELLED  : styles.statusCancell,
    NO_SHOW    : styles.statusNoShow,
  };
  return <span className={`${styles.statusBadge} ${map[status] ?? ''}`}>{status.replace('_', ' ')}</span>;
}

export default function PatientAppointments() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('upcoming');

  const { data: appointments = [], isLoading, isError } = useQuery({
    queryKey: ['patient-appointments'],
    queryFn: fetchAppointments,
    refetchInterval: 60_000,
  });

  const now = new Date();

  const upcoming = appointments.filter(a =>
    ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
    new Date(a.scheduled_at) >= now
  );

  const past = appointments.filter(a =>
    ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(a.status) ||
    new Date(a.scheduled_at) < now
  );

  const displayed = filter === 'upcoming' ? upcoming : past;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Appointments</h1>
        <button className={styles.bookBtn} onClick={() => navigate('/patient/appointments/book')}>
          + Book Appointment
        </button>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          className={`${styles.tab} ${filter === 'upcoming' ? styles.tabActive : ''}`}
          onClick={() => setFilter('upcoming')}
          aria-selected={filter === 'upcoming'}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          role="tab"
          className={`${styles.tab} ${filter === 'past' ? styles.tabActive : ''}`}
          onClick={() => setFilter('past')}
          aria-selected={filter === 'past'}
        >
          Past ({past.length})
        </button>
      </div>

      <div className={styles.card}>
        {isLoading ? (
          <table className={styles.table}>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : isError ? (
          <div className={styles.errorState}>Failed to load appointments.</div>
        ) : displayed.length === 0 ? (
          <div className={styles.emptyState}>
            {filter === 'upcoming'
              ? 'No upcoming appointments. Book one now!'
              : 'No past appointments.'}
          </div>
        ) : (
          <table className={styles.table} aria-label="Appointments">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Doctor</th>
                <th>Department</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(appt => {
                const dt = new Date(appt.scheduled_at);
                const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                return (
                  <tr key={appt.id}>
                    <td>
                      <div className={styles.dateTime}>
                        <span className={styles.date}>{dateStr}</span>
                        <span className={styles.time}>{timeStr}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.docName}>Dr. {appt.doctor_first_name} {appt.doctor_last_name}</div>
                    </td>
                    <td>{appt.department_name ?? '—'}</td>
                    <td><TypeBadge type={appt.type} /></td>
                    <td><StatusBadge status={appt.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
