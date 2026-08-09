import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../shared/utils/api.js';
import { useStore } from '../../shared/store/index.js';
import styles from './Chatbot.module.scss';

const SESSION_KEY   = (userId) => `chatbot_msgs_${userId}`;
const DISCLAIMER    = 'chatbot_disclaimer_shown';
const MAX_LOCAL_MSG = 60;

const QUICK_REPLIES = [
  { label: '📅 Book Appointment',  text: 'I would like to book an appointment' },
  { label: '🗓️ My Schedule',       text: 'Show me my upcoming appointments' },
  { label: '💊 My Prescriptions',  text: 'Show me my recent prescriptions' },
  { label: '📞 Contact Reception', text: 'I need to speak with a receptionist' },
];

function loadMessages(userId) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY(userId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMessages(userId, messages) {
  try {
    sessionStorage.setItem(SESSION_KEY(userId), JSON.stringify(messages.slice(-MAX_LOCAL_MSG)));
  } catch { /* storage full */ }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeStyle: 'short' });
}

function renderText(text) {
  return text.split('\n').map((line, i, arr) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={j}>{part.slice(2, -2)}</strong>
        : part
    );
    return <span key={i}>{parts}{i < arr.length - 1 && <br />}</span>;
  });
}

function TypingIndicator() {
  return (
    <div className={`${styles.bubble} ${styles.bot}`} aria-label="Assistant is typing">
      <span className={styles.typingDots}><span /><span /><span /></span>
    </div>
  );
}

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
      <button className={styles.disclaimerBtn} onClick={onAccept}>I understand</button>
    </div>
  );
}

export default function Chatbot() {
  const currentUser = useStore((s) => s.user);
  const userId = currentUser?.id;

  const [messages, setMessages]         = useState(() => loadMessages(userId));
  const [input, setInput]               = useState('');
  const [typing, setTyping]             = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(
    () => !sessionStorage.getItem(DISCLAIMER)
  );

  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!showDisclaimer) setTimeout(() => inputRef.current?.focus(), 100);
  }, [showDisclaimer]);

  useEffect(() => {
    if (userId) saveMessages(userId, messages);
  }, [messages, userId]);

  // Load history from server on mount
  useEffect(() => {
    if (!userId || messages.length > 0) return;
    apiFetch(`/chatbot/history`)
      .then((data) => {
        const history = data?.data ?? [];
        if (!history.length) return;
        setMessages(history.map((m, i) => ({
          id: `hist-${i}`, role: m.role, text: m.content,
          timestamp: new Date().toISOString(),
        })));
      })
      .catch(() => {});
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text, timestamp: new Date().toISOString() },
    ]);
  }, []);

  async function sendMessage(text) {
    if (!text.trim() || typing) return;
    addMessage('user', text);
    setInput('');
    setTyping(true);
    try {
      const data = await apiFetch(`/chatbot/message`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      addMessage('assistant', data?.data?.reply ?? 'Something went wrong. Please try again.');
    } catch (err) {
      if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate')) {
        addMessage('assistant', '⏳ You\'ve reached the message limit (20/hour). Please try again later.');
      } else {
        addMessage('assistant', 'I\'m having trouble connecting right now. Please try again in a moment.');
      }
    } finally {
      setTyping(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  return (
    <div className={styles.page}>
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
      </div>

      {/* Disclaimer */}
      {showDisclaimer && (
        <Disclaimer onAccept={() => {
          sessionStorage.setItem(DISCLAIMER, '1');
          setShowDisclaimer(false);
        }} />
      )}

      {/* Messages */}
      <div className={styles.messages} aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && !showDisclaimer && (
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
              <div className={`${styles.bubble} ${msg.role === 'user' ? styles.user : styles.bot}`}>
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

      {/* Quick replies */}
      {!typing && !showDisclaimer && (
        <div className={styles.quickReplies} role="group" aria-label="Quick replies">
          {QUICK_REPLIES.map((qr) => (
            <button key={qr.text} className={styles.chip} onClick={() => sendMessage(qr.text)} disabled={typing}>
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
  );
}
