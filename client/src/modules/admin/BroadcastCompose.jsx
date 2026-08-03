import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import styles from './BroadcastCompose.module.scss';

const MAX_MSG  = 5000;

const PRIORITY_LABELS = {
  LOW     : '🟢 Low',
  MEDIUM  : '🟡 Medium',
  HIGH    : '🟠 High',
  CRITICAL: '🔴 Critical',
};

const PRIORITY_COLORS = {
  LOW     : styles.LOW,
  MEDIUM  : styles.MEDIUM,
  HIGH    : styles.HIGH,
  CRITICAL: styles.CRITICAL,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Broadcast history item
// ---------------------------------------------------------------------------
function BroadcastItem({ bc, isNew }) {
  const readPct = bc.total_sent > 0
    ? Math.round((bc.read_count / bc.total_sent) * 100)
    : 0;

  return (
    <div className={`${styles.historyItem} ${isNew ? styles.historyItemNew : ''}`}>
      <div className={styles.historyTop}>
        <span className={`${styles.priorityPill} ${PRIORITY_COLORS[bc.priority] ?? ''}`}>
          {bc.priority ?? 'MEDIUM'}
        </span>
        <span className={styles.historyTime}>{timeAgo(bc.sent_at)}</span>
      </div>
      <div className={styles.historyTitle}>{bc.title}</div>
      <div className={styles.historyBody}>{bc.body}</div>
      <div className={styles.historyMeta}>
        <span>By {bc.sender_name}</span>
        <span className={styles.dot}>·</span>
        <span>{parseInt(bc.total_sent, 10).toLocaleString()} recipients</span>
        <span className={styles.dot}>·</span>
        <span>{readPct}% read</span>
      </div>
      <div className={styles.miniProgress}>
        <div className={styles.miniProgressFill} style={{ width: `${readPct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------
function ConfirmModal({ staffCount, priority, onConfirm, onCancel, sending }) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="confirm-title">Confirm Broadcast</h3>
        </div>
        <div className={styles.modalBody}>
          <p>You are about to send a <strong>{priority}</strong> priority broadcast to:</p>
          <span className={styles.recipientCount}>{staffCount.toLocaleString()} staff members</span>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '0.8125rem' }}>
            Each recipient will receive an in-app notification
            {priority === 'CRITICAL' ? ' and a banner alert' : ''}.
            This action is permanent and audit-logged.
          </p>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={sending}>Cancel</button>
          <button
            className={`${styles.sendBtn} ${priority === 'CRITICAL' ? styles.critical : ''}`}
            onClick={onConfirm} disabled={sending} aria-busy={sending}
          >
            {sending ? 'Sending…' : `Send to ${staffCount.toLocaleString()} staff`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function BroadcastCompose() {
  const qc = useQueryClient();
  const [form, setForm]         = useState({ title: '', message: '', priority: 'MEDIUM' });
  const [showPreview, setPreview] = useState(false);
  const [showConfirm, setConfirm] = useState(false);
  const [error, setError]       = useState('');
  const [newId, setNewId]       = useState(null); // highlight newly sent broadcast
  const historyRef              = useRef(null);

  // Fetch staff count
  const { data: staffCount = 0 } = useQuery({
    queryKey: ['broadcast-staff-count'],
    queryFn: async () => {
      const d = await apiFetch(`${API_BASE}/broadcasts/staff-count`);
      return d?.count ?? 0;
    },
  });

  // Fetch broadcast history — newest first
  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: async () => {
      const d = await apiFetch(`${API_BASE}/broadcasts?limit=50&page=1`);
      return d?.broadcasts ?? [];
    },
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () => apiFetch(`${API_BASE}/broadcasts`, {
      method: 'POST',
      body: JSON.stringify(form),
    }),
    onSuccess: (data) => {
      const id = data?.data?.broadcast?.id;
      setNewId(id);
      setConfirm(false);
      setForm({ title: '', message: '', priority: 'MEDIUM' });
      setPreview(false);
      qc.invalidateQueries({ queryKey: ['broadcasts'] });
      // Scroll history to top after refetch
      setTimeout(() => historyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 400);
    },
    onError: (err) => { setError(err.message); setConfirm(false); },
  });

  function handleChange(e) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }));
    setError('');
  }

  function handlePreSend(e) {
    e.preventDefault();
    if (!form.title.trim())   { setError('Title is required'); return; }
    if (!form.message.trim()) { setError('Message is required'); return; }
    setConfirm(true);
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Broadcast</h1>

      <div className={styles.layout}>
        {/* ── Compose form ── */}
        <div className={styles.composeCol}>
          <form onSubmit={handlePreSend} noValidate>
            <div className={styles.card}>
              <div className={styles.cardBody}>
                {/* Priority */}
                <div className={styles.field}>
                  <label className={styles.label}>Priority <span className={styles.req}>*</span></label>
                  <div className={styles.priorityGroup} role="group" aria-label="Priority">
                    {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                      <button key={val} type="button"
                        className={`${styles.priorityBtn} ${styles[val]} ${form.priority === val ? styles.active : ''}`}
                        onClick={() => setForm(p => ({ ...p, priority: val }))}
                        aria-pressed={form.priority === val}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="bc-title">Title <span className={styles.req}>*</span></label>
                  <input id="bc-title" name="title" className={styles.input}
                    value={form.title} onChange={handleChange}
                    placeholder="e.g. System maintenance tonight at 22:00" maxLength={200} />
                </div>

                {/* Message */}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="bc-message">Message <span className={styles.req}>*</span></label>
                  <textarea id="bc-message" name="message" className={styles.textarea}
                    value={form.message} onChange={handleChange}
                    placeholder="Write your broadcast message here…" maxLength={MAX_MSG} />
                  <span className={`${styles.charCount} ${form.message.length > MAX_MSG * 0.9 ? styles.warn : ''}`}>
                    {form.message.length} / {MAX_MSG}
                  </span>
                </div>

                {error && <div role="alert" className={styles.formError}>{error}</div>}
              </div>

              {/* Preview */}
              {showPreview && form.title && (
                <div className={styles.preview}>
                  <div className={styles.previewLabel}>Preview</div>
                  <div className={`${styles.previewBanner} ${styles[form.priority]}`}>
                    <div className={styles.previewPriority}>{form.priority} BROADCAST</div>
                    <div className={styles.previewTitle}>{form.title}</div>
                    <div className={styles.previewMessage}>{form.message || 'No message yet…'}</div>
                  </div>
                </div>
              )}

              <div className={styles.cardFooter}>
                <button type="button" className={styles.previewBtn} onClick={() => setPreview(v => !v)}>
                  {showPreview ? 'Hide preview' : 'Preview'}
                </button>
                <button type="submit"
                  className={`${styles.sendBtn} ${form.priority === 'CRITICAL' ? styles.critical : ''}`}
                  disabled={mutation.isPending}
                >
                  Send broadcast →
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* ── History ── */}
        <div className={styles.historyCol}>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>Sent Broadcasts</span>
            <span className={styles.historyCount}>{history.length}</span>
          </div>
          <div className={styles.historyList} ref={historyRef}>
            {histLoading ? (
              <div className={styles.histSkeleton} />
            ) : history.length === 0 ? (
              <div className={styles.histEmpty}>No broadcasts sent yet</div>
            ) : (
              history.map(bc => (
                <BroadcastItem key={bc.id} bc={bc} isNew={bc.id === newId} />
              ))
            )}
          </div>
        </div>
      </div>

      {showConfirm && (
        <ConfirmModal
          staffCount={staffCount}
          priority={form.priority}
          onConfirm={() => mutation.mutate()}
          onCancel={() => setConfirm(false)}
          sending={mutation.isPending}
        />
      )}
    </div>
  );
}
