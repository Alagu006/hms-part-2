import { useState, useEffect, useCallback } from 'react';
import styles from './UpcomingSession.module.scss';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const JOIN_WINDOW_MS = 5 * 60 * 1000; // 5 min before

// ---------------------------------------------------------------------------
// Countdown hook
// ---------------------------------------------------------------------------
function useCountdown(targetDate) {
  const [diff, setDiff] = useState(() => new Date(targetDate).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setDiff(new Date(targetDate).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return diff;
}

// ---------------------------------------------------------------------------
// Format countdown
// ---------------------------------------------------------------------------
function formatCountdown(ms) {
  if (ms <= 0) return 'Now';
  const totalSecs = Math.floor(ms / 1000);
  const days  = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;

  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

// ---------------------------------------------------------------------------
// Single session card
// ---------------------------------------------------------------------------
function SessionCard({ session, currentUser, onJoin }) {
  const diff     = useCountdown(session.scheduled_at);
  const canJoin  = diff <= JOIN_WINDOW_MS;
  const isDoctor = currentUser?.roles?.includes('DOCTOR');

  const otherParty = isDoctor
    ? `${session.patient_first} ${session.patient_last}`
    : `Dr. ${session.doctor_first} ${session.doctor_last}`;

  const scheduledDate = new Date(session.scheduled_at);
  const formattedDate = scheduledDate.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
  const formattedTime = scheduledDate.toLocaleTimeString('en-GB', { timeStyle: 'short' });

  const statusColor = {
    SCHEDULED: styles.statusScheduled,
    ACTIVE   : styles.statusActive,
    ENDED    : styles.statusEnded,
    CANCELLED: styles.statusCancelled,
  }[session.status] ?? '';

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.sessionInfo}>
          <div className={styles.otherParty}>{otherParty}</div>
          <div className={styles.datetime}>
            <span>{formattedDate}</span>
            <span className={styles.dot}>·</span>
            <span>{formattedTime}</span>
            <span className={styles.dot}>·</span>
            <span>{session.duration_minutes} min</span>
          </div>
        </div>
        <span className={`${styles.statusBadge} ${statusColor}`}>
          {session.status}
        </span>
      </div>

      {session.status === 'SCHEDULED' || session.status === 'ACTIVE' ? (
        <div className={styles.cardBottom}>
          {canJoin ? (
            <button
              className={styles.joinBtn}
              onClick={() => onJoin(session.id)}
              aria-label={`Join session with ${otherParty}`}
            >
              Join now →
            </button>
          ) : (
            <div className={styles.countdown}>
              <span className={styles.countdownLabel}>Starts in</span>
              <span className={styles.countdownValue}>{formatCountdown(diff)}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function UpcomingSession({ currentUser, onJoin }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const fetchSessions = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/telemedicine/sessions/my?limit=5&status=SCHEDULED`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load sessions');
      setSessions(json.data?.sessions ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    // Refresh every minute
    const id = setInterval(fetchSessions, 60_000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>
          <span>📹</span>
          <p>No upcoming telemedicine sessions</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h3 className={styles.title}>Upcoming Sessions</h3>
        <span className={styles.count}>{sessions.length}</span>
      </div>
      <div className={styles.list}>
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            currentUser={currentUser}
            onJoin={onJoin}
          />
        ))}
      </div>
    </div>
  );
}
