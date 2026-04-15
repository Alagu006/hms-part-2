import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import styles from './ReceptionistDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchTodaysAppointments() {
  const today = new Date().toISOString().split('T')[0];
  const json = await apiFetch(`${API_BASE}/appointments?date=${today}&limit=50`);
  return json.appointments ?? [];
}

async function fetchRecentPatients() {
  const json = await apiFetch(`${API_BASE}/patients?limit=5`);
  return json.patients ?? [];
}

async function fetchBedMatrix() {
  const json = await apiFetch(`${API_BASE}/inventory/beds`);
  return json.data ?? [];
}

async function fetchTodaysStats() {
  const today = new Date().toISOString().split('T')[0];

  const [apptsJson, patientsJson] = await Promise.all([
    apiFetch(`${API_BASE}/appointments?date=${today}&limit=1`),
    apiFetch(`${API_BASE}/patients?limit=100`),
  ]);

  const todayPatients = (patientsJson.patients ?? []).filter(p => {
    const created = new Date(p.created_at).toISOString().split('T')[0];
    return created === today;
  });

  return {
    appointmentsToday: apptsJson.total ?? 0,
    newPatientsToday: todayPatients.length,
  };
}

async function updateAppointmentStatus(id, status) {
  const json = await apiFetch(`${API_BASE}/appointments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return json;
}

async function searchPatients(query) {
  const json = await apiFetch(`${API_BASE}/patients?search=${encodeURIComponent(query)}&limit=10`);
  return json.patients ?? [];
}

async function logVisitor(data) {
  const json = await apiFetch(`${API_BASE}/visitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return json;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function SkeletonCard({ height = 120 }) {
  return <div className={styles.skeleton} style={{ height, borderRadius: 8 }} />;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
function StatCard({ label, value, loading }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      {loading ? (
        <div className={styles.skeleton} style={{ width: 48, height: 32, marginTop: 6 }} />
      ) : (
        <span className={styles.statValue}>{value}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appointment Row
// ---------------------------------------------------------------------------
function AppointmentRow({ appointment, onCheckIn, onNoShow }) {
  const scheduledTime = new Date(appointment.scheduled_at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const patientName = `${appointment.patient_first_name} ${appointment.patient_last_name}`;
  const doctorName = `${appointment.doctor_first_name} ${appointment.doctor_last_name}`;
  const departmentName = appointment.department_name ?? 'General';

  const statusBadgeClass = {
    SCHEDULED: styles.statusScheduled,
    COMPLETED: styles.statusCompleted,
    CANCELLED: styles.statusCancelled,
    NO_SHOW: styles.statusNoShow,
    CONFIRMED: styles.statusConfirmed,
    IN_PROGRESS: styles.statusInProgress,
  }[appointment.status] ?? styles.statusScheduled;

  const typeBadgeClass = {
    IN_PERSON: styles.typeInPerson,
    TELEMEDICINE: styles.typeTelemedicine,
    FOLLOW_UP: styles.typeFollowUp,
    EMERGENCY: styles.typeEmergency,
  }[appointment.type] ?? styles.typeInPerson;

  return (
    <tr className={styles.appointmentRow}>
      <td className={styles.timeCell}>{scheduledTime}</td>
      <td>{patientName}</td>
      <td>Dr. {doctorName}</td>
      <td>{departmentName}</td>
      <td>
        <span className={`${styles.badge} ${typeBadgeClass}`}>{appointment.type.replace('_', ' ')}</span>
      </td>
      <td>
        <span className={`${styles.badge} ${statusBadgeClass}`}>{appointment.status.replace('_', ' ')}</span>
      </td>
      <td>
        {appointment.status === 'SCHEDULED' && (
          <div className={styles.actionBtns}>
            <button
              className={styles.checkInBtn}
              onClick={() => onCheckIn(appointment.id)}
            >
              Check In
            </button>
            <button
              className={styles.noShowBtn}
              onClick={() => onNoShow(appointment.id)}
            >
              No Show
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Bed Summary
// ---------------------------------------------------------------------------
function BedSummary({ beds, loading }) {
  const navigate = useNavigate();

  if (loading) {
    return <SkeletonCard height={120} />;
  }

  const grouped = {};
  beds.forEach(room => {
    const roomType = room.roomType ?? 'General';
    if (!grouped[roomType]) {
      grouped[roomType] = { total: 0, available: 0 };
    }
    room.beds.forEach(bed => {
      grouped[roomType].total++;
      if (bed.status === 'AVAILABLE') {
        grouped[roomType].available++;
      }
    });
  });

  const totalAvailable = Object.values(grouped).reduce((sum, g) => sum + g.available, 0);
  const totalBeds = Object.values(grouped).reduce((sum, g) => sum + g.total, 0);

  return (
    <div className={styles.bedSummary}>
      <div className={styles.bedSummaryHeader}>
        <span className={styles.bedTotal}>
          <span className={styles.bedCount}>{totalAvailable}</span> of {totalBeds} beds available
        </span>
        <button
          className={styles.viewMatrixLink}
          onClick={() => navigate('/inventory/beds')}
        >
          View full bed matrix →
        </button>
      </div>
      <div className={styles.wardGrid}>
        {Object.entries(grouped).map(([ward, counts]) => (
          <div key={ward} className={styles.wardCard}>
            <span className={styles.wardName}>{ward}</span>
            <span className={styles.wardCount}>
              <span className={styles.availableCount}>{counts.available}</span>/{counts.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Patient Row
// ---------------------------------------------------------------------------
function RecentPatientRow({ patient, onView }) {
  const patientName = `${patient.first_name} ${patient.last_name}`;
  const timeAgo = getTimeAgo(new Date(patient.created_at));

  return (
    <div className={styles.patientRow}>
      <div className={styles.patientInfo}>
        <span className={styles.patientName}>{patientName}</span>
        <span className={styles.patientId}>{patient.mrn}</span>
      </div>
      <div className={styles.patientMeta}>
        <span className={`${styles.statusBadge} ${patient.status === 'inpatient' ? styles.inpatientBadge : styles.outpatientBadge}`}>
          {patient.status}
        </span>
        <span className={styles.timeAgo}>{timeAgo}</span>
      </div>
      <button className={styles.viewBtn} onClick={() => onView(patient.id)}>
        View
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visitor Form
// ---------------------------------------------------------------------------
function VisitorForm({ onSubmit, recentVisitors }) {
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientResults, setPatientResults] = useState([]);
  const [purpose, setPurpose] = useState('Family Visit');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const debouncedSearch = useDebounce(patientSearch, 400);

  useEffect(() => {
    if (debouncedSearch.length >= 2) {
      searchPatients(debouncedSearch).then(results => {
        setPatientResults(results);
      });
    } else {
      setPatientResults([]);
    }
  }, [debouncedSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient || !visitorName) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        patientId: selectedPatient.id,
        visitorName,
        visitorPhone: visitorPhone || undefined,
        purpose,
      });
      setSuccess(true);
      setVisitorName('');
      setVisitorPhone('');
      setPatientSearch('');
      setSelectedPatient(null);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      alert('Failed to log visitor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setPatientSearch(`${patient.first_name} ${patient.last_name} (${patient.mrn})`);
    setPatientResults([]);
  };

  return (
    <div className={styles.visitorSection}>
      <form className={styles.visitorForm} onSubmit={handleSubmit}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            Patient
            <input
              type="text"
              className={styles.formInput}
              placeholder="Search patient by name or ID..."
              value={patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setSelectedPatient(null);
              }}
              required
            />
          </label>
        </div>

        {patientResults.length > 0 && !selectedPatient && (
          <div className={styles.searchResults}>
            {patientResults.map(patient => (
              <div
                key={patient.id}
                className={styles.searchResultItem}
                onClick={() => selectPatient(patient)}
              >
                {patient.first_name} {patient.last_name} ({patient.mrn})
              </div>
            ))}
          </div>
        )}

        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            Visitor Name
            <input
              type="text"
              className={styles.formInput}
              placeholder="Enter visitor name"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              required
            />
          </label>
          <label className={styles.formLabel}>
            Phone
            <input
              type="tel"
              className={styles.formInput}
              placeholder="Optional"
              value={visitorPhone}
              onChange={(e) => setVisitorPhone(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>
            Purpose
            <select
              className={styles.formSelect}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="Family Visit">Family Visit</option>
              <option value="Official">Official</option>
              <option value="Medical Rep">Medical Rep</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={isSubmitting || !selectedPatient}
        >
          {isSubmitting ? 'Logging...' : 'Log Visitor'}
        </button>

        {success && (
          <span className={styles.successMsg}>Visitor logged successfully!</span>
        )}
      </form>

      {recentVisitors.length > 0 && (
        <div className={styles.recentVisitors}>
          <h4 className={styles.recentTitle}>Recent Entries</h4>
          {recentVisitors.map(visitor => (
            <div key={visitor.id} className={styles.recentVisitorItem}>
              <span className={styles.recentVisitorName}>{visitor.visitorName}</span>
              <span className={styles.recentVisitorPatient}>{visitor.patientName}</span>
              <span className={styles.recentVisitorTime}>
                {getTimeAgo(new Date(visitor.timestamp))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function ReceptionistDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [recentVisitors, setRecentVisitors] = useState([]);
  const [bedsAvailable, setBedsAvailable] = useState(0);

  // Today's appointments
  const {
    data: appointments = [],
    isLoading: appointmentsLoading,
    isError: appointmentsError,
  } = useQuery({
    queryKey: ['receptionist-appointments'],
    queryFn: fetchTodaysAppointments,
    refetchInterval: 60_000,
  });

  // Recent patients
  const {
    data: recentPatients = [],
    isLoading: patientsLoading,
    isError: patientsError,
  } = useQuery({
    queryKey: ['receptionist-recent-patients'],
    queryFn: fetchRecentPatients,
    refetchInterval: 60_000,
  });

  // Bed matrix
  const {
    data: bedMatrix = [],
    isLoading: bedsLoading,
  } = useQuery({
    queryKey: ['receptionist-beds'],
    queryFn: fetchBedMatrix,
  });

  // Stats
  const {
    data: stats = { appointmentsToday: 0, newPatientsToday: 0 },
    isLoading: statsLoading,
  } = useQuery({
    queryKey: ['receptionist-stats'],
    queryFn: fetchTodaysStats,
    refetchInterval: 60_000,
  });

  // Calculate beds available
  useEffect(() => {
    let available = 0;
    bedMatrix.forEach(room => {
      room.beds?.forEach(bed => {
        if (bed.status === 'AVAILABLE') available++;
      });
    });
    setBedsAvailable(available);
  }, [bedMatrix]);

  // Update appointment mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, status }) => updateAppointmentStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receptionist-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['receptionist-stats'] });
    },
  });

  const handleCheckIn = (appointmentId) => {
    updateMutation.mutate({ id: appointmentId, status: 'COMPLETED' });
  };

  const handleNoShow = (appointmentId) => {
    updateMutation.mutate({ id: appointmentId, status: 'NO_SHOW' });
  };

  const handleViewPatient = (patientId) => {
    navigate(`/patients/${patientId}`);
  };

  const handleLogVisitor = async (data) => {
    await logVisitor(data);
    setRecentVisitors(prev => [
      {
        id: Date.now(),
        visitorName: data.visitorName,
        patientName: data.patientId,
        timestamp: new Date().toISOString(),
      },
      ...prev.slice(0, 4),
    ]);
  };

  return (
    <div className={styles.page}>
      {/* Stats Row */}
      <div className={styles.statsRow}>
        <StatCard
          label="Appointments Today"
          value={stats.appointmentsToday}
          loading={statsLoading}
        />
        <StatCard
          label="New Patients Today"
          value={stats.newPatientsToday}
          loading={statsLoading}
        />
        <StatCard
          label="Beds Available"
          value={bedsAvailable}
          loading={bedsLoading}
        />
        <StatCard
          label="Visitors Logged Today"
          value={recentVisitors.length}
          loading={false}
        />
      </div>

      <div className={styles.twoCol}>
        <div className={styles.leftCol}>
          {/* Today's Appointments */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Today's Appointments</h2>
              <span className={styles.badge}>{appointments.length}</span>
            </div>

            {appointmentsLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : appointmentsError ? (
              <div className={styles.errorState}>Failed to load appointments.</div>
            ) : appointments.length === 0 ? (
              <div className={styles.emptyState}>No appointments for today.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.appointmentsTable}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Patient</th>
                      <th>Doctor</th>
                      <th>Department</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map(apt => (
                      <AppointmentRow
                        key={apt.id}
                        appointment={apt}
                        onCheckIn={handleCheckIn}
                        onNoShow={handleNoShow}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Patients */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent Patient Registrations</h2>
              <button
                className={styles.viewAllLink}
                onClick={() => navigate('/receptionist/patients')}
              >
                View All
              </button>
            </div>

            {patientsLoading ? (
              <div className={styles.listLoading}>
                <SkeletonCard height={60} />
                <SkeletonCard height={60} />
              </div>
            ) : patientsError ? (
              <div className={styles.errorState}>Failed to load patients.</div>
            ) : recentPatients.length === 0 ? (
              <div className={styles.emptyState}>No recent registrations.</div>
            ) : (
              <div className={styles.patientList}>
                {recentPatients.map(patient => (
                  <RecentPatientRow
                    key={patient.id}
                    patient={patient}
                    onView={handleViewPatient}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className={styles.rightCol}>
          {/* Bed Availability */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Bed Availability</h2>
            </div>
            <BedSummary beds={bedMatrix} loading={bedsLoading} />
          </section>

          {/* Visitor Log */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Visitor Log</h2>
            </div>
            <VisitorForm
              onSubmit={handleLogVisitor}
              recentVisitors={recentVisitors}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
