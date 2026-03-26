import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './Chatbot.module.scss';

const API_BASE      = import.meta.env.VITE_API_URL ?? '/api';
const SESSION_KEY   = (userId) => `chatbot_msgs_${userId}`;
const DISCLAIMER    = 'chatbot_disclaimer_shown';
const MAX_LOCAL_MSG = 60;

const QUICK_REPLIES = [
  { label: '📅 Book Appointment',   text: 'I would like to book an appointment' },
  { label: '🗓️ My Schedule',        text: 'Show me my upcoming appointments' },
  { label: '💊 My Prescriptions',   text: 'Show me my recent prescriptions' },
  { label: '📞 Contact Reception',  text: 'I need to speak with a receptionist' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadMessages(userId) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(userId, messages) {
  try {
    sessionStorage.setItem(
      SESSION_KEY(userId),
      JSON.stringify(messages.slice(-MAX_LOCAL_MSG))
    );
  } catch { /* storage full — ignore */ }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeStyle: 'short' });
}

// Render markdown-lite: **bold**, bullet lists, line breaks
function renderText(text) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Bold
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
    return <span key={i}>{parts}{i < lines.length - 1 && <br />}</span>;
  });
}

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------
function TypingIndicator() {
  return (
    <div className={`${styles.bubble} ${styles.bot}`} aria-label="Assistant is typing">
      <span className={styles.typingDots}>
        <span /><span /><span />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disclaimer banner
// ---------------------------------------------------------------------------
function Disclaimer({ onAccept }) {
  return (
    <div className={styles.disclaimer} role="note">
      <div className={styles.disclaimerIcon}>⚕️</div>
      <div className={styles.disclaimerText}>
        <strong>Medical Disclaimer</strong>
        <p>
          This assistant provides general information only and is{' '}
          <strong>not a substitute for professional medical advice</strong>.
          Always consult a qualified healthcare provider for medical concerns.
        </p>
      </div>
      <button className={styles.disclaimerBtn} onClick={onAccept}>
        I understand
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Chatbot component
// ---------------------------------------------------------------------------
export default function Chatbot({ currentUser }) {
  const userId = currentUser?.id;

  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState(() => loadMessages(userId));
  const [input, setInput]         = useState('');
  const [typing, setTyping]       = useState(false);
  const [error, setError]         = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  // Show disclaimer on first open
  useEffect(() => {
    if (open && !sessionStorage.getItem(DISCLAIMER)) {
      setShowDisclaimer(true);
    }
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Focus input when opened
  useEffect(() => {
    if (open && !showDisclaimer) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, showDisclaimer]);

  // Persist messages to sessionStorage
  useEffect(() => {
    if (userId) saveMessages(userId, messages);
  }, [messages, userId]);

  // Load history from server on first open (merge with local)
  useEffect(() => {
    if (!open || !userId || messages.length > 0) return;

    fetch(`${API_BASE}/chatbot/history`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => {
        const history = json.data ?? [];
        if (!history.length) return;
        const hydrated = history.map((m, i) => ({
          id       : `hist-${i}`,
          role     : m.role,
          text     : m.content,
          timestamp: new Date().toISOString(),
        }));
        setMessages(hydrated);
      })
      .catch(console.error);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text, timestamp: new Date().toISOString() },
    ]);
  }, []);

  async function sendMessage(text) {
    if (!text.trim() || typing) return;

    setError('');
    addMessage('user', text);
    setInput('');
    setTyping(true);

    try {
      const res  = await fetch(`${API_BASE}/chatbot/message`, {
        method : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({ message: text }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          addMessage('assistant', '⏳ You\'ve reached the message limit (20/hour). Please try again later.');
        } else {
          addMessage('assistant', json.error ?? 'Something went wrong. Please try again.');
        }
        return;
      }

      addMessage('assistant', json.data.reply);
    } catch {
      addMessage('assistant', 'I\'m having trouble connecting right now. Please try again in a moment.');
    } finally {
      setTyping(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleQuickReply(text) {
    sendMessage(text);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Floating trigger button */}
      <button
        className={`${styles.fab} ${open ? styles.fabOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close chat assistant' : 'Open chat assistant'}
        aria-expanded={open}
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat window */}
      {open && (
        <div
          className={styles.window}
          role="dialog"
          aria-label="HMS Chat Assistant"
          aria-modal="false"
        >
          {/* Header */}
          <div className={styles.header}>
            <div className={styles.headerAvatar} aria-hidden="true">🏥</div>
            <div className={styles.headerInfo}>
              <div className={styles.headerName}>HMS Assistant</div>
              <div className={styles.headerStatus}>
                <span className={styles.onlineDot} aria-hidden="true" />
                Online
              </div>
            </div>
            <button
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>

          {/* Disclaimer */}
          {showDisclaimer && (
            <Disclaimer
              onAccept={() => {
                sessionStorage.setItem(DISCLAIMER, '1');
                setShowDisclaimer(false);
                inputRef.current?.focus();
              }}
            />
          )}

          {/* Messages */}
          <div className={styles.messages} aria-live="polite" aria-label="Chat messages">
            {!hasMessages && !showDisclaimer && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>👋</div>
                <p>Hi {currentUser?.firstName ?? 'there'}! How can I help you today?</p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.botRow}`}
              >
                {msg.role === 'assistant' && (
                  <div className={styles.botAvatar} aria-hidden="true">🏥</div>
                )}
                <div className={styles.messageGroup}>
                  <div
                    className={`${styles.bubble} ${msg.role === 'user' ? styles.user : styles.bot}`}
                  >
                    {renderText(msg.text)}
                  </div>
                  <div className={styles.timestamp}>{formatTime(msg.timestamp)}</div>
                </div>
              </div>
            ))}

            {typing && (
              <div className={`${styles.messageRow} ${styles.botRow}`}>
                <div className={styles.botAvatar} aria-hidden="true">🏥</div>
                <TypingIndicator />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick replies — show when no messages or after bot reply */}
          {!typing && !showDisclaimer && (
            <div className={styles.quickReplies} role="group" aria-label="Quick replies">
              {QUICK_REPLIES.map((qr) => (
                <button
                  key={qr.text}
                  className={styles.chip}
                  onClick={() => handleQuickReply(qr.text)}
                  disabled={typing}
                >
                  {qr.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form className={styles.inputArea} onSubmit={handleSubmit} noValidate>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              maxLength={1000}
              disabled={typing || showDisclaimer}
              aria-label="Message input"
            />
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={!input.trim() || typing || showDisclaimer}
              aria-label="Send message"
            >
              ➤
            </button>
          </form>

          <div className={styles.footer}>
            Powered by AI · Not a substitute for medical advice
          </div>
        </div>
      )}
    </>
  );
}
