import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import VisitorCheckIn from './VisitorCheckIn.jsx';
import styles from './SecurityDashboard.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function fetchActiveVisitors() {
  const json = await apiFetch(`${API_BASE}/visitors?checkedOut=false&limit=100`);
  return json.visitors ?? [];
}

async function fetchTodaysVisitors() {
  const today = new Date().toISOString().split('T')[0];
  const json = await apiFetch(`${API_BASE}/visitors?date=${today}&limit=100`);
  return json.visitors ?? [];
}

async function fetchIncidents() {
  const json = await apiFetch(`${API_BASE}/incidents?limit=10`);
  return json;
}

async function checkoutVisitor(id) {
  const json = await apiFetch(`${API_BASE}/visitors/${id}/checkout`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function maskPhone(phone) {
  if (!phone) return 'N/A';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return digits;
  return '****' + digits.slice(-4);
}

function getTimeElapsed(checkInTime) {
  const checkIn = new Date(checkInTime);
  const now = new Date();
  const diffMs = now - checkIn;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return { hours, minutes, totalMinutes: Math.floor(diffMs / (1000 * 60)) };
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
function StatCard({ label, value, alert, loading }) {
  return (
    <div className={`${styles.statCard} ${alert ? styles.statAlert : ''}`}>
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
// Active Visitor Row
// ---------------------------------------------------------------------------
function ActiveVisitorRow({ visitor, onCheckout }) {
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const elapsed = getTimeElapsed(visitor.checked_in_at);
  const isLongStay = elapsed.totalMinutes > 120;

  const handleCheckout = async () => {
    setIsCheckingOut(true);
    try {
      await onCheckout(visitor.id);
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <tr className={`${styles.visitorRow} ${isLongStay ? styles.longStayRow : ''}`}>
      <td className={styles.nameCell}>
        <span className={styles.visitorName}>{visitor.visitor_name ?? 'N/A'}</span>
      </td>
      <td className={styles.phoneCell}>
        {maskPhone(visitor.visitor_phone)}
      </td>
      <td>
        {visitor.patient_name ?? 'N/A'}
        {visitor.patient_mrn && <span className={styles.mrn}>({visitor.patient_mrn})</span>}
      </td>
      <td className={styles.timeCell}>
        {new Date(visitor.checked_in_at).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className={styles.elapsedCell}>
        <span className={isLongStay ? styles.elapsedWarning : ''}>
          {elapsed.hours > 0 && `${elapsed.hours}h `}{elapsed.minutes}m
        </span>
      </td>
      <td>
        <button
          className={styles.checkoutBtn}
          onClick={handleCheckout}
          disabled={isCheckingOut}
        >
          {isCheckingOut ? '...' : 'Check Out'}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Today's Visitor Row
// ---------------------------------------------------------------------------
function TodaysVisitorRow({ visitor }) {
  const patientName = visitor.patient_name ?? 'N/A';
  const isStillInside = !visitor.checked_out_at;

  return (
    <tr className={styles.visitorRow}>
      <td className={styles.nameCell}>
        <span className={styles.visitorName}>{visitor.visitor_name ?? 'N/A'}</span>
      </td>
      <td>{patientName}</td>
      <td className={styles.timeCell}>
        {new Date(visitor.checked_in_at).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className={styles.timeCell}>
        {isStillInside ? (
          <span className={styles.stillInside}>Still inside</span>
        ) : (
          new Date(visitor.checked_out_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })
        )}
      </td>
      <td>{visitor.purpose ?? '—'}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Incident Row
// ---------------------------------------------------------------------------
function IncidentRow({ incident }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const typeBadgeClass = {
    NEAR_MISS: styles.typeNearMiss,
    ADVERSE_EVENT: styles.typeAdverse,
    EQUIPMENT_FAILURE: styles.typeEquipment,
    SECURITY_BREACH: styles.typeSecurity,
  }[incident.incident_type] ?? '';

  const severityClass =
    incident.severity >= 4 ? styles.severityRed :
    incident.severity === 3 ? styles.severityAmber :
    styles.severityGreen;

  const reporterName = `${incident.reporter_first ?? ''} ${incident.reporter_last ?? ''}`.trim() || 'N/A';
  const patientName = incident.patient_first && incident.patient_last
    ? `${incident.patient_first} ${incident.patient_last}`
    : null;

  return (
    <>
      <tr
        className={styles.incidentRow}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td>
          <span className={`${styles.typeBadge} ${typeBadgeClass}`}>
            {incident.incident_type?.replace(/_/g, ' ')}
          </span>
        </td>
        <td>
          <span className={`${styles.severityBadge} ${severityClass}`}>
            {incident.severity}
          </span>
        </td>
        <td>{reporterName}</td>
        <td>{patientName ?? '—'}</td>
        <td className={styles.timeCell}>{getTimeAgo(incident.created_at)}</td>
      </tr>
      {isExpanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={5}>
            <div className={styles.expandedContent}>
              <div className={styles.descriptionSection}>
                <strong>Description:</strong>
                <p>{incident.description}</p>
              </div>
              <div className={styles.statusSection}>
                <span className={styles.statusBadge}>
                  Status: {incident.status?.replace(/_/g, ' ')}
                </span>
                {incident.occurred_at && (
                  <span className={styles.occurredAt}>
                    Occurred: {new Date(incident.occurred_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function Toast({ message, type, onClose }) {
  if (!message) return null;
  return (
    <div className={`${styles.toast} ${type === 'success' ? styles.toastSuccess : styles.toastError}`}>
      <span>{message}</span>
      <button className={styles.toastClose} onClick={onClose}>×</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function SecurityDashboard() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState({ message: '', type: '' });
  const [visitorSearch, setVisitorSearch] = useState('');

  // Active visitors
  const {
    data: activeVisitors = [],
    isLoading: activeLoading,
    isError: activeError,
  } = useQuery({
    queryKey: ['security-active-visitors'],
    queryFn: fetchActiveVisitors,
    refetchInterval: 60_000,
  });

  // Today's visitors
  const {
    data: todaysVisitors = [],
    isLoading: todaysLoading,
    isError: todaysError,
  } = useQuery({
    queryKey: ['security-todays-visitors'],
    queryFn: fetchTodaysVisitors,
    refetchInterval: 60_000,
  });

  // Incidents
  const {
    data: incidents = [],
    isLoading: incidentsLoading,
    isError: incidentsError,
  } = useQuery({
    queryKey: ['security-incidents'],
    queryFn: fetchIncidents,
    refetchInterval: 60_000,
  });

  const activeVisitorsCount = activeVisitors.length;
  const todaysVisitorsCount = todaysVisitors.length;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const incidentsThisWeek = incidents.filter(i =>
    new Date(i.created_at) >= oneWeekAgo
  ).length;

  const highSeverityIncidents = incidents.filter(i =>
    new Date(i.created_at) >= oneWeekAgo && i.severity >= 4
  ).length;

  // Checkout mutation
  const checkoutMutation = useMutation({
    mutationFn: checkoutVisitor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['security-active-visitors'] });
      queryClient.invalidateQueries({ queryKey: ['security-todays-visitors'] });
      setToast({ message: 'Visitor checked out successfully!', type: 'success' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
    onError: () => {
      setToast({ message: 'Failed to checkout visitor', type: 'error' });
      setTimeout(() => setToast({ message: '', type: '' }), 3000);
    },
  });

  const handleCheckout = (id) => checkoutMutation.mutate(id);

  // Client-side filter for today's visitors
  const filteredVisitors = todaysVisitors.filter(v => {
    if (!visitorSearch.trim()) return true;
    const search = visitorSearch.toLowerCase();
    const visitorName = (v.visitor_name ?? '').toLowerCase();
    const patientName = (v.patient_name ?? '').toLowerCase();
    return visitorName.includes(search) || patientName.includes(search);
  });

  return (
    <div className={styles.page}>
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: '' })}
      />

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <StatCard
          label="Active Visitors"
          value={activeVisitorsCount}
          alert={activeVisitorsCount > 0}
          loading={activeLoading}
        />
        <StatCard
          label="Visitors Today"
          value={todaysVisitorsCount}
          loading={todaysLoading}
        />
        <StatCard
          label="Incidents This Week"
          value={incidentsThisWeek}
          loading={incidentsLoading}
        />
        <StatCard
          label="High Severity Incidents"
          value={highSeverityIncidents}
          alert={highSeverityIncidents > 0}
          loading={incidentsLoading}
        />
      </div>

      <div className={styles.twoCol}>
        <div className={styles.leftCol}>
          {/* Active Visitors */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Active Visitors</h2>
              <span className={`${styles.badge} ${activeVisitorsCount > 0 ? styles.badgeActive : ''}`}>
                {activeVisitorsCount}
              </span>
            </div>

            {activeLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : activeError ? (
              <div className={styles.errorState}>Failed to load active visitors.</div>
            ) : activeVisitors.length === 0 ? (
              <div className={styles.emptyState}>No active visitors.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.visitorTable}>
                  <thead>
                    <tr>
                      <th>Visitor Name</th>
                      <th>Phone</th>
                      <th>Patient</th>
                      <th>Check In</th>
                      <th>Elapsed</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeVisitors.map(v => (
                      <ActiveVisitorRow
                        key={v.id}
                        visitor={v}
                        onCheckout={handleCheckout}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Incidents */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent Incidents</h2>
              <span className={styles.badge}>{incidents.length}</span>
            </div>

            {incidentsLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : incidentsError ? (
              <div className={styles.errorState}>Failed to load incidents.</div>
            ) : incidents.length === 0 ? (
              <div className={styles.emptyState}>No recent incidents.</div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.incidentTable}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Severity</th>
                      <th>Reported By</th>
                      <th>Patient</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map(i => (
                      <IncidentRow key={i.id} incident={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className={styles.rightCol}>
          {/* Visitor Check-In */}
          <VisitorCheckIn
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ['security-active-visitors'] });
              queryClient.invalidateQueries({ queryKey: ['security-todays-visitors'] });
            }}
          />

          {/* Today's Visitor Log */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Today's Visitor Log</h2>
              <span className={styles.badge}>{todaysVisitors.length}</span>
            </div>

            <div className={styles.searchBar}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by visitor or patient name..."
                value={visitorSearch}
                onChange={(e) => setVisitorSearch(e.target.value)}
              />
            </div>

            {todaysLoading ? (
              <div className={styles.tableLoading}>
                <SkeletonCard height={200} />
              </div>
            ) : todaysError ? (
              <div className={styles.errorState}>Failed to load visitor log.</div>
            ) : filteredVisitors.length === 0 ? (
              <div className={styles.emptyState}>
                {visitorSearch ? 'No visitors match your search.' : 'No visitors logged today.'}
              </div>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.visitorTable}>
                  <thead>
                    <tr>
                      <th>Visitor</th>
                      <th>Patient</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVisitors.map(v => (
                      <TodaysVisitorRow key={v.id} visitor={v} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
