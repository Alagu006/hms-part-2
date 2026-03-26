import { useState, useRef, useEffect, useCallback } from 'react';
import { encryptMessage } from '../../shared/utils/crypto.js';
import styles from './MessageInput.module.scss';

const COMMON_EMOJIS = ['😊','👍','❤️','😂','🙏','👋','✅','⚠️','🔔','📋'];
const TYPING_DEBOUNCE_MS = 1500;

export default function MessageInput({ socket, groupId, groupKey, replyTo, onClearReply }) {
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const textareaRef = useRef(null);
  const typingTimer = useRef(null);
  const isTyping    = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Focus on reply
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const stopTyping = useCallback(() => {
    if (isTyping.current) {
      isTyping.current = false;
      socket?.emit('typing:stop', { groupId });
    }
  }, [socket, groupId]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleChange(e) {
    setText(e.target.value);

    // Typing indicator
    if (!isTyping.current && e.target.value.trim()) {
      isTyping.current = true;
      socket?.emit('typing:start', { groupId });
    }

    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_DEBOUNCE_MS);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending || !groupKey) return;

    setSending(true);
    stopTyping();

    try {
      // Encrypt before emitting — plaintext never leaves the browser unencrypted
      const { ciphertext, iv } = await encryptMessage(trimmed, groupKey);

      socket?.emit(
        'message:send',
        {
          groupId,
          content     : ciphertext,
          encryptionIv: iv,
          replyToId   : replyTo?.id ?? null,
        },
        (ack) => {
          if (ack?.error) console.error('[MessageInput] Send error:', ack.error);
        }
      );

      setText('');
      onClearReply?.();
    } catch (err) {
      console.error('[MessageInput] Encrypt/send error:', err);
    } finally {
      setSending(false);
    }
  }

  function insertEmoji(emoji) {
    setText((prev) => prev + emoji);
    setShowEmoji(false);
    textareaRef.current?.focus();
  }

  const canSend = text.trim().length > 0 && !sending && !!groupKey;

  return (
    <div className={styles.wrapper}>
      {replyTo && (
        <div className={styles.replyPreview}>
          <span className={styles.replyText}>
            ↩ Replying to {replyTo.sender_name}: 🔒 encrypted
          </span>
          <button
            className={styles.replyClose}
            onClick={onClearReply}
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      <div className={styles.inputRow}>
        <button
          className={styles.emojiBtn}
          onClick={() => setShowEmoji((v) => !v)}
          aria-label="Emoji picker"
          aria-expanded={showEmoji}
          type="button"
        >
          😊
        </button>

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={groupKey ? 'Type a message…' : 'Loading encryption key…'}
          disabled={!groupKey || sending}
          rows={1}
          aria-label="Message input"
          aria-multiline="true"
        />

        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          type="button"
        >
          ➤
        </button>
      </div>

      {showEmoji && (
        <div className={styles.emojiPicker} role="listbox" aria-label="Emoji options">
          {COMMON_EMOJIS.map((e) => (
            <button
              key={e}
              className={styles.emojiOption}
              onClick={() => insertEmoji(e)}
              aria-label={e}
              role="option"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {groupKey && (
        <div className={styles.encryptingHint}>🔒 End-to-end encrypted</div>
      )}
    </div>
  );
}
