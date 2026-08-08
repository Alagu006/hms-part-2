import jwt        from 'jsonwebtoken';
import fs          from 'fs';
import { query }   from '../../shared/db/pool.js';
import { verifyRoomId } from './telemedicine.service.js';

const PUBLIC_KEY = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');

// ---------------------------------------------------------------------------
// JWT auth middleware for Socket.io
// ---------------------------------------------------------------------------
function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token
    ?? socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) return next(new Error('Authentication required'));

  try {
    const payload = jwt.verify(token, PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer    : process.env.JWT_ISSUER   || 'hms',
      audience  : process.env.JWT_AUDIENCE || 'hms-client',
    });
    socket.user = {
      id       : payload.sub,
      roles    : payload.roles ?? [],
      firstName: payload.firstName,
      lastName : payload.lastName,
    };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

// ---------------------------------------------------------------------------
// Validate that the user is a participant in the session for this roomId
// ---------------------------------------------------------------------------
export async function validateParticipant(roomId, userId) {
  const { rows } = await query(
    `SELECT ts.id, ts.doctor_id, ts.status,
            a.scheduled_at, a.duration_minutes,
            pt.user_id AS patient_user_id
     FROM telemedicine_sessions ts
     JOIN appointments a ON a.id = ts.appointment_id
     JOIN patients pt    ON pt.id = ts.patient_id
     WHERE ts.room_token = $1`,
    [roomId]
  );
  const session = rows[0];
  if (!session) return null;

  const isDoctor  = session.doctor_id === userId;
  const isPatient = session.patient_user_id === userId;
  if (!isDoctor && !isPatient) return null;

  // Check expiry
  const expiry = new Date(session.scheduled_at).getTime()
    + (session.duration_minutes + 30) * 60_000;
  if (Date.now() > expiry && session.status === 'COMPLETED') return null;

  return { session, role: isDoctor ? 'doctor' : 'patient' };
}

// R16: a socket may only relay events into the room it actually joined via
// tele:join — the ONLY place socket.data.roomId is set, after validateParticipant
// confirmed the user is a participant. The client-supplied roomId on any other
// event is never trusted.
function inRoom(socket, roomId) {
  return !!roomId && socket.data?.roomId === roomId;
}

// ---------------------------------------------------------------------------
// Register /telemedicine namespace
// ---------------------------------------------------------------------------
export function registerTelemedicineSocket(io) {
  const teleNs = io.of('/telemedicine');

  teleNs.use(authenticateSocket);

  teleNs.on('connection', (socket) => {
    const { user } = socket;

    // ── tele:join ─────────────────────────────────────────────────────────
    socket.on('tele:join', async ({ roomId }, ack) => {
      if (!roomId) return ack?.({ error: 'roomId required' });

      const result = await validateParticipant(roomId, user.id);
      if (!result) return ack?.({ error: 'Not authorized for this room' });

      const { session, role } = result;

      socket.join(`tele:${roomId}`);
      socket.data.roomId = roomId;
      socket.data.role   = role;

      // Tell others in the room that a peer joined
      socket.to(`tele:${roomId}`).emit('tele:peer-joined', {
        userId   : user.id,
        firstName: user.firstName,
        lastName : user.lastName,
        role,
        peerId   : socket.id, // used by PeerJS caller side
      });

      // Tell the joining socket who is already in the room
      const roomSockets = await teleNs.in(`tele:${roomId}`).fetchSockets();
      const peers = roomSockets
        .filter((s) => s.id !== socket.id)
        .map((s) => ({
          socketId : s.id,
          userId   : s.user?.id,
          firstName: s.user?.firstName,
          lastName : s.user?.lastName,
          role     : s.data?.role,
        }));

      ack?.({ ok: true, role, peers, sessionId: session.id });
    });

    // ── tele:signal — relay WebRTC signaling data ─────────────────────────
    socket.on('tele:signal', ({ roomId, signal, targetSocketId, role }) => {
      if (!roomId || !signal || !inRoom(socket, roomId)) return;

      const payload = {
        signal,
        fromSocketId: socket.id,
        fromUserId  : user.id,
        firstName   : user.firstName,
        lastName    : user.lastName,
        role        : role ?? socket.data?.role,
      };

      if (targetSocketId) {
        teleNs.to(targetSocketId).emit('tele:signal', payload);
      } else {
        socket.to(`tele:${roomId}`).emit('tele:signal', payload);
      }
    });

    // ── tele:admit — doctor admits patient (kept for compatibility) ──────────
    socket.on('tele:admit', ({ roomId, targetUserId }) => {
      if (!roomId || !targetUserId || !inRoom(socket, roomId)) return;
      teleNs.to(`tele:${roomId}`).emit('tele:admitted', { admittedBy: user.id, targetUserId });
    });

    // ── tele:chat — in-call encrypted chat message ────────────────────────
    socket.on('tele:chat', ({ roomId, ciphertext, iv }) => {
      if (!roomId || !ciphertext || !iv || !inRoom(socket, roomId)) return;
      // Relay ciphertext only — never log content
      socket.to(`tele:${roomId}`).emit('tele:chat', {
        fromUserId  : user.id,
        firstName   : user.firstName,
        ciphertext,
        iv,
        timestamp   : new Date().toISOString(),
      });
    });

    // ── tele:key-exchange — relay ECDH public keys for chat key agreement ──
    // The public key is public by design; the derived AES key never travels.
    // Room membership is gated by tele:join (validateParticipant), so only
    // authenticated session participants receive each other's public keys.
    socket.on('tele:key-exchange', ({ roomId, publicKey, targetSocketId }) => {
      if (!roomId || !publicKey || !inRoom(socket, roomId)) return;
      const payload = {
        fromSocketId: socket.id,
        fromUserId  : user.id,
        publicKey,
      };
      if (targetSocketId) {
        teleNs.to(targetSocketId).emit('tele:key-exchange', payload);
      } else {
        socket.to(`tele:${roomId}`).emit('tele:key-exchange', payload);
      }
    });

    // ── tele:leave ────────────────────────────────────────────────────────
    socket.on('tele:leave', ({ roomId }) => {
      if (!roomId || !inRoom(socket, roomId)) return;
      socket.to(`tele:${roomId}`).emit('tele:peer-left', {
        userId   : user.id,
        firstName: user.firstName,
        role     : socket.data.role,
      });
      socket.leave(`tele:${roomId}`);
      socket.data.roomId = null; // no further relays allowed after leaving
    });

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const roomId = socket.data?.roomId;
      if (roomId) {
        socket.to(`tele:${roomId}`).emit('tele:peer-left', {
          userId   : user.id,
          firstName: user.firstName,
          role     : socket.data.role,
        });
      }
    });
  });

  return teleNs;
}
