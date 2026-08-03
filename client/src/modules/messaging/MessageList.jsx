import { useState, useEffect, useRef } from 'react';
import { decryptMessage } from '../../shared/utils/crypto.js';
import styles from './MessageList.module.scss';

// How long to wait before retrying decryption when the key isn't ready yet
const DECRYPT_RETRY_DELAY_MS = 1500;

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮'];

function formatTime(iso) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function TickStatus({ status }) {
  if (status === 'read')      return <span className={`${styles.ticks} ${styles.read}`}   aria-label="Read">✓✓</span>;
  if (status === 'delivered') return <span className={`${styles.ticks} ${styles.delivered}`} aria-label="Delivered">✓✓</span>;
  return <span className={styles.ticks} aria-label="Sent">✓</span>;
}

// ---------------------------------------------------------------------------
// Single message bubble
// ---------------------------------------------------------------------------
function MessageBubble({ msg, currentUserId, groupKey, onContextMenu, onReact, hovered, onHover, onDecryptFailed }) {
  const [plaintext, setPlaintext] = useState(null);
  const [decryptErr, setDecryptErr] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (msg.is_deleted) { setPlaintext(null); return; }
    if (!groupKey || !msg.content || !msg.encryption_iv) return;

    // Reset error state when key changes (new key loaded)
    setDecryptErr(false);
    setPlaintext(null);

    decryptMessage(msg.content, msg.encryption_iv, groupKey)
      .then(setPlaintext)
      .catch((err) => {
        console.warn(`[MessageBubble] Decryption failed for message ${msg.id}:`, err.message);
        
        // Retry once after a delay (in case key wasn't fully loaded)
        if (retryCount === 0) {
          setTimeout(() => {
            setRetryCount(1);
            decryptMessage(msg.content, msg.encryption_iv, groupKey)
              .then(setPlaintext)
              .catch(() => {
                setDecryptErr(true);
                // Notify parent to handle cleanup
                onDecryptFailed?.(msg.id);
              });
          }, DECRYPT_RETRY_DELAY_MS);
        } else {
          setDecryptErr(true);
          onDecryptFailed?.(msg.id);
        }
      });
  }, [msg.content, msg.encryption_iv, msg.is_deleted, groupKey, msg.id, retryCount, onDecryptFailed]);

  const isMine = msg.sender_id === currentUserId;

  function handleContextMenu(e) {
    e.preventDefault();
    onContextMenu({ x: e.clientX, y: e.clientY, msg });
  }

  return (
    <div
      className={`${styles.bubble} ${isMine ? styles.mine : styles.theirs}`}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => onHover(msg.id, true)}
      onMouseLeave={() => onHover(msg.id, false)}
    >
      {!isMine && <div className={styles.senderName}>{msg.sender_name}</div>}

      <div className={`${styles.bubbleInner} ${msg.is_deleted ? styles.deleted : ''}`}>
        {msg.reply_to_id && (
          <div className={styles.replyBar}>Replying to a message</div>
        )}

        {msg.is_deleted ? (
          <em>This message was deleted</em>
        ) : decryptErr ? (
          <span className={styles.unavailable}>
            <em style={{ fontSize: '0.85em', color: '#9ca3af' }}>Message unavailable</em>
          </span>
        ) : plaintext === null ? (
          <span style={{ opacity: 0.4 }}>…</span>
        ) : (
          plaintext
        )}
      </div>

      <div className={styles.bubbleMeta}>
        <span className={styles.time}>{formatTime(msg.sent_at)}</span>
        {isMine && <TickStatus status={msg.status ?? 'sent'} />}
      </div>

      {/* Inline emoji picker — shown on hover */}
      {hovered && (
        <div className={styles.inlineReactions} role="group" aria-label="React">
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              className={styles.inlineEmojiBtn}
              onClick={() => onReact(msg.id, e)}
              aria-label={`React with ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {msg.reactions?.length > 0 && (
        <div className={styles.reactions}>
          {Object.entries(
            msg.reactions.reduce((acc, r) => {
              acc[r.emoji] = (acc[r.emoji] ?? []);
              acc[r.emoji].push(r.userId);
              return acc;
            }, {})
          ).map(([emoji, users]) => (
            <button
              key={emoji}
              className={`${styles.reactionPill} ${users.includes(currentUserId) ? styles.mine : ''}`}
              onClick={() => onReact(msg.id, emoji)}
              aria-label={`${emoji} ${users.length}`}
            >
              {emoji} <span>{users.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function ContextMenu({ pos, msg, currentUserId, onClose, onReply, onReact, onDelete }) {
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const canDelete = msg.sender_id === currentUserId;
  const ageMs     = Date.now() - new Date(msg.sent_at).getTime();
  const canDeleteForAll = canDelete && ageMs <= 5 * 60 * 1000;

  return (
    <div
      ref={ref}
      className={styles.contextMenu}
      style={{ top: pos.y, left: pos.x }}
      role="menu"
    >
      <div className={styles.reactions} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>
        {REACTION_EMOJIS.map((e) => (
          <button
            key={e}
            className={styles.emojiOption}
            onClick={() => { onReact(msg.id, e); onClose(); }}
            aria-label={`React with ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className={styles.contextItem} role="menuitem" onClick={() => { onReply(msg); onClose(); }}>
        ↩ Reply
      </div>
      {canDelete && (
        <div
          className={`${styles.contextItem} ${styles.danger}`}
          role="menuitem"
          onClick={() => { onDelete(msg.id, canDeleteForAll); onClose(); }}
        >
          🗑 {canDeleteForAll ? 'Delete for everyone' : 'Delete for me'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main MessageList
// ---------------------------------------------------------------------------
export default function MessageList({
  messages,
  currentUserId,
  groupKey,
  pinnedMessages,
  typingUsers,
  socket,
  groupId,
  onReply,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [failedMessageIds, setFailedMessageIds] = useState(new Set());
  const listRef  = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  function handleReact(messageId, emoji) {
    socket?.emit('message:react', { messageId, groupId, emoji });
  }

  function handleDelete(messageId) {
    socket?.emit('message:delete', { messageId, groupId });
  }

  function handleHover(messageId, isHovered) {
    setHoveredId(isHovered ? messageId : null);
  }

  function handleDecryptFailed(messageId) {
    setFailedMessageIds(prev => new Set(prev).add(messageId));
    
    // Auto-delete own messages that failed to decrypt (they're corrupted/unrecoverable)
    const msg = messages.find(m => m.id === messageId);
    if (msg && msg.sender_id === currentUserId) {
      console.log(`[MessageList] Auto-deleting own undecryptable message ${messageId}`);
      handleDelete(messageId);
    }
  }

  // Filter out messages that have persistently failed decryption
  const visibleMessages = messages.filter(msg => {
    // Show deleted messages (they display as "This message was deleted")
    if (msg.is_deleted) return true;
    // Hide messages that failed decryption and belong to others (can't delete them)
    if (failedMessageIds.has(msg.id) && msg.sender_id !== currentUserId) return false;
    return true;
  });

  const typingNames = Object.values(typingUsers ?? {})
    .filter((u) => u.userId !== currentUserId)
    .map((u) => u.firstName);

  return (
    <div className={styles.wrapper}>
      {/* Pinned messages bar */}
      {pinnedMessages?.length > 0 && (
        <div className={styles.pinnedBar} aria-label="Pinned message">
          <span className={styles.pinnedIcon}>📌</span>
          <span className={styles.pinnedText}>🔒 Encrypted pinned message</span>
        </div>
      )}

      <div ref={listRef} className={styles.listOuter}>
        {visibleMessages.map((msg, index) => (
          <div key={msg.id} className={styles.row}>
            <MessageBubble
              msg={msg}
              currentUserId={currentUserId}
              groupKey={groupKey}
              onContextMenu={(data) => setContextMenu(data)}
              onReact={handleReact}
              hovered={hoveredId === msg.id}
              onHover={handleHover}
              onDecryptFailed={handleDecryptFailed}
            />
          </div>
        ))}
      </div>

      {/* Typing indicator */}
      <div className={styles.typingIndicator} aria-live="polite">
        {typingNames.length > 0 && `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          pos={{ x: contextMenu.x, y: contextMenu.y }}
          msg={contextMenu.msg}
          currentUserId={currentUserId}
          onClose={() => setContextMenu(null)}
          onReply={(msg) => { onReply?.(msg); }}
          onReact={handleReact}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

