import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import styles from './DoctorDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function authHeader() {
  return { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` };
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchAppointments(date, status) {
  const params = new URLSearchParams({ doctorId: 'me', date, limit: 50 });
  if (status) params.set('status', status);
  const res = await fetch(`${API_BASE}/appointments?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error('Failed to fetch appointments');
  const json = await res.json();
  return json.appointments ?? [];
}

async function fetchPendingCount() {
  const params = new URLSearchParams({ status: 'PENDING', limit: 1 });
  const res = await fetch(`${API_BASE}/prescriptions/count?${params}`, { headers: authHeader() });
  if (!res.ok) return 0;
  const json = await res.json();
  return json.count ?? 0;
}

async function fetchRecentPatients() {
  const params = new URLSearchParams({ doctorId: 'me', limit: 5 });
  const res = await fetch(`${API_BASE}/patients?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error('Failed to fetch patients');
  const json = await res.json();
  return json.patients ?? [];
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------
function SkeletonRow({ cols = 4 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className={styles.skeleton} style={{ width: `${50 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div className={styles.statCard}>
      <div className={styles.skeleton} style={{ width: '60%', height: 14 }} />
      <div className={styles.skeleton} style={{ width: '40%', height: 32, marginTop: 8 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type badge
// ---------------------------------------------------------------------------
function TypeBadge({ type }) {
  const map = {
    TELEMEDICINE: styles.badgeTelemedicine,
    FOLLOW_UP   : styles.badgeFollowUp,
    EMERGENCY   : styles.badgeEmergency,
    IN_PERSON   : styles.badgeInPerson,
  };
  return (
    <span className={`${styles.badge} ${map[type] ?? styles.badgeDefault}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  const map = {
    SCHEDULED : styles.statusScheduled,
    CONFIRMED : styles.statusConfirmed,
    IN_PROGRESS: styles.statusInProgress,
    COMPLETED : styles.statusCompleted,
    CANCELLED : styles.statusCancelled,
    NO_SHOW   : styles.statusNoShow,
  };
  return (
    <span className={`${styles.statusBadge} ${map[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Appointment row
// ---------------------------------------------------------------------------
function AppointmentRow({ appt, onStartConsultation }) {
  const time = new Date(appt.scheduled_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const isToday = new Date(appt.scheduled_at).toDateString() === new Date().toDateString();

  return (
    <tr className={styles.apptRow}>
      <td className={styles.timeCell}>
        <span className={styles.time}>{time}</span>
        {!isToday && <span className={styles.dateHint}>{new Date(appt.scheduled_at).toLocaleDateString()}</span>}
      </td>
      <td>
        <div className={styles.patientName}>{appt.patient_first_name} {appt.patient_last_name}</div>
        <div className={styles.mrn}>{appt.mrn}</div>
      </td>
      <td><TypeBadge type={appt.type} /></td>
      <td><StatusBadge status={appt.status} /></td>
      <td>
        {['SCHEDULED', 'CONFIRMED'].includes(appt.status) && (
          <button
            className={styles.startBtn}
            onClick={() => onStartConsultation(appt)}
          >
            Start Consultation
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Recent patient row
// ---------------------------------------------------------------------------
function PatientRow({ patient }) {
  return (
    <tr className={styles.patientRow}>
      <td>
        <div className={styles.patientName}>{patient.first_name} {patient.last_name}</div>
        <div className={styles.mrn}>{patient.mrn}</div>
      </td>
      <td>{patient.date_of_birth}</td>
      <td>
        <span className={`${styles.badge} ${patient.status === 'inpatient' ? styles.badgeInpatient : styles.badgeOutpatient}`}>
          {patient.status}
        </span>
      </td>
      <td>{patient.room_number ? `${patient.room_number} — Bed ${patient.bed_number}` : '—'}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Section with loading / empty / error
// ---------------------------------------------------------------------------
function SectionCard({ title, children, action }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
export default function DoctorDashboard() {
  const navigate = useNavigate();
  const [dateFilter] = useState(today());

  const {
    data: appointments = [],
    isLoading: apptLoading,
    isError: apptError,
  } = useQuery({
    queryKey: ['doctor-appointments', dateFilter],
    queryFn: () => fetchAppointments(dateFilter, 'SCHEDULED'),
  });

  const {
    data: pendingCount = 0,
    isLoading: pendingLoading,
  } = useQuery({
    queryKey: ['doctor-pending-prescriptions'],
    queryFn: fetchPendingCount,
    refetchInterval: 60_000,
  });

  const {
    data: recentPatients = [],
    isLoading: patientsLoading,
    isError: patientsError,
  } = useQuery({
    queryKey: ['doctor-recent-patients'],
    queryFn: fetchRecentPatients,
  });

  function startConsultation(appt) {
    navigate(`/doctor/prescriptions`, {
      state: {
        patientId  : appt.patient_id,
        patientName: `${appt.patient_first_name} ${appt.patient_last_name}`,
        appointmentId: appt.id,
      },
    });
  }

  const todayCount  = appointments.filter(a => new Date(a.scheduled_at).toDateString() === new Date().toDateString()).length;
  const upcomingCount = appointments.filter(a => ['SCHEDULED', 'CONFIRMED'].includes(a.status)).length;

  return (
    <div className={styles.page}>
      {/* Stat cards */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Today&apos;s Appointments</span>
          {pendingLoading ? (
            <div className={styles.skeleton} style={{ width: 60, height: 32, marginTop: 8 }} />
          ) : (
            <span className={styles.statValue}>{todayCount}</span>
          )}
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Upcoming</span>
          <span className={styles.statValue}>{upcomingCount}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pending Prescriptions</span>
          {pendingLoading ? (
            <div className={styles.skeleton} style={{ width: 60, height: 32, marginTop: 8 }} />
          ) : (
            <span className={`${styles.statValue} ${pendingCount > 0 ? styles.statAlert : ''}`}>
              {pendingCount}
            </span>
          )}
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Recent Patients</span>
          <span className={styles.statValue}>{recentPatients.length}</span>
        </div>
      </div>

      {/* Today's appointments */}
      <SectionCard title="Today's Appointments">
        {apptLoading ? (
          <table className={styles.table}>
            <tbody>
              <SkeletonRow cols={5} />
              <SkeletonRow cols={5} />
              <SkeletonRow cols={5} />
            </tbody>
          </table>
        ) : apptError ? (
          <div className={styles.errorState}>Failed to load appointments.</div>
        ) : appointments.length === 0 ? (
          <div className={styles.emptyState}>
            No appointments scheduled for today.
          </div>
        ) : (
          <table className={styles.table} aria-label="Today's appointments">
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Type</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <AppointmentRow
                  key={appt.id}
                  appt={appt}
                  onStartConsultation={startConsultation}
                />
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Recent patients */}
      <SectionCard title="Recent Patients">
        {patientsLoading ? (
          <table className={styles.table}>
            <tbody>
              <SkeletonRow cols={4} />
              <SkeletonRow cols={4} />
            </tbody>
          </table>
        ) : patientsError ? (
          <div className={styles.errorState}>Failed to load patients.</div>
        ) : recentPatients.length === 0 ? (
          <div className={styles.emptyState}>No patients found.</div>
        ) : (
          <table className={styles.table} aria-label="Recent patients">
            <thead>
              <tr>
                <th>Patient</th>
                <th>DOB</th>
                <th>Status</th>
                <th>Room</th>
              </tr>
            </thead>
            <tbody>
              {recentPatients.map((p) => (
                <PatientRow key={p.id} patient={p} />
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
