import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { apiFetch, API_BASE } from '../../shared/utils/api.js';
import { useAuth, getAccessToken } from '../../shared/store/index.js';
import { encryptChatMessage, decryptChatMessage } from './teleCrypto.js';
import styles from './TeleRoom.module.scss';

import { getSocketUrl } from '../../shared/utils/socketUrl.js';
const SOCKET_URL = getSocketUrl();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ---------------------------------------------------------------------------
// Consultation note modal
// ---------------------------------------------------------------------------
function ConsultationNoteModal({ sessionId, onSaved, onSkip }) {
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`${API_BASE}/telemedicine/sessions/${sessionId}/end`, {
        method: 'PATCH',
        body: JSON.stringify({ consultationNote: note }),
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.noteModal}>
        <h3>Add Consultation Note</h3>
        <p className={styles.noteHint}>This note will be saved to the patient's medical records.</p>
        <textarea className={styles.noteTextarea} value={note} onChange={e => setNote(e.target.value)}
          placeholder="Diagnosis, treatment plan, follow-up instructions…" rows={8} maxLength={5000} autoFocus />
        <span className={styles.charCount}>{note.length} / 5000</span>
        {err && <div className={styles.error}>{err}</div>}
        <div className={styles.noteActions}>
          <button className={styles.skipBtn} onClick={onSkip} disabled={saving}>Skip</button>
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
  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

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
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className={styles.chatInput} onSubmit={handleSend}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Type a message…" aria-label="Chat message" />
        <button type="submit" disabled={!text.trim()}>➤</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TeleRoom
// ---------------------------------------------------------------------------
export default function TeleRoom({ sessionId: sessionIdProp }) {
  const { roomId: roomToken } = useParams();
  const { user } = useAuth();

  const [sessionId, setSessionId]   = useState(sessionIdProp ?? null);
  const [tokenData, setTokenData]   = useState(null);
  const roomKeyRef = useRef(null); // AES-256 group key for in-call chat (base64)
  const [status, setStatus]         = useState('loading');
  const [error, setError]           = useState('');
  const [peers, setPeers]           = useState([]);   // { socketId, userId, firstName, lastName, role }
  const [muted, setMuted]           = useState(false);
  const [camOff, setCamOff]         = useState(false);
  const [sharing, setSharing]       = useState(false);
  const [showChat, setShowChat]     = useState(false);
  const [chatMessages, setChat]     = useState([]);
  const [showNote, setShowNote]     = useState(false);

  const socketRef       = useRef(null);
  const localStreamRef  = useRef(null);
  const screenStreamRef = useRef(null);
  const localVideoRef   = useRef(null);
  const pcsRef          = useRef({});   // socketId → RTCPeerConnection
  const remoteVidsRef   = useRef({});   // socketId → <video> el

  // ── 1. Resolve session UUID from room token ───────────────────────────────
  useEffect(() => {
    if (sessionId || !roomToken) return;
    apiFetch(`${API_BASE}/telemedicine/sessions/my?limit=50`)
      .then(d => {
        const s = (d?.data?.sessions ?? []).find(s => s.room_id === roomToken || s.room_token === roomToken);
        if (s) setSessionId(s.id);
        else { setError('Session not found'); setStatus('error'); }
      })
      .catch(e => { setError(e.message); setStatus('error'); });
  }, [roomToken, sessionId]);

  // ── 2. Fetch token once session ID is known ───────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    apiFetch(`${API_BASE}/telemedicine/sessions/${sessionId}/token`)
      .then(d => setTokenData(d?.data))
      .catch(e => {
        setError(e.message);
        setStatus(e.message?.includes('TOO_EARLY') ? 'too-early' : 'error');
      });
  }, [sessionId]);

  // ── 3. Media + Socket + WebRTC once token ready ───────────────────────────
  useEffect(() => {
    if (!tokenData) return;
    let cancelled = false;

    // "Polite peer" = patient. Doctor is impolite (won't rollback offers).
    const isPolite = tokenData.role === 'patient';
    const makingOfferRef = { current: false };

    async function init() {
      // Get local media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) {
        console.warn('[tele] Media denied:', e.message);
        // Continue without media — text chat still works
      }

      if (cancelled) return;

      // Connect socket
      const socket = io(`${SOCKET_URL}/telemedicine`, {
        auth: { token: getAccessToken() },
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('tele:join', { roomId: tokenData.roomId }, async (res) => {
          if (res?.error) { setError(res.error); setStatus('error'); return; }
          setStatus('admitted');
          // Send offer to each existing peer
          for (const peer of (res.peers ?? [])) {
            setPeers(prev => prev.find(p => p.socketId === peer.socketId) ? prev : [...prev, peer]);
            await sendOffer(peer.socketId);
          }
        });
      });

      // New peer joined — add to list; they will send us an offer
      socket.on('tele:peer-joined', ({ socketId, userId, firstName, lastName, role }) => {
        setPeers(prev => prev.find(p => p.socketId === socketId) ? prev : [...prev, { socketId, userId, firstName, lastName, role }]);
        // The joining peer sends the offer; we just wait
      });

      // Receive signal
      socket.on('tele:signal', async ({ signal, fromSocketId, fromUserId, firstName, lastName, role }) => {
        // Ensure peer exists in list
        setPeers(prev => prev.find(p => p.socketId === fromSocketId) ? prev : [...prev, { socketId: fromSocketId, userId: fromUserId, firstName, lastName, role }]);

        const pc = getOrCreatePC(fromSocketId);

        try {
          if (signal.type === 'offer') {
            // Collision: we already sent an offer and we're the impolite peer → ignore
            const collision = makingOfferRef.current || pc.signalingState !== 'stable';
            if (collision && !isPolite) return;
            // Polite peer rolls back
            if (collision) {
              await pc.setLocalDescription({ type: 'rollback' });
            }
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('tele:signal', {
              roomId: tokenData.roomId,
              targetSocketId: fromSocketId,
              signal: pc.localDescription,
              role: tokenData.role,
            });
          } else if (signal.type === 'answer') {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(signal));
            }
          } else if (signal.candidate !== undefined) {
            try {
              await pc.addIceCandidate(signal.candidate ? new RTCIceCandidate(signal) : null);
            } catch (e) {
              if (!isPolite) console.warn('[tele] ICE candidate error:', e.message);
            }
          }
        } catch (e) {
          console.error('[tele] signal handling error:', e.message);
        }
      });

      socket.on('tele:peer-left', ({ userId: leftId }) => {
        setPeers(prev => {
          const leaving = prev.find(p => p.userId === leftId);
          if (leaving) {
            pcsRef.current[leaving.socketId]?.close();
            delete pcsRef.current[leaving.socketId];
            delete remoteVidsRef.current[leaving.socketId];
          }
          return prev.filter(p => p.userId !== leftId);
        });
      });

      socket.on('tele:chat', ({ firstName, ciphertext, iv }) => {
        // Decrypt if we have the room key; otherwise show a placeholder
        if (roomKeyRef.current && ciphertext && iv) {
          decryptChatMessage(ciphertext, iv, roomKeyRef.current)
            .then((text) => {
              setChat(prev => [...prev, { text, firstName, own: false }]);
            })
            .catch(() => {
              setChat(prev => [...prev, { text: '[encrypted message]', firstName, own: false }]);
            });
        } else {
          setChat(prev => [...prev, { text: '[encrypted message]', firstName, own: false }]);
        }
      });
    }

    async function sendOffer(targetSocketId) {
      const pc = getOrCreatePC(targetSocketId);
      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return; // aborted
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('tele:signal', {
          roomId: tokenData.roomId,
          targetSocketId,
          signal: pc.localDescription,
          role: tokenData.role,
        });
      } catch (e) {
        console.error('[tele] createOffer error:', e.message);
      } finally {
        makingOfferRef.current = false;
      }
    }

    function getOrCreatePC(targetSocketId) {
      if (pcsRef.current[targetSocketId]) return pcsRef.current[targetSocketId];

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcsRef.current[targetSocketId] = pc;

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
      }

      pc.onicecandidate = ({ candidate }) => {
        socketRef.current?.emit('tele:signal', {
          roomId: tokenData.roomId,
          targetSocketId,
          signal: candidate ?? { candidate: null },
          role: tokenData.role,
        });
      };

      pc.ontrack = ({ streams }) => {
        const stream = streams[0];
        if (!stream) return;
        setPeers(prev => prev.map(p => p.socketId === targetSocketId ? { ...p, stream } : p));
        const el = remoteVidsRef.current[targetSocketId];
        if (el) el.srcObject = stream;
      };

      pc.onnegotiationneeded = async () => {
        await sendOffer(targetSocketId);
      };

      pc.onconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
          setPeers(prev => prev.filter(p => p.socketId !== targetSocketId));
          delete pcsRef.current[targetSocketId];
        }
      };

      return pc;
    }

    init().catch(e => { console.error('[tele] init error:', e); setError(e.message); setStatus('error'); });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      Object.values(pcsRef.current).forEach(pc => pc.close());
      pcsRef.current = {};
      socketRef.current?.disconnect();
    };
  }, [tokenData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Controls ──────────────────────────────────────────────────────────────
  function toggleMute() {
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = muted;
    setMuted(v => !v);
  }

  function toggleCamera() {
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (!t) return;
    t.enabled = camOff;
    setCamOff(v => !v);
  }

  async function toggleScreenShare() {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          sender?.replaceTrack(camTrack);
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      }
      setSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const track = screen.getVideoTracks()[0];
        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          sender?.replaceTrack(track);
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;
        track.onended = () => toggleScreenShare();
        setSharing(true);
      } catch (e) { console.warn('[tele] screen share denied:', e.message); }
    }
  }

  function handleEndCall() {
    socketRef.current?.emit('tele:leave', { roomId: tokenData?.roomId });
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(pcsRef.current).forEach(pc => pc.close());
    socketRef.current?.disconnect();
    if (tokenData?.role === 'doctor') setShowNote(true);
    else setStatus('ended');
  }

  function handleSendChat(text) {
    if (!tokenData) return;

    // If no room key yet, generate one and store it in memory only
    if (!roomKeyRef.current) {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      roomKeyRef.current = btoa(String.fromCharCode(...rawKey));
    }

    encryptChatMessage(text, roomKeyRef.current)
      .then(({ ciphertext, iv }) => {
        socketRef.current?.emit('tele:chat', {
          roomId: tokenData.roomId,
          ciphertext,
          iv,
        });
        setChat(prev => [...prev, { text, firstName: user?.firstName, own: true }]);
      })
      .catch((err) => console.error('[tele] chat encrypt error:', err.message));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (status === 'loading') return (
    <div className={styles.centerState}>
      <div className={styles.spinner} aria-label="Loading" />
      <p>Connecting to session…</p>
    </div>
  );

  if (status === 'too-early') return (
    <div className={styles.centerState}>
      <div className={styles.stateIcon}>🕐</div>
      <h2>Session not started yet</h2>
      <p>You can join 5 minutes before the scheduled time.</p>
    </div>
  );

  if (status === 'error') return (
    <div className={styles.centerState}>
      <div className={styles.stateIcon}>⚠️</div>
      <h2>Cannot join session</h2>
      <p className={styles.errorText}>{error}</p>
    </div>
  );

  if (status === 'ended' && !showNote) return (
    <div className={styles.centerState}>
      <div className={styles.stateIcon}>✅</div>
      <h2>Session ended</h2>
      <p>The video consultation has ended.</p>
    </div>
  );

  return (
    <div className={styles.room}>
      <div className={`${styles.videoGrid} ${peers.length > 0 ? styles.hasRemote : ''}`}>
        {/* Local */}
        <div className={styles.videoTile}>
          <video ref={localVideoRef} autoPlay muted playsInline className={styles.video} />
          <div className={styles.videoLabel}>You {muted && <span className={styles.mutedTag}>🔇</span>}</div>
        </div>

        {/* Remote */}
        {peers.filter(p => p.socketId).map(peer => (
          <div key={peer.socketId} className={styles.videoTile}>
            <video autoPlay playsInline className={styles.video}
              ref={el => {
                if (el) {
                  remoteVidsRef.current[peer.socketId] = el;
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
      </div>

      {/* Controls */}
      <div className={styles.controls} role="toolbar" aria-label="Call controls">
        <button className={`${styles.ctrlBtn} ${muted ? styles.active : ''}`} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🎙️'}
        </button>
        <button className={`${styles.ctrlBtn} ${camOff ? styles.active : ''}`} onClick={toggleCamera} title={camOff ? 'Enable camera' : 'Disable camera'}>
          {camOff ? '📷' : '📹'}
        </button>
        <button className={`${styles.ctrlBtn} ${sharing ? styles.active : ''}`} onClick={toggleScreenShare} title={sharing ? 'Stop sharing' : 'Share screen'}>
          🖥️
        </button>
        <button className={`${styles.ctrlBtn} ${showChat ? styles.active : ''}`} onClick={() => setShowChat(v => !v)} title="Chat">
          💬
        </button>
        <button className={`${styles.ctrlBtn} ${styles.endBtn}`} onClick={handleEndCall} title="End call">
          📵
        </button>
      </div>

      {showChat && <ChatSidebar messages={chatMessages} onSend={handleSendChat} onClose={() => setShowChat(false)} />}

      {showNote && (
        <ConsultationNoteModal
          sessionId={sessionId}
          onSaved={() => { setShowNote(false); setStatus('ended'); }}
          onSkip={async () => {
            await apiFetch(`${API_BASE}/telemedicine/sessions/${sessionId}/end`, {
              method: 'PATCH', body: JSON.stringify({}),
            }).catch(console.error);
            setShowNote(false);
            setStatus('ended');
          }}
        />
      )}
    </div>
  );
}
