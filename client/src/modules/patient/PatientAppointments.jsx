import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../shared/utils/api.js';
import styles from './PatientAppointments.module.scss';

const JOIN_WINDOW_MS = 5 * 60 * 1000;

async function fetchAppointments() {
  const data = await apiFetch(`/appointments?patientId=me&limit=50`);
  return data?.appointments ?? [];
}

async function fetchMyTeleSessions() {
  const data = await apiFetch(`/telemedicine/sessions/my?limit=50`);
  return data?.data?.sessions ?? [];
}

function SkeletonRow({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}><div className={styles.skeleton} style={{ width: `${50 + Math.random() * 40}%` }} /></td>
      ))}
    </tr>
  );
}

function TypeBadge({ type }) {
  const map = { TELEMEDICINE: styles.badgeTele, FOLLOW_UP: styles.badgeFollow, EMERGENCY: styles.badgeEmergency, IN_PERSON: styles.badgeInPerson };
  return <span className={`${styles.badge} ${map[type] ?? ''}`}>{type.replace(/_/g, ' ')}</span>;
}

function StatusBadge({ status }) {
  const map = { SCHEDULED: styles.statusSched, CONFIRMED: styles.statusConfirm, IN_PROGRESS: styles.statusProgress, COMPLETED: styles.statusDone, CANCELLED: styles.statusCancell, NO_SHOW: styles.statusNoShow };
  return <span className={`${styles.statusBadge} ${map[status] ?? ''}`}>{status.replace(/_/g, ' ')}</span>;
}

function CancelModal({ appt, onClose, onConfirm, loading }) {
  const [reason, setReason] = useState('');
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Cancel appointment">
      <div className={styles.modal}>
        <h2 className={styles.modalTitle}>Cancel Appointment</h2>
        <p className={styles.modalSub}>Cancel your appointment with Dr. {appt.doctor_first_name} {appt.doctor_last_name}?</p>
        <label className={styles.label}>Reason (optional)</label>
        <textarea className={styles.textarea} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Let us know why you're cancelling…" />
        <div className={styles.modalActions}>
          <button className={styles.btnSecondary} onClick={onClose} disabled={loading}>Keep it</button>
          <button className={styles.btnDanger} onClick={() => onConfirm(reason)} disabled={loading}>{loading ? 'Cancelling…' : 'Yes, cancel'}</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ appt, onClose, onSave, loading }) {
  const toLocal = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [scheduledAt, setScheduledAt] = useState(toLocal(new Date(appt.scheduled_at)));
  const [type, setType]   = useState(appt.type);
  const [reason, setReason] = useState(appt.reason ?? '');
  const [err, setErr]     = useState('');

  function handleSave() {
    if (reason.trim().length < 5) { setErr('Reason must be at least 5 characters.'); return; }
    const iso = new Date(scheduledAt).toISOString();
    if (new Date(iso) <= new Date()) { setErr('Please pick a future date and time.'); return; }
    onSave({ scheduledAt: iso, type, reason: reason.trim() });
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Edit appointment">
      <div className={styles.modal}>
        <h2 className={styles.modalTitle}>Edit Appointment</h2>
        <label className={styles.label}>Date &amp; Time</label>
        <input type="datetime-local" className={styles.input} value={scheduledAt} min={toLocal(new Date())} onChange={e => setScheduledAt(e.target.value)} />
        <label className={styles.label}>Type</label>
        <select className={styles.input} value={type} onChange={e => setType(e.target.value)}>
          <option value="IN_PERSON">In-Person</option>
          <option value="TELEMEDICINE">Telemedicine</option>
          <option value="FOLLOW_UP">Follow-Up</option>
          <option value="EMERGENCY">Emergency</option>
        </select>
        <label className={styles.label}>Reason</label>
        <textarea className={styles.textarea} rows={3} value={reason} onChange={e => { setReason(e.target.value); setErr(''); }} />
        {err && <p className={styles.fieldError}>{err}</p>}
        <div className={styles.modalActions}>
          <button className={styles.btnSecondary} onClick={onClose} disabled={loading}>Discard</button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

export default function PatientAppointments() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [filter, setFilter]         = useState('upcoming');
  const [cancelAppt, setCancelAppt] = useState(null);
  const [editAppt, setEditAppt]     = useState(null);
  const [toast, setToast]           = useState(null);

  const { data: appointments = [], isLoading, isError } = useQuery({
    queryKey: ['patient-appointments'],
    queryFn: fetchAppointments,
    refetchInterval: 60_000,
  });

  const { data: teleSessions = [] } = useQuery({
    queryKey: ['patient-tele-sessions'],
    queryFn: fetchMyTeleSessions,
    refetchInterval: 60_000,
  });

  // appointment_id -> session
  const teleByAppt = teleSessions.reduce((acc, s) => {
    if (s.appointment_id) acc[s.appointment_id] = s;
    return acc;
  }, {});

  function canJoinTele(session) {
    if (!session || !['WAITING', 'ACTIVE'].includes(session.status)) return false;
    return (new Date(session.scheduled_at).getTime() - Date.now()) <= JOIN_WINDOW_MS;
  }

  const mutation = useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch(`/appointments/${id}/patient`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (_, { body }) => {
      qc.invalidateQueries({ queryKey: ['patient-appointments'] });
      setToast(body.action === 'cancel' ? 'Appointment cancelled.' : 'Appointment updated.');
      setCancelAppt(null);
      setEditAppt(null);
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err) => setToast(`Error: ${err.message}`),
  });

  const now = new Date();
  const canModify = (a) => ['SCHEDULED', 'CONFIRMED'].includes(a.status) && new Date(a.scheduled_at) > now;
  const upcoming  = appointments.filter(a => ['SCHEDULED','CONFIRMED'].includes(a.status) && new Date(a.scheduled_at) >= now);
  const past      = appointments.filter(a => ['COMPLETED','CANCELLED','NO_SHOW'].includes(a.status) || new Date(a.scheduled_at) < now);
  const displayed = filter === 'upcoming' ? upcoming : past;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Appointments</h1>
        <button className={styles.bookBtn} onClick={() => navigate('/patient/appointments/book')}>+ Book Appointment</button>
      </div>

      <div className={styles.tabs} role="tablist">
        <button role="tab" className={`${styles.tab} ${filter === 'upcoming' ? styles.tabActive : ''}`} onClick={() => setFilter('upcoming')} aria-selected={filter === 'upcoming'}>
          Upcoming ({upcoming.length})
        </button>
        <button role="tab" className={`${styles.tab} ${filter === 'past' ? styles.tabActive : ''}`} onClick={() => setFilter('past')} aria-selected={filter === 'past'}>
          Past ({past.length})
        </button>
      </div>

      <div className={styles.card}>
        {isLoading ? (
          <table className={styles.table}><tbody><SkeletonRow /><SkeletonRow /><SkeletonRow /></tbody></table>
        ) : isError ? (
          <div className={styles.errorState}>Failed to load appointments.</div>
        ) : displayed.length === 0 ? (
          <div className={styles.emptyState}>{filter === 'upcoming' ? 'No upcoming appointments. Book one now!' : 'No past appointments.'}</div>
        ) : (
          <table className={styles.table} aria-label="Appointments">
            <thead>
              <tr>
                <th>Date &amp; Time</th><th>Doctor</th><th>Department</th><th>Type</th><th>Status</th>
                {filter === 'upcoming' && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map(appt => {
                const dt        = new Date(appt.scheduled_at);
                const dateStr   = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr   = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                const modifiable  = canModify(appt);
                const teleSession = teleByAppt[appt.id];
                const joinable    = appt.type === 'TELEMEDICINE' && canJoinTele(teleSession);
                return (
                  <tr key={appt.id}>
                    <td><div className={styles.dateTime}><span className={styles.date}>{dateStr}</span><span className={styles.time}>{timeStr}</span></div></td>
                    <td><div className={styles.docName}>Dr. {appt.doctor_first_name} {appt.doctor_last_name}</div></td>
                    <td>{appt.department_name ?? '—'}</td>
                    <td><TypeBadge type={appt.type} /></td>
                    <td><StatusBadge status={appt.status} /></td>
                    {filter === 'upcoming' && (
                      <td>
                        <div className={styles.actions}>
                          {joinable && (
                            <button className={styles.btnJoin} onClick={() => navigate(`/patient/telemedicine/${teleSession.room_id}`)}>
                              📹 Join
                            </button>
                          )}
                          {modifiable && (
                            <>
                              <button className={styles.btnEdit} onClick={() => setEditAppt(appt)}>Edit</button>
                              <button className={styles.btnCancel} onClick={() => setCancelAppt(appt)}>Cancel</button>
                            </>
                          )}
                          {!joinable && !modifiable && '—'}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {cancelAppt && <CancelModal appt={cancelAppt} onClose={() => setCancelAppt(null)} loading={mutation.isPending} onConfirm={(r) => mutation.mutate({ id: cancelAppt.id, body: { action: 'cancel', cancellationReason: r } })} />}
      {editAppt   && <EditModal   appt={editAppt}   onClose={() => setEditAppt(null)}   loading={mutation.isPending} onSave={(f) => mutation.mutate({ id: editAppt.id,   body: { action: 'update', ...f } })} />}
      {toast && <div className={styles.toast} role="status">{toast}</div>}
    </div>
  );
}
