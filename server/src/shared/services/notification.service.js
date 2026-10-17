import { query }        from '../db/pool.js';
import { pgEncrypt, pgDecrypt } from '../db/pgcrypto.js';
import { redis }        from './redis.service.js';
import { sendPushNotification } from './webpush.service.js';
import { auditLog } from '../middleware/audit.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Notification type enum
// ---------------------------------------------------------------------------
export const NotificationType = Object.freeze({
  APPOINTMENT_BOOKED    : 'APPOINTMENT',
  LAB_ORDER_CREATED     : 'LAB_ORDER',
  LAB_RESULT_UPLOADED   : 'LAB_RESULT',
  PRESCRIPTION_ISSUED   : 'PRESCRIPTION',
  LEAVE_APPROVED        : 'LEAVE',
  LEAVE_REJECTED        : 'LEAVE',
  PATIENT_ASSIGNED      : 'SYSTEM',
  LOW_STOCK             : 'ALERT',
  BROADCAST             : 'SYSTEM',
  NEW_MESSAGE           : 'MESSAGE',
  TELEMEDICINE_REMINDER : 'APPOINTMENT',
  BILL_GENERATED        : 'SYSTEM',
  EQUIPMENT_MAINTENANCE : 'ALERT',
  DRUG_INTERACTION_WARN : 'ALERT',
  VITALS_CRITICAL       : 'ALERT',
  OT_SCHEDULED          : 'OT_SCHEDULED',
  BLOOD_REQUEST         : 'BLOOD_REQUEST',
  EMERGENCY_ALERT       : 'EMERGENCY_ALERT',
});

export const HIGH_PRIORITY_TYPES = new Set([
  NotificationType.VITALS_CRITICAL,
  NotificationType.EMERGENCY_ALERT,
  NotificationType.DRUG_INTERACTION_WARN,
  NotificationType.BLOOD_REQUEST,
]);

const UNREAD_KEY = (userId) => `notif:unread:${userId}`;

// ---------------------------------------------------------------------------
// Create notification
// ---------------------------------------------------------------------------

/**
 * @param {string}  userId       — the actor (who triggered this notification)
 * @param {string}  type        — NotificationType value
 * @param {string}  title       — plaintext
 * @param {string}  body        — plaintext
 * @param {object}  [metadata]  — { entityType, entityId, ...extra }
 * @param {object}  [io]        — Socket.io server instance (optional)
 */
export async function createNotification(userId, type, title, body, metadata = {}, io = null) {
  const [encTitle, encBody, encIv] = await Promise.all([
    pgEncrypt(title),
    pgEncrypt(body),
    pgEncrypt(JSON.stringify(metadata)),
  ]);

  const encryptionIv = 'pgcrypto';

  const { rows } = await query(
    `INSERT INTO notifications
       (id, user_id, type, title, body, encryption_iv, entity_type, entity_id,
        is_read, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, NOW())
     RETURNING id, user_id, type, is_read, created_at`,
    [
      userId,
      type,
      encTitle,
      encBody,
      encryptionIv,
      metadata.entityType ?? null,
      metadata.entityId   ?? null,
    ]
  );

  const notification = rows[0];

  // Increment Redis unread counter
  await redis.incr(UNREAD_KEY(userId));

  // Real-time emit via Socket.io if instance provided
  if (io) {
    io.of('/notifications').to(`user:${userId}`).emit('notification:new', {
      id        : notification.id,
      type,
      title,    // plaintext for real-time — client encrypts for storage
      body,
      metadata,
      isRead    : false,
      createdAt : notification.created_at,
      highPriority: HIGH_PRIORITY_TYPES.has(type),
    });
  }

  // Web push (fire-and-forget)
  sendPushNotification(userId, {
    title,
    body : body.slice(0, 120),
    data : { type, ...metadata },
  }).catch((err) => logger.warn('[notification] Push failed:', { message: err.message }));

  await auditLog({
    userId,
    action  : 'CREATE',
    entity  : 'notifications',
    entityId: notification.id,
    nextData: {
      recipientId: notification.user_id,
      type: notification.type,
      title: '[encrypted]',
    },
  });

  return notification;
}

// ---------------------------------------------------------------------------
// Mark single notification as read
// ---------------------------------------------------------------------------
export async function markAsRead(notificationId, userId) {
  const { rows } = await query(
    `UPDATE notifications
     SET is_read = TRUE, read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_read = FALSE
     RETURNING id`,
    [notificationId, userId]
  );

  if (rows[0]) {
    await auditLog({ userId, action: 'UPDATE', entity: 'notifications', entityId: notificationId, prevData: { is_read: false }, nextData: { is_read: true } });
    const current = await redis.get(UNREAD_KEY(userId));
    if (current && parseInt(current, 10) > 0) {
      await redis.decr(UNREAD_KEY(userId));
    }
  }

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Mark all as read
// ---------------------------------------------------------------------------
export async function markAllAsRead(userId) {
  const { rowCount } = await query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW()
     WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  await redis.set(UNREAD_KEY(userId), '0');
  if (rowCount > 0) {
    await auditLog({ userId, action: 'UPDATE', entity: 'notifications', entityId: null, prevData: { is_read: false }, nextData: { is_read: true, count: rowCount } });
  }
}

// ---------------------------------------------------------------------------
// Unread count — Redis first, DB fallback
// ---------------------------------------------------------------------------
export async function getUnreadCount(userId) {
  try {
    const cached = await redis.get(UNREAD_KEY(userId));
    if (cached !== null) return parseInt(cached, 10);
  } catch {
    // Redis unavailable — fall through to DB (intentional fail-open read path:
    // unread count is not an authorization control).
  }

  const { rows } = await query(
    `SELECT COUNT(*) AS count FROM notifications
     WHERE user_id = $1 AND is_read = FALSE AND deleted_at IS NULL`,
    [userId]
  );

  const count = parseInt(rows[0].count, 10);
  await redis.setex(UNREAD_KEY(userId), 3600, String(count));
  return count;
}

// ---------------------------------------------------------------------------
// Get paginated notifications (decrypt on read)
// ---------------------------------------------------------------------------
export async function getNotifications(userId, { page = 1, limit = 20, type } = {}) {
  const offset = (page - 1) * limit;
  const params = [userId, limit, offset];
  const typeFilter = type ? (params.push(type), `AND type = $${params.length}`) : '';

  const { rows } = await query(
    `SELECT id, type, title, body, encryption_iv, entity_type, entity_id,
            is_read, read_at, created_at,
            COUNT(*) OVER() AS total_count
     FROM notifications
     WHERE user_id = $1 AND deleted_at IS NULL ${typeFilter}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    params
  );

  const total = rows[0]?.total_count ?? 0;

  // Decrypt in parallel
  const decrypted = await Promise.all(
    rows.map(async ({ total_count, ...n }) => {
      try {
        const [title, body] = await Promise.all([
          pgDecrypt(n.title),
          pgDecrypt(n.body),
        ]);
        return { ...n, title, body };
      } catch {
        // Row failed to decrypt — return placeholder text rather than
        // crashing the whole list (intentional best-effort read path).
        return { ...n, title: '[Encrypted]', body: '[Encrypted]' };
      }
    })
  );

  return {
    notifications: decrypted,
    total        : parseInt(total, 10),
    page,
    limit,
    unreadCount  : await getUnreadCount(userId),
  };
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------
export async function deleteNotification(notificationId, userId) {
  const { rows } = await query(
    `UPDATE notifications SET deleted_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id, is_read`,
    [notificationId, userId]
  );
  if (rows[0]) {
    await auditLog({ userId, action: 'DELETE', entity: 'notifications', entityId: notificationId, prevData: { id: notificationId, is_read: rows[0].is_read } });
    const current = await redis.get(UNREAD_KEY(userId));
    if (current && parseInt(current, 10) > 0) await redis.decr(UNREAD_KEY(userId));
  }
  return rows[0] ?? null;
}
