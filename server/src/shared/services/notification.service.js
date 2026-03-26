import { query }        from '../db/pool.js';
import { pgEncrypt, pgDecrypt } from '../db/pgcrypto.js';
import { redis }        from './redis.service.js';
import { sendPushNotification } from './webpush.service.js';

// ---------------------------------------------------------------------------
// Notification type enum
// ---------------------------------------------------------------------------
export const NotificationType = Object.freeze({
  APPOINTMENT_BOOKED    : 'APPOINTMENT_BOOKED',
  LAB_RESULT_UPLOADED   : 'LAB_RESULT_UPLOADED',
  PRESCRIPTION_ISSUED   : 'PRESCRIPTION_ISSUED',
  LEAVE_APPROVED        : 'LEAVE_APPROVED',
  LEAVE_REJECTED        : 'LEAVE_REJECTED',
  PATIENT_ASSIGNED      : 'PATIENT_ASSIGNED',
  LOW_STOCK             : 'LOW_STOCK',
  BROADCAST             : 'BROADCAST',
  NEW_MESSAGE           : 'NEW_MESSAGE',
  TELEMEDICINE_REMINDER : 'TELEMEDICINE_REMINDER',
  BILL_GENERATED        : 'BILL_GENERATED',
  EQUIPMENT_MAINTENANCE : 'EQUIPMENT_MAINTENANCE',
  DRUG_INTERACTION_WARN : 'DRUG_INTERACTION_WARN',
  VITALS_CRITICAL       : 'VITALS_CRITICAL',
  OT_SCHEDULED          : 'OT_SCHEDULED',
  BLOOD_REQUEST         : 'BLOOD_REQUEST',
  EMERGENCY_ALERT       : 'EMERGENCY_ALERT',
});

// High-priority types that trigger a toast on the client
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
 * @param {string}  userId
 * @param {string}  type        — NotificationType value
 * @param {string}  title       — plaintext
 * @param {string}  body        — plaintext
 * @param {object}  [metadata]  — { entityType, entityId, ...extra }
 * @param {object}  [io]        — Socket.io server instance (optional)
 */
export async function createNotification(userId, type, title, body, metadata = {}, io = null) {
  // Encrypt title + body at rest
  const [encTitle, encBody, encIv] = await Promise.all([
    pgEncrypt(title),
    pgEncrypt(body),
    pgEncrypt(JSON.stringify(metadata)),
  ]);

  // Generate a single IV placeholder — pgcrypto manages its own IV internally,
  // but we store a reference string for the client-side AES layer
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
  }).catch((err) => console.warn('[notification] Push failed:', err.message));

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
    // Decrement Redis counter (floor at 0)
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
  await query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW()
     WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  await redis.set(UNREAD_KEY(userId), '0');
}

// ---------------------------------------------------------------------------
// Unread count — Redis first, DB fallback
// ---------------------------------------------------------------------------
export async function getUnreadCount(userId) {
  try {
    const cached = await redis.get(UNREAD_KEY(userId));
    if (cached !== null) return parseInt(cached, 10);
  } catch {
    // Redis unavailable — fall through to DB
  }

  const { rows } = await query(
    `SELECT COUNT(*) AS count FROM notifications
     WHERE user_id = $1 AND is_read = FALSE AND deleted_at IS NULL`,
    [userId]
  );

  const count = parseInt(rows[0].count, 10);
  // Repopulate Redis
  await redis.setex(UNREAD_KEY(userId), 3600, String(count));
  return count;
}

// ---------------------------------------------------------------------------
// Get paginated notifications (decrypt on read)
// ---------------------------------------------------------------------------
export async function getNotifications(userId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT id, type, title, body, encryption_iv, entity_type, entity_id,
            is_read, read_at, created_at,
            COUNT(*) OVER() AS total_count
     FROM notifications
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
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
  if (rows[0] && !rows[0].is_read) {
    const current = await redis.get(UNREAD_KEY(userId));
    if (current && parseInt(current, 10) > 0) await redis.decr(UNREAD_KEY(userId));
  }
  return rows[0] ?? null;
}
