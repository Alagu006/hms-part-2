import { query, withTransaction } from '../../shared/db/pool.js';
import { auditLog }               from '../../shared/middleware/audit.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';

const BATCH_SIZE = 50; // fan-out in batches to avoid overwhelming the queue

// ---------------------------------------------------------------------------
// Create & fan out
// ---------------------------------------------------------------------------
export async function createBroadcast(data, sentBy, ip, userAgent, io) {
  const { title, message, priority, expiresAt } = data;

  // 1. Fetch all non-PATIENT active user IDs
  const { rows: users } = await query(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.is_active = TRUE
       AND u.deleted_at IS NULL
       AND ur.revoked_at IS NULL
       AND ur.role != 'PATIENT'`,
    []
  );

  const userIds    = users.map((u) => u.id);
  const totalCount = userIds.length;

  // 2. Fetch sender name for display
  const { rows: senderRows } = await query(
    `SELECT first_name, last_name FROM users WHERE id = $1`,
    [sentBy]
  );
  const senderName = senderRows[0]
    ? `${senderRows[0].first_name} ${senderRows[0].last_name}`
    : 'Admin';

  // 3. Persist broadcast record
  const { rows: bcRows } = await query(
    `INSERT INTO broadcasts
       (id, title, body, encryption_iv, target_roles, sent_by, sent_at, expires_at, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, 'plaintext', ARRAY[]::user_role[], $3, NOW(), $4, NOW())
     RETURNING *`,
    [title, message, sentBy, expiresAt ?? null]
  );
  const broadcast = bcRows[0];

  // 4. Audit log
  await auditLog({
    userId  : sentBy,
    action  : 'BROADCAST',
    entity  : 'broadcasts',
    entityId: broadcast.id,
    prevData: null,
    nextData: { title, priority, recipientCount: totalCount },
    ip,
    userAgent,
  });

  // 5. Fan-out notifications in batches (fire-and-forget after response)
  fanOutNotifications({
    broadcastId: broadcast.id,
    userIds,
    title,
    message,
    priority,
    senderName,
    sentBy,
    io,
  }).catch((err) => console.error('[broadcast] Fan-out error:', err.message));

  return { broadcast, totalCount };
}

async function fanOutNotifications({ broadcastId, userIds, title, message, priority, senderName, sentBy, io }) {
  const metadata = {
    entityType : 'BROADCAST',
    entityId   : broadcastId,
    priority,
    senderName,
    sentBy,
  };

  // Process in batches
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((userId) =>
        createNotification(
          userId,
          NotificationType.BROADCAST,
          `[${priority}] ${title}`,
          message,
          metadata,
          io
        )
      )
    );
  }

  // Emit real-time delivery count update to admin
  if (io) {
    io.of('/notifications').to(`user:${sentBy}`).emit('broadcast:delivered', {
      broadcastId,
      deliveredCount: userIds.length,
    });
  }
}

// ---------------------------------------------------------------------------
// List broadcasts
// ---------------------------------------------------------------------------
export async function listBroadcasts({ page, limit, priority }) {
  const offset = (page - 1) * limit;
  const params = [limit, offset];
  const where  = [];

  if (priority) {
    params.push(priority);
    where.push(`b.body LIKE $${params.length}`); // priority stored in notification title prefix
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT
       b.*,
       u.first_name || ' ' || u.last_name AS sender_name,
       COUNT(n.id)                         AS total_sent,
       COUNT(n.id) FILTER (WHERE n.is_read = TRUE) AS read_count,
       COUNT(*) OVER()                     AS total_count
     FROM broadcasts b
     JOIN users u ON u.id = b.sent_by
     LEFT JOIN notifications n ON n.entity_id = b.id AND n.entity_type = 'BROADCAST'
     ${whereClause}
     GROUP BY b.id, u.first_name, u.last_name
     ORDER BY b.sent_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    broadcasts: rows.map(({ total_count, ...r }) => r),
    total     : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Get broadcast by ID
// ---------------------------------------------------------------------------
export async function getBroadcastById(id) {
  const { rows } = await query(
    `SELECT b.*, u.first_name || ' ' || u.last_name AS sender_name,
            COUNT(n.id) AS total_sent,
            COUNT(n.id) FILTER (WHERE n.is_read = TRUE) AS read_count
     FROM broadcasts b
     JOIN users u ON u.id = b.sent_by
     LEFT JOIN notifications n ON n.entity_id = b.id AND n.entity_type = 'BROADCAST'
     WHERE b.id = $1
     GROUP BY b.id, u.first_name, u.last_name`,
    [id]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Read receipts — who has seen the broadcast
// ---------------------------------------------------------------------------
export async function getReadReceipts(broadcastId, { page, limit }) {
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT
       u.id, u.first_name, u.last_name,
       n.is_read, n.read_at, n.created_at AS delivered_at,
       COUNT(*) OVER() AS total_count
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     WHERE n.entity_id = $1 AND n.entity_type = 'BROADCAST'
     ORDER BY n.is_read DESC, n.read_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [broadcastId, limit, offset]
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    receipts: rows.map(({ total_count, ...r }) => r),
    total   : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Staff count (for confirmation modal)
// ---------------------------------------------------------------------------
export async function getStaffCount() {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT u.id) AS count
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.is_active = TRUE
       AND u.deleted_at IS NULL
       AND ur.revoked_at IS NULL
       AND ur.role != 'PATIENT'`,
    []
  );
  return parseInt(rows[0].count, 10);
}
