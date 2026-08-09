import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import PatientFileUpload from './PatientFileUpload.jsx';
import SkeletonLoader from '../../shared/components/SkeletonLoader.jsx';
import styles from './NurseDashboard.module.scss';

async function fetchMyAssignments() {
  const data = await apiFetch(`/nurse/assignments`);
  return data?.assignments ?? [];
}

async function fetchVitalsCount() {
  const data = await apiFetch(`/vitals/count?nurseId=me`);
  return data?.count ?? 0;
}

async function fetchHandoverNotes() {
  const data = await apiFetch(`/handover-notes?unreadOnly=true&limit=20`);
  return data?.handoverNotes ?? [];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function SkeletonCard({ height = 120 }) {
  return (
    <div className={styles.skeleton} style={{ height, borderRadius: 8 }} />
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ label, value, alert, loading, accent }) {
  return (
    <div className={`${styles.statCard} ${alert ? styles.statAlert : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      {loading ? (
        <div className={styles.skeleton} style={{ width: 48, height: 32, marginTop: 6 }} />
      ) : (
        <span className={`${styles.statValue} ${accent ? styles.statAccent : ''}`}>{value}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patient card
// ---------------------------------------------------------------------------
function PatientCard({ assignment, onRecordVitals }) {
  const { patientId, firstName, lastName, mrn, roomNumber, bedNumber,
          lastVitalsAt, hoursSinceVitals, isOverdue } = assignment;

  const lastTime = lastVitalsAt
    ? new Date(lastVitalsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`${styles.patientCard} ${isOverdue ? styles.cardOverdue : ''}`}>
      <div className={styles.cardHeader}>
        <div className={styles.patientInfo}>
          <div className={styles.patientName}>{firstName} {lastName}</div>
          <div className={styles.mrn}>{mrn}</div>
        </div>
        {isOverdue && (
          <span className={styles.overdueBadge}>Overdue</span>
        )}
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.metaItem}>
          {roomNumber ? `Room ${roomNumber}` : 'No room'}
          {bedNumber ? ` — Bed ${bedNumber}` : ''}
        </span>
        <span className={styles.metaItem}>
          {lastTime
            ? `Last vitals: ${lastTime}`
            : 'No vitals recorded'}
          {hoursSinceVitals !== null && hoursSinceVitals <= 4 && (
            <span className={styles.hoursTag}>({hoursSinceVitals.toFixed(1)}h ago)</span>
          )}
        </span>
      </div>

      <button
        className={styles.recordBtn}
        onClick={() => onRecordVitals(patientId, `${firstName} ${lastName}`)}
      >
        {isOverdue ? '⚠ Record Vitals Now' : 'Record Vitals'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handover note (expandable)
// ---------------------------------------------------------------------------
function HandoverNote({ note, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);
  const preview = note.note.length > 80
    ? note.note.slice(0, 80) + '…'
    : note.note;

  const priorityClass = {
    URGENT: styles.priorityUrgent,
    HIGH  : styles.priorityHigh,
    NORMAL: styles.priorityNormal,
    LOW   : styles.priorityLow,
  }[note.priority] ?? styles.priorityNormal;

  return (
    <div className={`${styles.noteCard} ${!note.is_read ? styles.noteUnread : ''}`}>
      <div
        className={styles.noteHeader}
        onClick={() => { setExpanded(e => !e); !note.is_read && onMarkRead(note.id); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className={styles.noteMeta}>
          <span className={`${styles.priorityBadge} ${priorityClass}`}>{note.priority}</span>
          <span className={styles.noteNurse}>From: {note.from_nurse_name}</span>
          <span className={styles.notePatient}>
            {note.patient_first_name} {note.patient_last_name} · {note.mrn}
          </span>
        </div>
        {!note.is_read && <span className={styles.unreadDot} aria-label="Unread" />}
      </div>

      {expanded ? (
        <div className={styles.noteBody}>
          <p className={styles.noteText}>{note.note}</p>
          <span className={styles.noteTime}>
            {new Date(note.created_at).toLocaleString()}
          </span>
        </div>
      ) : (
        <p className={styles.notePreview}>{preview}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function NurseDashboard() {
  const navigate = useNavigate();

  const {
    data: assignments = [],
    isLoading: assignLoading,
    isError  : assignError,
  } = useQuery({
    queryKey: ['nurse-assignments'],
    queryFn : fetchMyAssignments,
    refetchInterval: 60_000,
  });

  const {
    data: vitalsCount = 0,
    isLoading: vitalsLoading,
  } = useQuery({
    queryKey: ['nurse-vitals-count'],
    queryFn : fetchVitalsCount,
    refetchInterval: 60_000,
  });

  const {
    data: handoverNotes = [],
    isLoading: handoverLoading,
    isError  : handoverError,
    refetch : refetchHandover,
  } = useQuery({
    queryKey: ['nurse-handover'],
    queryFn : fetchHandoverNotes,
    refetchInterval: 60_000,
  });

  const overdueCount = assignments.filter(a => a.isOverdue).length;
  const unreadHandover = handoverNotes.filter(n => !n.is_read).length;

  function handleRecordVitals(patientId, patientName) {
    navigate(`/nurse/vitals`, { state: { patientId, patientName } });
  }

  async function handleMarkRead(noteId) {
    try {
      await apiFetch(`/handover-notes/${noteId}/read`, { method: 'PATCH' });
      refetchHandover();
    } catch { /* silent */ }
  }

  return (
    <div className={styles.page}>

      {/* ── Stats ── */}
      <div className={styles.statsRow}>
        <StatCard
          label="Patients Today"
          value={assignments.length}
          loading={assignLoading}
        />
        <StatCard
          label="Vitals Recorded"
          value={vitalsCount}
          loading={vitalsLoading}
        />
        <StatCard
          label="Overdue Vitals"
          value={overdueCount}
          alert={overdueCount > 0}
          loading={assignLoading}
        />
        <StatCard
          label="Handover Notes"
          value={unreadHandover}
          alert={unreadHandover > 0}
          loading={handoverLoading}
        />
      </div>

      {/* ── Quick actions ── */}
      <div className={styles.quickActions}>
        <button className={styles.qaBtn} onClick={() => navigate('/nurse/vitals')}>
          💓 Record Vitals <kbd className={styles.qaKey}>V</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/nurse/handover')}>
          📝 Handover Notes <kbd className={styles.qaKey}>H</kbd>
        </button>
        <button className={styles.qaBtn} onClick={() => navigate('/nurse/incidents')}>
          ⚠ Incident Report
        </button>
      </div>

      {/* ── Critical vitals alert banner ── */}
      {overdueCount > 0 && (
        <div className={styles.criticalBanner} role="alert">
          <span className={styles.criticalIcon}>🚨</span>
          <strong>{overdueCount} patient{overdueCount > 1 ? 's' : ''} with overdue vitals</strong>
          — immediate attention required
          <button
            className={styles.criticalBtn}
            onClick={() => {
              const first = assignments.find(a => a.isOverdue);
              if (first) handleRecordVitals(first.patientId, `${first.firstName} ${first.lastName}`);
            }}
          >
            Record Now →
          </button>
        </div>
      )}

      <div className={styles.twoCol}>
        {/* ── My Patients ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Patients Today</h2>
            <span className={styles.badge}>{assignments.length}</span>
          </div>

          {assignLoading ? (
            <div className={styles.cardGrid}>
              <SkeletonCard height={140} />
              <SkeletonCard height={140} />
            </div>
          ) : assignError ? (
            <div className={styles.errorState}>Failed to load patients.</div>
          ) : assignments.length === 0 ? (
            <div className={styles.emptyState}>No patients assigned to you today.</div>
          ) : (
            <div className={styles.cardGrid}>
              {assignments.map(a => (
                <PatientCard
                  key={a.assignmentId}
                  assignment={a}
                  onRecordVitals={handleRecordVitals}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Handover Notes ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Pending Handover Notes</h2>
            {unreadHandover > 0 && (
              <span className={styles.badgeAlert}>{unreadHandover}</span>
            )}
          </div>

          {handoverLoading ? (
            <div className={styles.noteList}>
              <SkeletonCard height={72} />
              <SkeletonCard height={72} />
            </div>
          ) : handoverError ? (
            <div className={styles.errorState}>Failed to load handover notes.</div>
          ) : handoverNotes.length === 0 ? (
            <div className={styles.emptyState}>No unread handover notes.</div>
          ) : (
            <div className={styles.noteList}>
              {handoverNotes.map(n => (
                <HandoverNote
                  key={n.id}
                  note={n}
                  onMarkRead={handleMarkRead}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Patient File Upload ── */}
      <div style={{ marginTop: 24 }}>
        <PatientFileUpload assignments={assignments} loading={assignLoading} />
      </div>
    </div>
  );
}
