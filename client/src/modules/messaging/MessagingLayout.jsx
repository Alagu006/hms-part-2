import { useState, useEffect, useRef, useCallback } from 'react';
import { io }            from 'socket.io-client';
import { generateKey, importKey, exportKey } from '../../shared/utils/crypto.js';
import GroupList         from './GroupList.jsx';
import MessageList       from './MessageList.jsx';
import MessageInput      from './MessageInput.jsx';
import styles            from './MessagingLayout.module.scss';

const API_BASE    = import.meta.env.VITE_API_URL    ?? '/api';
const SOCKET_URL  = import.meta.env.VITE_SOCKET_URL ?? '';

// ---------------------------------------------------------------------------
// Group key management — per-group AES-256-GCM key stored in sessionStorage
// ---------------------------------------------------------------------------
async function getOrCreateGroupKey(groupId) {
  const store = JSON.parse(sessionStorage.getItem('groupKeys') ?? '{}');
  if (store[groupId]) {
    return importKey(store[groupId]);
  }
  // New key for this group in this session
  const key    = await generateKey();
  const keyB64 = await exportKey(key);
  store[groupId] = keyB64;
  sessionStorage.setItem('groupKeys', JSON.stringify(store));
  return key;
}

// ---------------------------------------------------------------------------
// Chat header
// ---------------------------------------------------------------------------
function ChatHeader({ group, onlineCount }) {
  if (!group) return null;
  return (
    <div style={{
      padding: '14px 20px',
      borderBottom: '1px solid #e5e7eb',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#111827' }}>
          {group.name ?? 'Direct Message'}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
          {group.type === 'DIRECT' ? (onlineCount ? '🟢 Online' : '⚫ Offline') : `${group.type}`}
        </div>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>🔒 Encrypted</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------
export default function MessagingLayout({ currentUser }) {
  const [groups, setGroups]           = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages]       = useState([]);
  const [groupKey, setGroupKey]       = useState(null);
  const [pinnedMsgs, setPinnedMsgs]   = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [replyTo, setReplyTo]         = useState(null);
  const [sidebarTab, setSidebarTab]   = useState('groups');
  const [search, setSearch]           = useState('');
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const socketRef = useRef(null);

  // ── Socket.io connection ──────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(`${SOCKET_URL}/messaging`, {
      auth             : { token: sessionStorage.getItem('accessToken') },
      transports       : ['websocket'],
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect',       () => console.log('[socket] Connected'));
    socket.on('connect_error', (e) => console.error('[socket] Error:', e.message));

    // New message
    socket.on('message:new', ({ message }) => {
      setMessages((prev) => {
        if (prev.find((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      // Emit delivered
      socket.emit('message:delivered', {
        messageId: message.id,
        groupId  : message.group_id,
      });
    });

    // Delivered / read receipts
    socket.on('message:delivered', ({ messageId }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId && m.status === 'sent'
          ? { ...m, status: 'delivered' } : m)
      );
    });

    socket.on('message:read', ({ lastReadMessageId, userId }) => {
      if (userId === currentUser.id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_id === currentUser.id && m.sent_at <= lastReadMessageId
            ? { ...m, status: 'read' } : m
        )
      );
    });

    // Deleted
    socket.on('message:deleted', ({ messageId }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId
          ? { ...m, is_deleted: true, content: '', encryption_iv: '' } : m)
      );
    });

    // Reactions
    socket.on('message:reactions', ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, reactions } : m)
      );
    });

    // Typing
    socket.on('typing:start', ({ userId, firstName, groupId }) => {
      setTypingUsers((prev) => ({ ...prev, [userId]: { userId, firstName, groupId } }));
    });
    socket.on('typing:stop', ({ userId }) => {
      setTypingUsers((prev) => { const n = { ...prev }; delete n[userId]; return n; });
    });

    return () => socket.disconnect();
  }, [currentUser.id]);

  // ── Load groups ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/messages/groups`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => setGroups(json.data ?? []))
      .catch(console.error);
  }, []);

  // ── Select group ──────────────────────────────────────────────────────────
  const selectGroup = useCallback(async (group) => {
    setActiveGroup(group);
    setMessages([]);
    setPage(1);
    setHasMore(true);
    setReplyTo(null);

    // Load/create group encryption key
    const key = await getOrCreateGroupKey(group.id);
    setGroupKey(key);

    // Load pinned messages
    fetch(`${API_BASE}/messages/groups/${group.id}/pinned`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => setPinnedMsgs(json.data ?? []))
      .catch(console.error);

    // Emit read
    socketRef.current?.emit('message:read', {
      groupId          : group.id,
      lastReadMessageId: Date.now(),
    });

    // Update unread count locally
    setGroups((prev) =>
      prev.map((g) => g.id === group.id ? { ...g, unread_count: 0 } : g)
    );
  }, []);

  // ── Load history ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeGroup || !hasMore || loadingHistory) return;

    setLoadingHistory(true);
    fetch(`${API_BASE}/messages/groups/${activeGroup.id}/history?page=${page}&limit=50`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
    })
      .then((r) => r.json())
      .then((json) => {
        const incoming = json.messages ?? [];
        setMessages((prev) => (page === 1 ? incoming : [...incoming, ...prev]));
        setHasMore(incoming.length === 50);
      })
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [activeGroup, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGroups = groups.filter((g) =>
    !search || (g.name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar} aria-label="Conversations">
        <div className={styles.sidebarHeader}>
          <h2>Messages</h2>
          <input
            className={styles.searchInput}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search conversations"
          />
        </div>

        <div className={styles.sidebarTabs} role="tablist">
          <button
            role="tab" aria-selected={sidebarTab === 'groups'}
            className={`${styles.sidebarTab} ${sidebarTab === 'groups' ? styles.active : ''}`}
            onClick={() => setSidebarTab('groups')}
          >
            Groups
          </button>
          <button
            role="tab" aria-selected={sidebarTab === 'dms'}
            className={`${styles.sidebarTab} ${sidebarTab === 'dms' ? styles.active : ''}`}
            onClick={() => setSidebarTab('dms')}
          >
            Direct
          </button>
        </div>

        <div className={styles.sidebarList}>
          <GroupList
            groups={filteredGroups.filter((g) =>
              sidebarTab === 'groups' ? g.type !== 'DIRECT' : g.type === 'DIRECT'
            )}
            activeGroupId={activeGroup?.id}
            onSelect={selectGroup}
            isDM={sidebarTab === 'dms'}
          />
        </div>
      </aside>

      {/* Chat area */}
      <main className={styles.chatArea} aria-label="Chat">
        {!activeGroup ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>💬</div>
            <p>Select a conversation to start messaging</p>
          </div>
        ) : (
          <>
            <ChatHeader group={activeGroup} />

            <MessageList
              messages={messages}
              currentUserId={currentUser.id}
              groupKey={groupKey}
              pinnedMessages={pinnedMsgs}
              typingUsers={typingUsers}
              socket={socketRef.current}
              groupId={activeGroup.id}
              onReply={setReplyTo}
            />

            <MessageInput
              socket={socketRef.current}
              groupId={activeGroup.id}
              groupKey={groupKey}
              replyTo={replyTo}
              onClearReply={() => setReplyTo(null)}
            />
          </>
        )}
      </main>
    </div>
  );
}
