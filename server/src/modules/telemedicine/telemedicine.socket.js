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
async function validateParticipant(roomId, userId) {
  const { rows } = await query(
    `SELECT ts.id, ts.doctor_id, ts.status, ts.scheduled_at,
            ts.duration_minutes, pt.user_id AS patient_user_id
     FROM telemedicine_sessions ts
     JOIN patients pt ON pt.id = ts.patient_id
     WHERE ts.room_id = $1 AND ts.deleted_at IS NULL`,
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
  if (Date.now() > expiry && session.status === 'ENDED') return null;

  return { session, role: isDoctor ? 'doctor' : 'patient' };
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
    socket.on('tele:signal', ({ roomId, signal, targetSocketId }) => {
      if (!roomId || !signal) return;

      const payload = {
        signal,
        fromSocketId: socket.id,
        fromUserId  : user.id,
        firstName   : user.firstName,
        lastName    : user.lastName,
      };

      if (targetSocketId) {
        // Direct to specific peer (PeerJS offer/answer)
        teleNs.to(targetSocketId).emit('tele:signal', payload);
      } else {
        // Broadcast to room (ICE candidates)
        socket.to(`tele:${roomId}`).emit('tele:signal', payload);
      }
    });

    // ── tele:admit — doctor admits patient from waiting room ──────────────
    socket.on('tele:admit', ({ roomId, targetUserId }) => {
      if (!roomId || !targetUserId) return;
      if (socket.data.role !== 'doctor') return;

      teleNs.to(`tele:${roomId}`).emit('tele:admitted', {
        admittedBy: user.id,
        targetUserId,
      });
    });

    // ── tele:chat — in-call encrypted chat message ────────────────────────
    socket.on('tele:chat', ({ roomId, ciphertext, iv }) => {
      if (!roomId || !ciphertext || !iv) return;
      // Relay ciphertext only — never log content
      socket.to(`tele:${roomId}`).emit('tele:chat', {
        fromUserId  : user.id,
        firstName   : user.firstName,
        ciphertext,
        iv,
        timestamp   : new Date().toISOString(),
      });
    });

    // ── tele:leave ────────────────────────────────────────────────────────
    socket.on('tele:leave', ({ roomId }) => {
      if (!roomId) return;
      socket.to(`tele:${roomId}`).emit('tele:peer-left', {
        userId   : user.id,
        firstName: user.firstName,
        role     : socket.data.role,
      });
      socket.leave(`tele:${roomId}`);
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
