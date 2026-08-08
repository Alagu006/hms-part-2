import jwt                from 'jsonwebtoken';
import fs                 from 'fs';
import { redis, subscriber } from '../../shared/services/redis.service.js';
import * as svc           from './messaging.service.js';
import { logger }         from '../../shared/logger.js';

const PUBLIC_KEY = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');

// In-memory map: userId → Set of socketIds (multi-tab support)
const onlineUsers  = new Map();
const typingTimers = new Map(); // key = `${userId}:${groupId}`

// ---------------------------------------------------------------------------
// JWT auth for Socket.io handshake
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
      id          : payload.sub,
      roles       : payload.roles ?? [],
      firstName   : payload.firstName,
      lastName    : payload.lastName,
      departmentId: payload.departmentId,
    };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

// ---------------------------------------------------------------------------
// R15 guards — never trust a client-supplied groupId/messageId. Every handler
// must prove the user is still a member of the group it names, and message
// events must point at the message's REAL group (resolved server-side).
// ---------------------------------------------------------------------------
async function isMember(groupId, userId) {
  if (!groupId) return false;
  return svc.isMember(groupId, userId);
}

async function canAccessMessage(userId, messageId, groupId) {
  const msg = await svc.getMessageGroup(messageId);
  if (!msg || msg.group_id !== groupId) return false;
  return svc.isMember(groupId, userId);
}

// ---------------------------------------------------------------------------
// Track online presence
// ---------------------------------------------------------------------------
function markOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
  // Fire-and-forget presence write — best-effort; a Redis outage must never
  // crash the socket connection (in-memory presence still works).
  redis.setex(`presence:${userId}`, 120, '1').catch((err) => {
    logger.warn('[socket] presence set failed (best-effort):', { message: err.message });
  });
}

function markOffline(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      onlineUsers.delete(userId);
      // Fire-and-forget presence delete — best-effort (see markOnline).
      redis.del(`presence:${userId}`).catch((err) => {
        logger.warn('[socket] presence del failed (best-effort):', { message: err.message });
      });
    }
  }
}

export function isOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

// ---------------------------------------------------------------------------
// Register socket.io namespace and handlers
// ---------------------------------------------------------------------------
export function registerMessagingSocket(io) {
  const msgNs = io.of('/messaging');

  msgNs.use(authenticateSocket);

  // ── Redis subscriber: fan-out events from other server instances ──────────
  // Best-effort: if Redis is unreachable the subscribe promise rejects — catch
  // it so the process never crashes on a Redis outage (unhandled rejection).
  subscriber.subscribe(svc.PUBSUB_CHANNEL).catch((err) => {
    logger.warn('[socket] Redis subscribe failed (best-effort):', { message: err.message });
  });
  subscriber.on('message', (_channel, raw) => {
    try {
      const { event, payload } = JSON.parse(raw);
      if (payload.groupId) {
        msgNs.to(`group:${payload.groupId}`).emit(event, payload);
      }
      if (payload.targetUserId) {
        msgNs.to(`user:${payload.targetUserId}`).emit(event, payload);
      }
    } catch (err) {
      logger.error('[socket] Redis fan-out parse error', { message: err.message });
    }
  });

  msgNs.on('connection', async (socket) => {
    const { user } = socket;

    // Join personal room + all group rooms
    socket.join(`user:${user.id}`);
    const groups = await svc.getUserGroups(user.id);
    for (const g of groups) socket.join(`group:${g.id}`);

    // Presence
    markOnline(user.id, socket.id);
    await svc.publishEvent('user:online', {
      userId   : user.id,
      firstName: user.firstName,
      lastName : user.lastName,
    });

    // ── message:send ─────────────────────────────────────────────────────────
    socket.on('message:send', async (data, ack) => {
      try {
        const { groupId, content, encryptionIv, replyToId } = data;

        if (!groupId || !content || !encryptionIv) {
          return ack?.({ error: 'groupId, content, and encryptionIv are required' });
        }

        // Verify membership
        const member = await svc.isMember(groupId, user.id);
        if (!member) return ack?.({ error: 'Not a member of this group' });

        // Save ciphertext — content is NEVER logged or inspected
        const message = await svc.saveMessage({
          groupId,
          senderId    : user.id,
          content,       // ciphertext
          encryptionIv,
          replyToId,
        });

        const outbound = {
          ...message,
          sender_name: `${user.firstName} ${user.lastName}`,
          status    : 'sent',
        };

        // Publish via Redis for multi-instance fan-out
        await svc.publishEvent('message:new', { groupId, message: outbound });

        ack?.({ ok: true, messageId: message.id });
      } catch (err) {
        logger.error('[socket] message:send error', { message: err.message });
        ack?.({ error: 'Failed to send message' });
      }
    });

    // ── message:delivered ────────────────────────────────────────────────────
    socket.on('message:delivered', async ({ messageId, groupId }) => {
      if (!messageId || !groupId) return;
      // R15: only members of the message's real group may emit delivery events
      if (!(await canAccessMessage(user.id, messageId, groupId))) return;
      await svc.publishEvent('message:delivered', {
        messageId,
        groupId,
        userId: user.id,
      });
    });

    // ── message:read ─────────────────────────────────────────────────────────
    socket.on('message:read', async ({ groupId, lastReadMessageId }) => {
      if (!groupId) return;
      if (!(await isMember(groupId, user.id))) return;
      try {
        await svc.markGroupRead(groupId, user.id);
        await svc.publishEvent('message:read', {
          groupId,
          userId          : user.id,
          lastReadMessageId,
        });
      } catch (err) {
        logger.error('[socket] message:read error', { message: err.message });
      }
    });

    // ── typing:start / typing:stop ───────────────────────────────────────────
    socket.on('typing:start', async ({ groupId }) => {
      if (!groupId) return;
      if (!(await isMember(groupId, user.id))) return;
      socket.to(`group:${groupId}`).emit('typing:start', {
        groupId,
        userId   : user.id,
        firstName: user.firstName,
      });

      // Auto-clear after 3 seconds
      const timerKey = `${user.id}:${groupId}`;
      if (typingTimers.has(timerKey)) clearTimeout(typingTimers.get(timerKey));
      const timer = setTimeout(() => {
        typingTimers.delete(timerKey);
        socket.to(`group:${groupId}`).emit('typing:stop', {
          groupId,
          userId: user.id,
        });
      }, 3_000);
      typingTimers.set(timerKey, timer);
    });

    socket.on('typing:stop', async ({ groupId }) => {
      if (!groupId) return;
      if (!(await isMember(groupId, user.id))) return;
      const timerKey = `${user.id}:${groupId}`;
      if (typingTimers.has(timerKey)) {
        clearTimeout(typingTimers.get(timerKey));
        typingTimers.delete(timerKey);
      }
      socket.to(`group:${groupId}`).emit('typing:stop', {
        groupId,
        userId: user.id,
      });
    });

    // ── message:react ────────────────────────────────────────────────────────
    socket.on('message:react', async ({ messageId, groupId, emoji }, ack) => {
      if (!messageId || !emoji || !groupId) return ack?.({ error: 'Missing fields' });
      // R15: only members of the message's real group may react
      if (!(await canAccessMessage(user.id, messageId, groupId))) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        const reactions = await svc.addReaction(messageId, user.id, emoji);
        await svc.publishEvent('message:reactions', { groupId, messageId, reactions });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: 'Failed to add reaction' });
      }
    });

    socket.on('message:unreact', async ({ messageId, groupId, emoji }, ack) => {
      if (!messageId || !emoji || !groupId) return ack?.({ error: 'Missing fields' });
      if (!(await canAccessMessage(user.id, messageId, groupId))) {
        return ack?.({ error: 'Forbidden' });
      }
      try {
        await svc.removeReaction(messageId, user.id, emoji);
        const { rows } = await svc.getReactions(messageId);
        await svc.publishEvent('message:reactions', { groupId, messageId, reactions: rows });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: 'Failed to remove reaction' });
      }
    });

    // ── message:delete ───────────────────────────────────────────────────────
    socket.on('message:delete', async ({ messageId, groupId }, ack) => {
      if (!messageId || !groupId) return ack?.({ error: 'Missing fields' });
      try {
        // R15: fan-out must target the message's REAL group, never the
        // client-supplied groupId — resolve it server-side and require a match.
        const msg = await svc.getMessageGroup(messageId);
        if (!msg)                 return ack?.({ error: 'Message not found' });
        if (msg.group_id !== groupId) return ack?.({ error: 'Forbidden' });

        const result = await svc.deleteMessage(messageId, user.id);
        if (!result)              return ack?.({ error: 'Message not found' });
        if (result === 'FORBIDDEN') return ack?.({ error: 'Not your message' });

        if (result.deleteForEveryone) {
          await svc.publishEvent('message:deleted', {
            groupId: msg.group_id,
            messageId,
            deleteForEveryone: true,
          });
        }
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ error: 'Failed to delete message' });
      }
    });

    // ── join:group (dynamic join after group creation) ───────────────────────
    socket.on('join:group', async ({ groupId }) => {
      const member = await svc.isMember(groupId, user.id);
      if (member) socket.join(`group:${groupId}`);
    });

    // ── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      markOffline(user.id, socket.id);
      if (!isOnline(user.id)) {
        await svc.publishEvent('user:offline', {
          userId   : user.id,
          firstName: user.firstName,
        });
      }
    });
  });

  return msgNs;
}
