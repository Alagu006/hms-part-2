import { useState, useEffect, useRef, useCallback } from 'react';
import { io }       from 'socket.io-client';
import { apiFetch } from '../../shared/utils/authHeaders.js';
import { importKey } from '../../shared/utils/crypto.js';
import { useAuth }  from '../../shared/store/index.js';
import { getSocketUrl } from '../../shared/utils/socketUrl.js';
import GroupList    from './GroupList.jsx';
import MessageList  from './MessageList.jsx';
import MessageInput from './MessageInput.jsx';
import styles       from './MessagingLayout.module.scss';

const API_BASE   = import.meta.env.VITE_API_URL ?? '/api';
const SOCKET_URL = getSocketUrl();

async function getGroupKey(groupId) {
  const store = JSON.parse(sessionStorage.getItem('groupKeys') ?? '{}');
  if (store[groupId] && store[groupId].length === 44) return importKey(store[groupId]);
  const res = await apiFetch(`${API_BASE}/messaging/groups/${groupId}/key`);
  if (!res?.key) throw new Error('Failed to fetch group key');
  store[groupId] = res.key;
  sessionStorage.setItem('groupKeys', JSON.stringify(store));
  return importKey(res.key);
}

function initials(name = '?') {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

// ---------------------------------------------------------------------------
// Chat header
// ---------------------------------------------------------------------------
function ChatHeader({ group, members, showMembers, onToggleMembers, onBack }) {
  if (!group) return null;
  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} aria-label="Back to conversations"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#6b7280', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
          ‹
        </button>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#111827' }}>{group.name ?? 'Direct Message'}</div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
            {group.type === 'DIRECT' ? 'Direct Message' : `${group.type} · ${members.length} members`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {group.type !== 'DIRECT' && (
          <button onClick={onToggleMembers} style={{ background: showMembers ? '#eff6ff' : 'transparent', border: '1px solid #dbeafe', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', color: '#3b82f6', cursor: 'pointer' }}>
            👥 Members
          </button>
        )}
        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>🔒</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members panel with add member
// ---------------------------------------------------------------------------
function MembersPanel({ members, groupId, allUsers, onMemberAdded }) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const memberIds = new Set(members.map(m => m.id));
  const available = allUsers.filter(u =>
    !memberIds.has(u.id) &&
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase())
  );

  async function addMember(userId) {
    setSaving(true);
    try {
      await apiFetch(`${API_BASE}/messaging/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      onMemberAdded();
      setAdding(false);
      setSearch('');
    } catch (e) {
      console.error('Add member failed:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside style={{ width: 220, borderLeft: '1px solid #e5e7eb', background: '#fafafa', overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Members ({members.length})
        </span>
        <button onClick={() => setAdding(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#1a56db' }} title="Add member">
          ＋
        </button>
      </div>

      {adding && (
        <div style={{ padding: '0 10px 8px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff…"
            style={{ width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: '0.8rem', boxSizing: 'border-box' }} />
          <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 4 }}>
            {available.slice(0, 10).map(u => (
              <div key={u.id} onClick={() => !saving && addMember(u.id)}
                style={{ padding: '6px 8px', cursor: 'pointer', fontSize: '0.8rem', borderRadius: 4, color: '#111827' }}
                onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {u.first_name} {u.last_name}
              </div>
            ))}
            {available.length === 0 && <div style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '6px 8px' }}>No staff found</div>}
          </div>
        </div>
      )}

      {members.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 }}>
            {initials(`${m.first_name} ${m.last_name}`)}
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: '#111827', fontWeight: 500 }}>{m.first_name} {m.last_name}</div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{Array.isArray(m.roles) ? m.roles[0] : m.role}</div>
          </div>
        </div>
      ))}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// User picker for starting a new DM
// ---------------------------------------------------------------------------
function UserPicker({ users, search, onSelect }) {
  const filtered = users.filter(u =>
    !search || `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase())
  );

  if (!filtered.length) {
    return <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>No staff found.</div>;
  }

  return (
    <div>
      {filtered.map(u => (
        <div key={u.id} onClick={() => onSelect(u)} role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onSelect(u)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 600, flexShrink: 0 }}>
            {initials(`${u.first_name} ${u.last_name}`)}
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 500 }}>{u.first_name} {u.last_name}</div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{u.department_name ?? (Array.isArray(u.roles) ? u.roles[0] : '')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------
export default function MessagingLayout() {
  const { user: currentUser } = useAuth();
  const [groups, setGroups]             = useState([]);
  const [allUsers, setAllUsers]         = useState([]);
  const [activeGroup, setActiveGroup]   = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [showMembers, setShowMembers]   = useState(false);
  const [messages, setMessages]         = useState([]);
  const [groupKey, setGroupKey]         = useState(null);
  const [pinnedMsgs, setPinnedMsgs]     = useState([]);
  const [typingUsers, setTypingUsers]   = useState({});
  const [replyTo, setReplyTo]           = useState(null);
  const [sidebarTab, setSidebarTab]     = useState('groups');
  const [search, setSearch]             = useState('');
  const [page, setPage]                 = useState(1);
  const [hasMore, setHasMore]           = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const socketRef = useRef(null);
  const activeGroupRef = useRef(null);

  // Keep ref in sync so socket closures always see current group
  useEffect(() => { activeGroupRef.current = activeGroup; }, [activeGroup]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;

    const socket = io(`${SOCKET_URL}/messaging`, {
      auth: { token }, transports: ['websocket'], reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('[socket] Connected'));
    socket.on('connect_error', e => console.error('[socket] Error:', e.message));

    socket.on('message:new', ({ message }) => {
      // Normalise field name — socket sends senderName, history sends sender_name
      const normalised = {
        ...message,
        sender_name: message.sender_name ?? message.senderName,
      };
      setMessages(prev => {
        // Only append if this message belongs to the currently open group
        if (normalised.group_id !== activeGroupRef.current?.id) return prev;
        if (prev.find(m => m.id === normalised.id)) return prev;
        return [...prev, normalised];
      });
      socket.emit('message:delivered', { messageId: message.id, groupId: message.group_id });
      // Update group list preview + unread count
      setGroups(prev => prev.map(g =>
        g.id === message.group_id
          ? { ...g, last_msg_content: message.content, last_msg_at: message.sent_at,
              unread_count: g.id === activeGroupRef.current?.id ? 0 : (g.unread_count ?? 0) + 1 }
          : g
      ));
    });
    socket.on('message:delivered', ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId && m.status === 'sent' ? { ...m, status: 'delivered' } : m));
    });
    socket.on('message:read', ({ lastReadMessageId, userId }) => {
      if (userId === currentUser?.id) return;
      setMessages(prev => prev.map(m =>
        m.sender_id === currentUser?.id && m.sent_at <= lastReadMessageId ? { ...m, status: 'read' } : m
      ));
    });
    socket.on('message:deleted', ({ messageId }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted: true, content: '', encryption_iv: '' } : m));
    });
    socket.on('message:reactions', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    });
    socket.on('typing:start', ({ userId, firstName, groupId }) => {
      setTypingUsers(prev => ({ ...prev, [userId]: { userId, firstName, groupId } }));
    });
    socket.on('typing:stop', ({ userId }) => {
      setTypingUsers(prev => { const n = { ...prev }; delete n[userId]; return n; });
    });

    return () => socket.disconnect();
  }, [currentUser?.id]);

  useEffect(() => {
    apiFetch(`${API_BASE}/messaging/groups`).then(json => setGroups(json?.data ?? [])).catch(console.error);
    apiFetch(`${API_BASE}/messaging/users`).then(json => setAllUsers(json?.data ?? [])).catch(console.error);
  }, []);

  const selectGroup = useCallback(async (group) => {
    setActiveGroup(group);
    setMessages([]);
    setGroupKey(null);
    setPage(1);
    setHasMore(true);
    setReplyTo(null);
    setShowMembers(false);
    setMobileChatOpen(true);

    try {
      const key = await getGroupKey(group.id);
      setGroupKey(key);
    } catch (err) {
      console.error('[selectGroup] Failed to load group key:', err);
    }

    apiFetch(`${API_BASE}/messaging/groups/${group.id}/pinned`).then(json => setPinnedMsgs(json?.data ?? [])).catch(console.error);
    apiFetch(`${API_BASE}/messaging/groups/${group.id}/members`).then(json => setGroupMembers(json?.data ?? [])).catch(console.error);

    socketRef.current?.emit('message:read', { groupId: group.id, lastReadMessageId: Date.now() });
    setGroups(prev => prev.map(g => g.id === group.id ? { ...g, unread_count: 0 } : g));
  }, []);

  const startDM = useCallback(async (targetUser) => {
    const existing = groups.find(g => g.type === 'DIRECT' && g.other_user_id === targetUser.id);
    if (existing) { selectGroup(existing); return; }
    try {
      await apiFetch(`${API_BASE}/messaging/direct/${targetUser.id}/history?page=1&limit=1`);
      const updated = await apiFetch(`${API_BASE}/messaging/groups`);
      const newGroups = updated?.data ?? [];
      setGroups(newGroups);
      const dmGroup = newGroups.find(g => g.type === 'DIRECT');
      if (dmGroup) selectGroup(dmGroup);
    } catch (err) {
      console.error('Failed to start DM:', err);
    }
  }, [groups, selectGroup]);

  useEffect(() => {
    if (!activeGroup || !hasMore || loadingHistory) return;
    setLoadingHistory(true);
    apiFetch(`${API_BASE}/messaging/groups/${activeGroup.id}/history?page=${page}&limit=50`)
      .then(json => {
        const incoming = json?.messages ?? [];
        setMessages(prev => page === 1 ? incoming : [...incoming, ...prev]);
        setHasMore(incoming.length === 50);
      })
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [activeGroup, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGroups = groups.filter(g => !search || (g.name ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${mobileChatOpen ? styles.hidden : ''}`} aria-label="Conversations">
        <div className={styles.sidebarHeader}>
          <h2>Messages</h2>
          <input className={styles.searchInput} placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)} aria-label="Search conversations" />
        </div>

        <div className={styles.sidebarTabs} role="tablist">
          <button role="tab" aria-selected={sidebarTab === 'groups'}
            className={`${styles.sidebarTab} ${sidebarTab === 'groups' ? styles.active : ''}`}
            onClick={() => setSidebarTab('groups')}>Groups</button>
          <button role="tab" aria-selected={sidebarTab === 'dms'}
            className={`${styles.sidebarTab} ${sidebarTab === 'dms' ? styles.active : ''}`}
            onClick={() => setSidebarTab('dms')}>Direct</button>
        </div>

        <div className={styles.sidebarList}>
          {sidebarTab === 'dms' ? (
            <>
              <GroupList groups={filteredGroups.filter(g => g.type === 'DIRECT')} activeGroupId={activeGroup?.id} onSelect={selectGroup} isDM />
              <div style={{ padding: '8px 16px 4px', fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid #f3f4f6', marginTop: 4 }}>
                All Staff
              </div>
              <UserPicker users={allUsers} search={search} onSelect={startDM} />
            </>
          ) : (
            <GroupList groups={filteredGroups.filter(g => g.type !== 'DIRECT')} activeGroupId={activeGroup?.id} onSelect={selectGroup} isDM={false} />
          )}
        </div>
      </aside>

      <main className={styles.chatArea} aria-label="Chat" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {!activeGroup ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>💬</div>
            <p>Select a conversation to start messaging</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <ChatHeader group={activeGroup} members={groupMembers} showMembers={showMembers} onToggleMembers={() => setShowMembers(v => !v)} onBack={() => setMobileChatOpen(false)} />
              <MessageList messages={messages} currentUserId={currentUser?.id} groupKey={groupKey}
                pinnedMessages={pinnedMsgs} typingUsers={typingUsers} socket={socketRef.current}
                groupId={activeGroup.id} onReply={setReplyTo} />
              <MessageInput socket={socketRef.current} groupId={activeGroup.id} groupKey={groupKey}
                replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
            </div>
            {showMembers && activeGroup.type !== 'DIRECT' && (
              <MembersPanel members={groupMembers} groupId={activeGroup.id} allUsers={allUsers}
                onMemberAdded={() => {
                  apiFetch(`${API_BASE}/messaging/groups/${activeGroup.id}/members`)
                    .then(json => setGroupMembers(json?.data ?? []))
                    .catch(console.error);
                }} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
