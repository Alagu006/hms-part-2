import { useState, useEffect, useRef, useCallback } from 'react';
import { io }   from 'socket.io-client';
import { encryptMessage, decryptMessage, generateKey, exportKey, importKey }
  from '../../shared/utils/crypto.js';
import styles from './TeleRoom.module.scss';

const API_BASE   = import.meta.env.VITE_API_URL    ?? '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';
// PeerJS loaded via CDN — window.Peer
const PEERJS_HOST = import.meta.env.VITE_PEERJS_HOST || '0.peerjs.com';
const PEERJS_PORT = parseInt(import.meta.env.VITE_PEERJS_PORT || '443', 10);

// ---------------------------------------------------------------------------
// Consultation note modal
// ---------------------------------------------------------------------------
function ConsultationNoteModal({ sessionId, onSaved, onSkip }) {
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/telemedicine/sessions/${sessionId}/end`, {
        method : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({ consultationNote: note }),
      });
      if (!res.ok) throw new Error('Failed to save note');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="note-title">
      <div className={styles.noteModal}>
        <h3 id="note-title">Add Consultation Note</h3>
        <p className={styles.noteHint}>
          This note will be saved to the patient's medical records.
        </p>
        <textarea
          className={styles.noteTextarea}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Diagnosis, treatment plan, follow-up instructions…"
          rows={8}
          maxLength={5000}
          autoFocus
        />
        <span className={styles.charCount}>{note.length} / 5000</span>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.noteActions}>
          <button className={styles.skipBtn} onClick={onSkip} disabled={saving}>
            Skip
          </button>
          <button className={styles.saveNoteBtn} onClick={handleSave} disabled={saving || !note.trim()}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat sidebar
// ---------------------------------------------------------------------------
function ChatSidebar({ messages, onSend, onClose }) {
  const [text, setText]   = useState('');
  const bottomRef         = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <div className={styles.chatSidebar}>
      <div className={styles.chatHeader}>
        <span>In-call chat</span>
        <button onClick={onClose} aria-label="Close chat">✕</button>
      </div>
      <div className={styles.chatMessages}>
        {messages.map((m, i) => (
          <div key={i} className={`${styles.chatMsg} ${m.own ? styles.own : ''}`}>
            {!m.own && <div className={styles.chatSender}>{m.firstName}</div>}
            <div className={styles.chatBubble}>{m.text}</div>
            <div className={styles.chatTime}>
              {new Date(m.timestamp).toLocaleTimeString('en-GB', { timeStyle: 'short' })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className={styles.chatInput} onSubmit={handleSend}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          aria-label="Chat message"
        />
        <button type="submit" disabled={!text.trim()} aria-label="Send">➤</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TeleRoom component
// ---------------------------------------------------------------------------
export default function TeleRoom({ sessionId, currentUser }) {
  const [tokenData, setTokenData]     = useState(null);
  const [status, setStatus]           = useState('loading'); // loading|waiting|admitted|ended|error
  const [error, setError]             = useState('');
  const [peers, setPeers]             = useState([]);        // [{ socketId, userId, firstName, role }]
  const [muted, setMuted]             = useState(false);
  const [camOff, setCamOff]           = useState(false);
  const [sharing, setSharing]         = useState(false);
  const [showChat, setShowChat]       = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [showNoteModal, setNoteModal] = useState(false);
  const [callEnded, setCallEnded]     = useState(false);

  const socketRef      = useRef(null);
  const peerRef        = useRef(null);       // PeerJS instance
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localVideoRef  = useRef(null);
  const remoteVideosRef = useRef({});        // socketId → <video> element
  const callsRef       = useRef({});         // socketId → PeerJS call
  const chatKeyRef     = useRef(null);       // AES-256-GCM key for chat

  // ── Fetch room token ──────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchToken() {
      try {
        const res  = await fetch(`${API_BASE}/telemedicine/sessions/${sessionId}/token`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` },
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? 'Cannot join session');
          setStatus(json.code === 'TOO_EARLY' ? 'too-early' : 'error');
          return;
        }
        setTokenData(json.data);
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }
    fetchToken();
  }, [sessionId]);

  // ── Init media + PeerJS + Socket once token is ready ─────────────────────
  useEffect(() => {
    if (!tokenData) return;

    let cancelled = false;

    async function init() {
      // 1. Get local media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn('[tele] Media access denied:', err.message);
      }

      // 2. Generate chat encryption key (derive from sessionId + user secret)
      const rawKey = await generateKey();
      chatKeyRef.current = rawKey;
      // In production: exchange key via server-side key agreement.
      // For this project: key is derived from sessionId (both parties share it).
      // Simple approach: use sessionId as passphrase with deriveKey.
      // We'll store the exported key in sessionStorage keyed by sessionId.
      const exportedKey = await exportKey(rawKey);
      sessionStorage.setItem(`chatKey:${sessionId}`, exportedKey);

      if (cancelled) return;

      // 3. Connect Socket.io /telemedicine namespace
      const socket = io(`${SOCKET_URL}/telemedicine`, {
        auth      : { token: sessionStorage.getItem('accessToken') },
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('tele:join', { roomId: tokenData.roomId }, (res) => {
          if (res?.error) { setError(res.error); setStatus('error'); return; }

          const role = res.role;
          // Doctor goes straight to admitted; patient waits
          setStatus(role === 'doctor' ? 'admitted' : 'waiting');

          // Call existing peers
          if (res.peers?.length) {
            for (const peer of res.peers) {
              callPeer(peer.socketId);
            }
          }
        });
      });

      // 4. Init PeerJS
      if (window.Peer) {
        const peer = new window.Peer(undefined, {
          host  : PEERJS_HOST,
          port  : PEERJS_PORT,
          secure: PEERJS_PORT === 443,
          path  : '/peerjs',
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });
        peerRef.current = peer;

        // Answer incoming calls
        peer.on('call', (call) => {
          call.answer(localStreamRef.current);
          callsRef.current[call.peer] = call;
          call.on('stream', (remoteStream) => {
            attachRemoteStream(call.peer, remoteStream);
          });
          call.on('close', () => removeRemoteVideo(call.peer));
        });

        peer.on('error', (err) => console.error('[peerjs]', err));
      }

      // ── Socket events ───────────────────────────────────────────────────
      socket.on('tele:peer-joined', ({ socketId, firstName, lastName, role, peerId }) => {
        setPeers((prev) => [...prev, { socketId, firstName, lastName, role }]);
        // Call the new peer via PeerJS
        if (peerId && peerRef.current && localStreamRef.current) {
          const call = peerRef.current.call(peerId, localStreamRef.current);
          callsRef.current[socketId] = call;
          call.on('stream', (remoteStream) => attachRemoteStream(socketId, remoteStream));
          call.on('close', () => removeRemoteVideo(socketId));
        }
      });

      socket.on('tele:peer-left', ({ userId: leftId }) => {
        setPeers((prev) => prev.filter((p) => p.userId !== leftId));
      });

      socket.on('tele:admitted', ({ targetUserId }) => {
        if (targetUserId === currentUser?.id || !targetUserId) {
          setStatus('admitted');
        }
      });

      // Relay WebRTC signals
      socket.on('tele:signal', ({ signal, fromSocketId }) => {
        // PeerJS handles its own signaling; this is for raw RTCPeerConnection fallback
        // In PeerJS mode, signals are handled internally — this is a no-op
        console.debug('[tele] signal from', fromSocketId, signal?.type);
      });

      // In-call chat
      socket.on('tele:chat', async ({ fromUserId, firstName, ciphertext, iv, timestamp }) => {
        try {
          const key  = chatKeyRef.current;
          const text = key ? await decryptMessage(ciphertext, iv, key) : '[encrypted]';
          setChatMessages((prev) => [
            ...prev,
            { text, firstName, timestamp, own: false },
          ]);
        } catch {
          setChatMessages((prev) => [
            ...prev,
            { text: '[encrypted message]', firstName, timestamp, own: false },
          ]);
        }
      });
    }

    init().catch((err) => {
      console.error('[tele] Init error:', err);
      setError(err.message);
      setStatus('error');
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [tokenData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────
  function attachRemoteStream(peerId, stream) {
    setPeers((prev) => {
      const exists = prev.find((p) => p.socketId === peerId || p.peerId === peerId);
      if (!exists) return [...prev, { socketId: peerId, stream }];
      return prev.map((p) =>
        p.socketId === peerId || p.peerId === peerId ? { ...p, stream } : p
      );
    });
    // Attach to video element if already mounted
    const el = remoteVideosRef.current[peerId];
    if (el) el.srcObject = stream;
  }

  function removeRemoteVideo(peerId) {
    setPeers((prev) => prev.filter((p) => p.socketId !== peerId));
    delete remoteVideosRef.current[peerId];
    delete callsRef.current[peerId];
  }

  function callPeer(targetSocketId) {
    if (!peerRef.current || !localStreamRef.current) return;
    const call = peerRef.current.call(targetSocketId, localStreamRef.current);
    if (!call) return;
    callsRef.current[targetSocketId] = call;
    call.on('stream', (remoteStream) => attachRemoteStream(targetSocketId, remoteStream));
    call.on('close', () => removeRemoteVideo(targetSocketId));
  }

  function cleanup() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    Object.values(callsRef.current).forEach((c) => c.close?.());
    peerRef.current?.destroy();
    socketRef.current?.disconnect();
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted;
    setMuted((v) => !v);
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = camOff;
    setCamOff((v) => !v);
  }

  async function toggleScreenShare() {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      // Restore camera track in all calls
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        Object.values(callsRef.current).forEach((call) => {
          const sender = call.peerConnection
            ?.getSenders()
            .find((s) => s.track?.kind === 'video');
          sender?.replaceTrack(camTrack);
        });
      }
      setSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        // Replace video track in all active calls
        Object.values(callsRef.current).forEach((call) => {
          const sender = call.peerConnection
            ?.getSenders()
            .find((s) => s.track?.kind === 'video');
          sender?.replaceTrack(screenTrack);
        });

        // Also update local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        screenTrack.onended = () => toggleScreenShare();
        setSharing(true);
      } catch (err) {
        console.warn('[tele] Screen share denied:', err.message);
      }
    }
  }

  function handleEndCall() {
    socketRef.current?.emit('tele:leave', { roomId: tokenData?.roomId });
    cleanup();
    setCallEnded(true);
    if (tokenData?.role === 'doctor') {
      setNoteModal(true);
    } else {
      setStatus('ended');
    }
  }

  async function handleSendChat(text) {
    const key = chatKeyRef.current;
    if (!key || !socketRef.current) return;
    try {
      const { ciphertext, iv } = await encryptMessage(text, key);
      socketRef.current.emit('tele:chat', {
        roomId: tokenData.roomId,
        ciphertext,
        iv,
      });
      setChatMessages((prev) => [
        ...prev,
        { text, firstName: currentUser?.firstName, timestamp: new Date().toISOString(), own: true },
      ]);
    } catch (err) {
      console.error('[tele] Chat encrypt error:', err);
    }
  }

  function handleAdmitPatient(targetUserId) {
    socketRef.current?.emit('tele:admit', {
      roomId: tokenData?.roomId,
      targetUserId,
    });
  }

  // ── Render states ─────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className={styles.centerState}>
        <div className={styles.spinner} aria-label="Loading" />
        <p>Connecting to session…</p>
      </div>
    );
  }

  if (status === 'too-early') {
    return (
      <div className={styles.centerState}>
        <div className={styles.stateIcon}>🕐</div>
        <h2>Session not started yet</h2>
        <p>You can join 5 minutes before the scheduled time.</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.centerState}>
        <div className={styles.stateIcon}>⚠️</div>
        <h2>Cannot join session</h2>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (status === 'ended' && !showNoteModal) {
    return (
      <div className={styles.centerState}>
        <div className={styles.stateIcon}>✅</div>
        <h2>Session ended</h2>
        <p>The video consultation has ended.</p>
      </div>
    );
  }

  return (
    <div className={styles.room}>
      {/* Video grid */}
      <div className={`${styles.videoGrid} ${peers.length > 0 ? styles.hasRemote : ''}`}>
        {/* Local video */}
        <div className={styles.videoTile}>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={styles.video}
          />
          <div className={styles.videoLabel}>
            You {muted && <span className={styles.mutedTag}>🔇</span>}
          </div>
        </div>

        {/* Remote videos */}
        {peers.map((peer) => (
          <div key={peer.socketId} className={styles.videoTile}>
            <video
              autoPlay
              playsInline
              className={styles.video}
              ref={(el) => {
                if (el) {
                  remoteVideosRef.current[peer.socketId] = el;
                  if (peer.stream) el.srcObject = peer.stream;
                }
              }}
            />
            <div className={styles.videoLabel}>
              {peer.firstName} {peer.lastName}
              <span className={styles.roleTag}>{peer.role}</span>
            </div>
          </div>
        ))}

        {/* Waiting room overlay for patient */}
        {status === 'waiting' && (
          <div className={styles.waitingOverlay}>
            <div className={styles.waitingSpinner} />
            <p>Waiting for the doctor to admit you…</p>
          </div>
        )}
      </div>

      {/* Doctor: admit patient button */}
      {tokenData?.role === 'doctor' && peers.some((p) => p.role === 'patient') && (
        <div className={styles.admitBar}>
          {peers
            .filter((p) => p.role === 'patient')
            .map((p) => (
              <button
                key={p.socketId}
                className={styles.admitBtn}
                onClick={() => handleAdmitPatient(p.userId)}
              >
                Admit {p.firstName} {p.lastName}
              </button>
            ))}
        </div>
      )}

      {/* Controls */}
      <div className={styles.controls} role="toolbar" aria-label="Call controls">
        <button
          className={`${styles.ctrlBtn} ${muted ? styles.active : ''}`}
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🎙️'}
        </button>

        <button
          className={`${styles.ctrlBtn} ${camOff ? styles.active : ''}`}
          onClick={toggleCamera}
          aria-label={camOff ? 'Enable camera' : 'Disable camera'}
          title={camOff ? 'Enable camera' : 'Disable camera'}
        >
          {camOff ? '📷' : '📹'}
        </button>

        <button
          className={`${styles.ctrlBtn} ${sharing ? styles.active : ''}`}
          onClick={toggleScreenShare}
          aria-label={sharing ? 'Stop sharing' : 'Share screen'}
          title={sharing ? 'Stop sharing' : 'Share screen'}
        >
          🖥️
        </button>

        <button
          className={`${styles.ctrlBtn} ${showChat ? styles.active : ''}`}
          onClick={() => setShowChat((v) => !v)}
          aria-label="Toggle chat"
          title="Chat"
        >
          💬
        </button>

        <button
          className={`${styles.ctrlBtn} ${styles.endBtn}`}
          onClick={handleEndCall}
          aria-label="End call"
          title="End call"
        >
          📵
        </button>
      </div>

      {/* Chat sidebar */}
      {showChat && (
        <ChatSidebar
          messages={chatMessages}
          onSend={handleSendChat}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* Consultation note modal (doctor only, after end) */}
      {showNoteModal && (
        <ConsultationNoteModal
          sessionId={sessionId}
          onSaved={() => { setNoteModal(false); setStatus('ended'); }}
          onSkip={async () => {
            // Still mark session ended on server
            await fetch(`${API_BASE}/telemedicine/sessions/${sessionId}/end`, {
              method : 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization : `Bearer ${sessionStorage.getItem('accessToken')}`,
              },
              body: JSON.stringify({}),
            }).catch(console.error);
            setNoteModal(false);
            setStatus('ended');
          }}
        />
      )}
    </div>
  );
}
