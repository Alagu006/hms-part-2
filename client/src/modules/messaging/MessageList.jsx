import { useState, useEffect, useRef, useCallback } from 'react';
import { VariableSizeList as VList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { decryptMessage } from '../../shared/utils/crypto.js';
import styles from './MessageList.module.scss';

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
function MessageBubble({ msg, currentUserId, groupKey, onContextMenu, onReact, hovered, onHover }) {
  const [plaintext, setPlaintext] = useState(null);
  const [decryptErr, setDecryptErr] = useState(false);

  useEffect(() => {
    if (msg.is_deleted) { setPlaintext(null); return; }
    if (!groupKey || !msg.content || !msg.encryption_iv) return;

    decryptMessage(msg.content, msg.encryption_iv, groupKey)
      .then(setPlaintext)
      .catch(() => setDecryptErr(true));
  }, [msg.content, msg.encryption_iv, msg.is_deleted, groupKey]);

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
          <span className={styles.decryptError}>⚠ Could not decrypt</span>
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
  const listRef  = useRef(null);
  const sizeMap  = useRef({});

  // Scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current && messages.length) {
      listRef.current.scrollToItem(messages.length - 1, 'end');
    }
  }, [messages.length]);

  const getSize = useCallback((index) => sizeMap.current[index] ?? 72, []);

  function setSize(index, size) {
    if (sizeMap.current[index] !== size) {
      sizeMap.current[index] = size;
      listRef.current?.resetAfterIndex(index);
    }
  }

  function handleReact(messageId, emoji) {
    socket?.emit('message:react', { messageId, groupId, emoji });
  }

  function handleDelete(messageId) {
    socket?.emit('message:delete', { messageId, groupId });
  }

  function handleHover(messageId, isHovered) {
    setHoveredId(isHovered ? messageId : null);
  }

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

      <AutoSizer>
        {({ height, width }) => (
          <VList
            ref={listRef}
            height={pinnedMessages?.length ? height - 40 : height}
            width={width}
            itemCount={messages.length}
            itemSize={getSize}
            className={styles.listOuter}
          >
            {({ index, style }) => {
              const msg = messages[index];
              return (
                <div style={style} className={styles.row}>
                  <MeasuredBubble
                    msg={msg}
                    currentUserId={currentUserId}
                    groupKey={groupKey}
                    onContextMenu={(data) => setContextMenu(data)}
                    onReact={handleReact}
                    hovered={hoveredId === msg.id}
                    onHover={handleHover}
                    onSize={(h) => setSize(index, h + 8)}
                  />
                </div>
              );
            }}
          </VList>
        )}
      </AutoSizer>

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

// Wrapper to measure rendered height for VariableSizeList
function MeasuredBubble({ onSize, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) onSize(ref.current.getBoundingClientRect().height);
  });
  return (
    <div ref={ref}>
      <MessageBubble {...props} />
    </div>
  );
}
