import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './HandoverNotes.module.scss';

const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT', 'LOW'];

async function fetchHandoverNotes() {
  const data = await apiFetch(`${API_BASE}/handover-notes?limit=50`);
  return data?.handoverNotes ?? [];
}

async function fetchPatients() {
  const data = await apiFetch(`${API_BASE}/patients?limit=100`);
  return data?.patients ?? [];
}

async function createHandover(body) {
  return apiFetch(`${API_BASE}/handover-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function markRead(id) {
  return apiFetch(`${API_BASE}/handover-notes/${id}/read`, { method: 'PATCH' });
}

function PriorityBadge({ priority }) {
  const cls = {
    URGENT: styles.urgent,
    HIGH: styles.high,
    NORMAL: styles.normal,
    LOW: styles.low,
  }[priority] ?? styles.normal;
  return <span className={`${styles.badge} ${cls}`}>{priority}</span>;
}

function NoteCard({ note, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${styles.noteCard} ${!note.is_read ? styles.unread : ''}`}>
      <div
        className={styles.noteHeader}
        onClick={() => {
          setExpanded(e => !e);
          if (!note.is_read) onMarkRead(note.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className={styles.noteMeta}>
          <PriorityBadge priority={note.priority} />
          <span className={styles.noteFrom}>From: {note.from_nurse_name}</span>
          <span className={styles.notePatient}>
            {note.patient_first_name} {note.patient_last_name} · {note.mrn}
          </span>
          <span className={styles.noteTime}>
            {new Date(note.created_at).toLocaleString()}
          </span>
        </div>
        {!note.is_read && <span className={styles.unreadDot} aria-label="Unread" />}
      </div>
      {expanded && (
        <div className={styles.noteBody}>
          <p>{note.note}</p>
        </div>
      )}
    </div>
  );
}

export default function HandoverNotes() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ patientId: '', note: '', priority: 'NORMAL' });
  const [toast, setToast] = useState('');

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['handover-notes'],
    queryFn: fetchHandoverNotes,
    refetchInterval: 30_000,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-list'],
    queryFn: fetchPatients,
  });

  const createMutation = useMutation({
    mutationFn: createHandover,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handover-notes'] });
      setForm({ patientId: '', note: '', priority: 'NORMAL' });
      setToast('Handover note created.');
      setTimeout(() => setToast(''), 3000);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['handover-notes'] }),
  });

  const handleSubmit = e => {
    e.preventDefault();
    if (!form.patientId || !form.note.trim()) return;
    createMutation.mutate(form);
  };

  const unreadCount = notes.filter(n => !n.is_read).length;

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <h1 className={styles.title}>Handover Notes</h1>

      <div className={styles.layout}>
        {/* Create form */}
        <section className={styles.formSection}>
          <h2 className={styles.sectionTitle}>Create Handover Note</h2>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              Patient
              <select
                value={form.patientId}
                onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))}
                required
              >
                <option value="">Select patient…</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.mrn})
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.label}>
              Priority
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <label className={styles.label}>
              Note
              <textarea
                className={styles.textarea}
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                rows={5}
                placeholder="Write handover note…"
                required
              />
            </label>

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Saving…' : 'Create Note'}
            </button>
            {createMutation.isError && (
              <p className={styles.error}>Failed to create note.</p>
            )}
          </form>
        </section>

        {/* Notes list */}
        <section className={styles.listSection}>
          <div className={styles.listHeader}>
            <h2 className={styles.sectionTitle}>All Handover Notes</h2>
            {unreadCount > 0 && (
              <span className={styles.unreadBadge}>{unreadCount} unread</span>
            )}
          </div>

          {isLoading ? (
            <p className={styles.loading}>Loading…</p>
          ) : notes.length === 0 ? (
            <p className={styles.empty}>No handover notes yet.</p>
          ) : (
            <div className={styles.noteList}>
              {notes.map(n => (
                <NoteCard
                  key={n.id}
                  note={n}
                  onMarkRead={id => markReadMutation.mutate(id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
