import { useState, useEffect, useRef } from 'react';
import { io }   from 'socket.io-client';
import styles   from './BroadcastCompose.module.scss';

const API_BASE   = import.meta.env.VITE_API_URL    ?? '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';
const MAX_MSG    = 5000;

const PRIORITY_LABELS = {
  LOW     : '🟢 Low',
  MEDIUM  : '🟡 Medium',
  HIGH    : '🟠 High',
  CRITICAL: '🔴 Critical',
};

// ---------------------------------------------------------------------------
// Priority preview banner
// ---------------------------------------------------------------------------
function PreviewBanner({ title, message, priority }) {
  if (!title && !message) return null;
  return (
    <div className={styles.preview}>
      <div className={styles.previewLabel}>Preview</div>
      <div className={`${styles.previewBanner} ${styles[priority]}`}>
        <div className={styles.previewPriority}>{priority} BROADCAST</div>
        <div className={styles.previewTitle}>{title || 'Untitled broadcast'}</div>
        <div className={styles.previewMessage}>{message || 'No message yet…'}</div>
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
          <button className={styles.cancelBtn} onClick={onCancel} disabled={sending}>
            Cancel
          </button>
          <button
            className={`${styles.sendBtn} ${priority === 'CRITICAL' ? styles.critical : ''}`}
            onClick={onConfirm}
            disabled={sending}
            aria-busy={sending}
          >
            {sending ? 'Sending…' : `Send to ${staffCount.toLocaleString()} staff`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-send stats panel with live socket updates
// ---------------------------------------------------------------------------
function StatsPanel({ broadcast, currentUserId, onReset }) {
  const [delivered, setDelivered] = useState(parseInt(broadcast.totalCount, 10));
  const [readCount, setReadCount] = useState(0);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/notifications`, {
      auth      : { token: sessionStorage.getItem('accessToken') },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    // Live delivery confirmation
    socket.on('broadcast:delivered', ({ broadcastId, deliveredCount }) => {
      if (broadcastId === broadcast.id) setDelivered(deliveredCount);
    });

    // Poll read count every 10s
    const poll = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE}/broadcasts/${broadcast.id}`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
        });
        const json = await res.json();
        if (json.data?.read_count != null) setReadCount(parseInt(json.data.read_count, 10));
      } catch { /* ignore */ }
    }, 10_000);

    return () => {
      socket.disconnect();
      clearInterval(poll);
    };
  }, [broadcast.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = delivered > 0 ? Math.round((readCount / delivered) * 100) : 0;

  return (
    <div className={styles.statsPanel}>
      <div className={styles.liveTag}>Live stats</div>
      <h3 className={styles.statsTitle}>Broadcast sent successfully</h3>

      <div className={styles.statsGrid}>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{delivered.toLocaleString()}</span>
          <span className={styles.statLabel}>Delivered</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{readCount.toLocaleString()}</span>
          <span className={styles.statLabel}>Read</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statValue}>{pct}%</span>
          <span className={styles.statLabel}>Read rate</span>
        </div>
      </div>

      <div className={styles.readPct}>{pct}% of recipients have read this broadcast</div>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>

      <button className={styles.newBroadcastBtn} onClick={onReset}>
        Send another broadcast
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main compose form
// ---------------------------------------------------------------------------
export default function BroadcastCompose({ currentUser }) {
  const [form, setForm]           = useState({ title: '', message: '', priority: 'MEDIUM' });
  const [showPreview, setPreview] = useState(false);
  const [showConfirm, setConfirm] = useState(false);
  const [staffCount, setStaffCount] = useState(0);
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(null); // { id, totalCount }
  const [error, setError]         = useState('');

  // Fetch staff count on mount
  useEffect(() => {
    fetch(`${API_BASE}/broadcasts/staff-count`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => setStaffCount(json.count ?? 0))
      .catch(console.error);
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  }

  function handlePreSend(e) {
    e.preventDefault();
    if (!form.title.trim())   { setError('Title is required'); return; }
    if (!form.message.trim()) { setError('Message is required'); return; }
    setConfirm(true);
  }

  async function handleConfirm() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/broadcasts`, {
        method : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to send broadcast');

      setConfirm(false);
      setSent({ id: json.data.broadcast.id, totalCount: json.data.totalCount });
    } catch (err) {
      setError(err.message);
      setConfirm(false);
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    setForm({ title: '', message: '', priority: 'MEDIUM' });
    setSent(null);
    setPreview(false);
    setError('');
  }

  if (sent) {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Broadcast</h1>
        <StatsPanel
          broadcast={sent}
          currentUserId={currentUser?.id}
          onReset={handleReset}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Send Broadcast</h1>

      <form onSubmit={handlePreSend} noValidate>
        <div className={styles.card}>
          <div className={styles.cardBody}>
            {/* Priority */}
            <div className={styles.field}>
              <label className={styles.label}>Priority <span className={styles.req}>*</span></label>
              <div className={styles.priorityGroup} role="group" aria-label="Priority">
                {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={`${styles.priorityBtn} ${styles[val]} ${form.priority === val ? styles.active : ''}`}
                    onClick={() => setForm((p) => ({ ...p, priority: val }))}
                    aria-pressed={form.priority === val}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bc-title">
                Title <span className={styles.req}>*</span>
              </label>
              <input
                id="bc-title"
                name="title"
                className={styles.input}
                value={form.title}
                onChange={handleChange}
                placeholder="e.g. System maintenance tonight at 22:00"
                maxLength={200}
              />
            </div>

            {/* Message */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bc-message">
                Message <span className={styles.req}>*</span>
              </label>
              <textarea
                id="bc-message"
                name="message"
                className={styles.textarea}
                value={form.message}
                onChange={handleChange}
                placeholder="Write your broadcast message here…"
                maxLength={MAX_MSG}
              />
              <span className={`${styles.charCount} ${form.message.length > MAX_MSG * 0.9 ? styles.warn : ''}`}>
                {form.message.length} / {MAX_MSG}
              </span>
            </div>

            {error && (
              <div role="alert" style={{ color: '#ef4444', fontSize: '0.8125rem' }}>
                {error}
              </div>
            )}
          </div>

          {/* Preview */}
          {showPreview && (
            <PreviewBanner
              title={form.title}
              message={form.message}
              priority={form.priority}
            />
          )}

          <div className={styles.cardFooter}>
            <button
              type="button"
              className={styles.previewBtn}
              onClick={() => setPreview((v) => !v)}
            >
              {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            <button
              type="submit"
              className={`${styles.sendBtn} ${form.priority === 'CRITICAL' ? styles.critical : ''}`}
            >
              Send broadcast →
            </button>
          </div>
        </div>
      </form>

      {showConfirm && (
        <ConfirmModal
          staffCount={staffCount}
          priority={form.priority}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(false)}
          sending={sending}
        />
      )}
    </div>
  );
}
