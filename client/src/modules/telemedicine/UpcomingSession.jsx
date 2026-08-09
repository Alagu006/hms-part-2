import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../shared/utils/api.js';
import { useAuth } from '../../shared/store/index.js';
import styles from './UpcomingSession.module.scss';

const JOIN_WINDOW_MS = 5 * 60 * 1000;

function useCountdown(targetDate) {
  const [diff, setDiff] = useState(() => new Date(targetDate).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setDiff(new Date(targetDate).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetDate]);
  return diff;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Now';
  const s = Math.floor(ms / 1000);
  const days  = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins  = Math.floor((s % 3600) / 60);
  const secs  = s % 60;
  if (days > 0)  return days + 'd ' + hours + 'h';
  if (hours > 0) return hours + 'h ' + mins + 'm';
  return mins + 'm ' + secs + 's';
}

// Card for a live session (WAITING or ACTIVE)
function SessionCard({ session, isDoctor, onJoin }) {
  const diff    = useCountdown(session.scheduled_at);
  const canJoin = diff <= JOIN_WINDOW_MS;
  const otherParty = isDoctor
    ? (session.patient_first + ' ' + session.patient_last)
    : ('Dr. ' + session.doctor_first + ' ' + session.doctor_last);
  const dt = new Date(session.scheduled_at);
  const dateStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  const timeStr = dt.toLocaleTimeString('en-GB', { timeStyle: 'short' });
  const statusMap = { WAITING: styles.statusScheduled, ACTIVE: styles.statusActive, COMPLETED: styles.statusEnded, CANCELLED: styles.statusCancelled };

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.sessionInfo}>
          <div className={styles.otherParty}>{otherParty}</div>
          <div className={styles.datetime}>
            <span>{dateStr}</span><span className={styles.dot}>·</span>
            <span>{timeStr}</span>
            {session.duration_minutes && <><span className={styles.dot}>·</span><span>{session.duration_minutes} min</span></>}
          </div>
        </div>
        <span className={`${styles.statusBadge} ${statusMap[session.status] ?? ''}`}>{session.status}</span>
      </div>
      <div className={styles.cardBottom}>
        {canJoin ? (
          <button className={styles.joinBtn} onClick={() => onJoin(session)}>📹 Join now</button>
        ) : (
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>Starts in</span>
            <span className={styles.countdownValue}>{formatCountdown(diff)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Card for a booked TELEMEDICINE appointment that has no session yet
function PendingApptCard({ appt }) {
  const diff = useCountdown(appt.scheduled_at);
  const dt = new Date(appt.scheduled_at);
  const dateStr = dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  const timeStr = dt.toLocaleTimeString('en-GB', { timeStyle: 'short' });

  return (
    <div className={styles.card} style={{ borderStyle: 'dashed', opacity: 0.85 }}>
      <div className={styles.cardTop}>
        <div className={styles.sessionInfo}>
          <div className={styles.otherParty}>Dr. {appt.doctor_first_name} {appt.doctor_last_name}</div>
          <div className={styles.datetime}>
            <span>{dateStr}</span><span className={styles.dot}>·</span><span>{timeStr}</span>
          </div>
        </div>
        <span className={`${styles.statusBadge} ${styles.statusScheduled}`}>SCHEDULED</span>
      </div>
      <div className={styles.cardBottom}>
        {diff <= JOIN_WINDOW_MS ? (
          <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>Waiting for doctor to start the call…</span>
        ) : (
          <div className={styles.countdown}>
            <span className={styles.countdownLabel}>Starts in</span>
            <span className={styles.countdownValue}>{formatCountdown(diff)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UpcomingSession({ currentUser: currentUserProp, onJoin: onJoinProp }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUser = currentUserProp ?? user;
  const isDoctor = currentUser?.roles?.includes('DOCTOR');

  const [sessions, setSessions]               = useState([]);
  const [pendingAppointments, setPending]     = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [waiting, active] = await Promise.all([
        apiFetch(`/telemedicine/sessions/my?limit=20&status=WAITING`),
        apiFetch(`/telemedicine/sessions/my?limit=20&status=ACTIVE`),
      ]);
      const all = [...(waiting?.data?.sessions ?? []), ...(active?.data?.sessions ?? [])];
      const seen = new Set();
      const deduped = all.filter(s => seen.has(s.id) ? false : seen.add(s.id));
      setSessions(deduped);

      if (!isDoctor) {
        const apptData = await apiFetch(`/appointments?patientId=me&limit=50`);
        const appts = (apptData?.appointments ?? []).filter(a =>
          a.type === 'TELEMEDICINE' &&
          ['SCHEDULED', 'CONFIRMED'].includes(a.status) &&
          new Date(a.scheduled_at) > new Date()
        );
        const sessionApptIds = new Set(deduped.map(s => s.appointment_id).filter(Boolean));
        setPending(appts.filter(a => !sessionApptIds.has(a.id)));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isDoctor]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  function handleJoin(session) {
    if (onJoinProp) { onJoinProp(session); return; }
    const base = isDoctor ? '/doctor' : '/patient';
    navigate(base + '/telemedicine/' + session.room_id);
  }

  if (loading) {
    return <div className={styles.wrapper}><div className={styles.skeleton} /><div className={styles.skeleton} /></div>;
  }

  if (error) {
    return <div className={styles.wrapper}><p className={styles.errorText}>{error}</p></div>;
  }

  const total = sessions.length + pendingAppointments.length;

  if (total === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>
          <span>📹</span>
          <p>No upcoming telemedicine sessions</p>
          {!isDoctor && <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: 4 }}>Book a telemedicine appointment to get started</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h3 className={styles.title}>Upcoming Sessions</h3>
        <span className={styles.count}>{total}</span>
      </div>
      <div className={styles.list}>
        {sessions.map(s => <SessionCard key={s.id} session={s} isDoctor={isDoctor} onJoin={handleJoin} />)}
        {pendingAppointments.map(a => <PendingApptCard key={a.id} appt={a} />)}
      </div>
    </div>
  );
}
