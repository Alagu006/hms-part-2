import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import LabTestsPanel from './LabTestsPanel.jsx';
import CDSInsightsPanel from '../cds/CDSInsightsPanel.jsx';
import SkeletonLoader from '../../shared/components/SkeletonLoader.jsx';
import StatCard from '../../shared/components/StatCard.jsx';
import PageHeader from '../../shared/components/PageHeader.jsx';
import styles from './DoctorDashboard.module.scss';

function today() {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchAppointments(date, status) {
  const params = new URLSearchParams({ doctorId: 'me', date, limit: 50 });
  if (status) params.set('status', status);
  const json = await apiFetch(`${API_BASE}/appointments?${params}`);
  return json.appointments ?? [];
}

async function fetchPendingCount() {
  const params = new URLSearchParams({ status: 'PENDING', limit: 1 });
  const json = await apiFetch(`${API_BASE}/prescriptions/count?${params}`);
  return json?.count ?? 0;
}

async function fetchRecentPatients() {
  const params = new URLSearchParams({ doctorId: 'me', limit: 5 });
  const json = await apiFetch(`${API_BASE}/patients?${params}`);
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
// Appointment row (desktop table)
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
            className={`${styles.startBtn} ${appt.type === 'TELEMEDICINE' ? styles.startBtnTele : ''}`}
            onClick={() => onStartConsultation(appt)}
          >
            {appt.type === 'TELEMEDICINE' ? '📹 Join Call' : 'Start Consultation'}
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Appointment card (mobile)
// ---------------------------------------------------------------------------
function AppointmentCard({ appt, onStartConsultation }) {
  const time = new Date(appt.scheduled_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  return (
    <div className={styles.apptCard}>
      <div className={styles.apptCardRow}>
        <span className={styles.apptCardName}>{appt.patient_first_name} {appt.patient_last_name}</span>
        <span className={styles.time}>{time}</span>
      </div>
      <div className={styles.apptCardRow}>
        <TypeBadge type={appt.type} />
        <StatusBadge status={appt.status} />
      </div>
      {appt.mrn && <span className={styles.mrn}>{appt.mrn}</span>}
      {['SCHEDULED', 'CONFIRMED'].includes(appt.status) && (
        <div className={styles.apptCardActions}>
          <button
            className={`${styles.startBtn} ${appt.type === 'TELEMEDICINE' ? styles.startBtnTele : ''}`}
            onClick={() => onStartConsultation(appt)}
          >
            {appt.type === 'TELEMEDICINE' ? '📹 Join Call' : 'Start Consultation'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent patient row
// ---------------------------------------------------------------------------
function PatientRow({ patient, onSelectCds, cdsPatientId }) {
  const navigate = useNavigate();
  const isSelected = cdsPatientId === patient.id;
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
      <td>
        <div className={styles.patientActions}>
          <button className={styles.vitalsBtn}
            onClick={() => navigate('/doctor/patient-vitals', { state: { patientId: patient.id, patientName: `${patient.first_name} ${patient.last_name}` } })}>
            📊 Vitals
          </button>
          <button
            className={`${styles.vitalsBtn} ${isSelected ? styles.cdsActive : ''}`}
            onClick={() => onSelectCds(isSelected ? null : patient.id)}
            title={isSelected ? 'Hide CDS insights' : 'Show CDS insights'}
          >
            🧠 CDS
          </button>
          <button className={styles.vitalsBtn}
            onClick={() => navigate('/doctor/patient-history', { state: { patientId: patient.id, patientName: `${patient.first_name} ${patient.last_name}` } })}>
            📋 History
          </button>
        </div>
      </td>
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
  const [cdsPatientId, setCdsPatientId] = useState(null);

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

  const teleSessionMutation = useMutation({
    mutationFn: async (appt) => {
      // Try to find an existing session for this appointment first
      const existing = await apiFetch(`${API_BASE}/telemedicine/sessions/my?limit=50`);
      const sessions = existing?.data?.sessions ?? [];
      const found = sessions.find(s => s.appointment_id === appt.id && ['SCHEDULED','ACTIVE'].includes(s.status));
      if (found) return found;
      // Create a new session
      const created = await apiFetch(`${API_BASE}/telemedicine/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          patientId    : appt.patient_id,
          doctorId     : appt.doctor_id,
          appointmentId: appt.id,
        }),
      });
      return created?.data;
    },
    onSuccess: (session) => {
      navigate(`/doctor/telemedicine/${session.room_id}`);
    },
  });

  function startConsultation(appt) {
    if (appt.type === 'TELEMEDICINE') {
      teleSessionMutation.mutate(appt);
    } else {
      navigate(`/doctor/prescriptions`, {
        state: {
          patientId    : appt.patient_id,
          patientName  : `${appt.patient_first_name} ${appt.patient_last_name}`,
          appointmentId: appt.id,
        },
      });
    }
  }

  const todayCount  = appointments.filter(a => new Date(a.scheduled_at).toDateString() === new Date().toDateString()).length;
  const upcomingCount = appointments.filter(a => ['SCHEDULED', 'CONFIRMED'].includes(a.status)).length;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Doctor Dashboard"
        subtitle={new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        actions={
          <button className={styles.qaBtn} onClick={() => navigate('/doctor/prescriptions')}>
            💊 New Prescription
          </button>
        }
      />

      {/* Stat cards */}
      <div className={styles.statsRow}>
        <StatCard
          label="Today's Appointments"
          value={todayCount}
          icon="📅"
          status="blue"
          delay={0}
        />
        <StatCard
          label="Upcoming"
          value={upcomingCount}
          icon="⏰"
          status="teal"
          delay={0.05}
        />
        <StatCard
          label="Pending Prescriptions"
          value={pendingCount}
          icon="💊"
          status={pendingCount > 0 ? 'amber' : 'green'}
          delay={0.1}
        />
        <StatCard
          label="Recent Patients"
          value={recentPatients.length}
          icon="👥"
          status="purple"
          delay={0.15}
        />
      </div>

      {/* Quick actions */}
      <div className={styles.quickActions}>
        <button className={styles.qaBtn} onClick={() => navigate('/doctor/prescriptions')}>
          💊 New Prescription <kbd className={styles.qaKey}>P</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/doctor/patient-vitals')}>
          📊 Patient Vitals <kbd className={styles.qaKey}>V</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/doctor/patient-history')}>
          📋 Patient History <kbd className={styles.qaKey}>H</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/doctor/discharge')}>
          🏥 Discharge <kbd className={styles.qaKey}>D</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/doctor/telemedicine')}>
          📹 Telemedicine <kbd className={styles.qaKey}>T</kbd>
        </button>
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
          <>
            {/* Desktop table */}
            <div className={styles.tableWrap}>
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
            </div>
            {/* Mobile cards */}
            <div className={styles.mobileCards}>
              {appointments.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appt={appt}
                  onStartConsultation={startConsultation}
                />
              ))}
            </div>
          </>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentPatients.map((p) => (
                <PatientRow key={p.id} patient={p} onSelectCds={setCdsPatientId} cdsPatientId={cdsPatientId} />
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Lab Tests */}
      <SectionCard title="Lab Tests">
        <LabTestsPanel />
      </SectionCard>

      {/* CDS Insights — shown for whichever patient the doctor selects */}
      {cdsPatientId && (
        <CDSInsightsPanel
          patientId={cdsPatientId}
          collapsed={false}
        />
      )}
    </div>
  );
}
