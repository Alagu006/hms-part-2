import { query, withTransaction } from '../../shared/db/pool.js';
import { redis }                  from '../../shared/services/redis.service.js';

const PUBSUB_CHANNEL = 'messaging:events';
const DELETE_WINDOW  = 5 * 60 * 1000; // 5 minutes in ms

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
export async function getUserGroups(userId) {
  const { rows } = await query(
    `SELECT
       mg.id, mg.name, mg.type, mg.created_at,
       -- last message (content is ciphertext — never decoded server-side)
       lm.id          AS last_msg_id,
       lm.content     AS last_msg_content,
       lm.encryption_iv AS last_msg_iv,
       lm.sent_at     AS last_msg_at,
       lm_u.first_name || ' ' || lm_u.last_name AS last_msg_sender,
       -- unread count
       COUNT(m.id) FILTER (
         WHERE m.sent_at > COALESCE(mgm.last_read_at, '1970-01-01')
           AND m.sender_id != $1
           AND m.is_deleted = FALSE
       ) AS unread_count
     FROM message_group_members mgm
     JOIN message_groups mg ON mg.id = mgm.group_id
     LEFT JOIN LATERAL (
       SELECT * FROM messages
       WHERE group_id = mg.id AND is_deleted = FALSE
       ORDER BY sent_at DESC LIMIT 1
     ) lm ON TRUE
     LEFT JOIN users lm_u ON lm_u.id = lm.sender_id
     LEFT JOIN messages m ON m.group_id = mg.id
     WHERE mgm.user_id = $1 AND mgm.left_at IS NULL AND mg.deleted_at IS NULL
     GROUP BY mg.id, mg.name, mg.type, mg.created_at,
              lm.id, lm.content, lm.encryption_iv, lm.sent_at,
              lm_u.first_name, lm_u.last_name
     ORDER BY COALESCE(lm.sent_at, mg.created_at) DESC`,
    [userId]
  );
  return rows;
}

export async function createGroup(name, type, creatorId, memberIds = []) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO message_groups (id, name, type, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING *`,
      [name, type, creatorId]
    );
    const group = rows[0];

    const allMembers = [...new Set([creatorId, ...memberIds])];
    for (const uid of allMembers) {
      await client.query(
        `INSERT INTO message_group_members (id, group_id, user_id, role, joined_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
        [group.id, uid, uid === creatorId ? 'ADMIN' : 'MEMBER']
      );
    }
    return group;
  });
}

export async function getGroupMembers(groupId) {
  const { rows } = await query(
    `SELECT u.id, u.first_name, u.last_name, mgm.role, u.last_login_at
     FROM message_group_members mgm
     JOIN users u ON u.id = mgm.user_id
     WHERE mgm.group_id = $1 AND mgm.left_at IS NULL`,
    [groupId]
  );
  return rows;
}

export async function isMember(groupId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM message_group_members
     WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [groupId, userId]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export async function saveMessage({ groupId, senderId, content, encryptionIv, replyToId }) {
  // content is ciphertext — stored as-is, never inspected
  const { rows } = await query(
    `INSERT INTO messages
       (id, group_id, sender_id, content, encryption_iv, reply_to_id, sent_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
     RETURNING id, group_id, sender_id, content, encryption_iv, reply_to_id, sent_at`,
    [groupId, senderId, content, encryptionIv, replyToId ?? null]
  );

  await query(
    `UPDATE message_groups SET updated_at = NOW() WHERE id = $1`,
    [groupId]
  );

  return rows[0];
}

export async function getGroupHistory(groupId, userId, { page = 1, limit = 50 } = {}) {
  const member = await isMember(groupId, userId);
  if (!member) return 'FORBIDDEN';

  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT
       m.id, m.content, m.encryption_iv, m.sent_at, m.edited_at,
       m.is_deleted, m.reply_to_id,
       m.sender_id,
       u.first_name || ' ' || u.last_name AS sender_name,
       COUNT(*) OVER() AS total_count,
       -- reactions as JSON array
       COALESCE(
         json_agg(
           json_build_object('emoji', mr.emoji, 'userId', mr.user_id)
         ) FILTER (WHERE mr.emoji IS NOT NULL),
         '[]'
       ) AS reactions
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN message_reactions mr ON mr.message_id = m.id
     WHERE m.group_id = $1
     GROUP BY m.id, m.content, m.encryption_iv, m.sent_at, m.edited_at,
              m.is_deleted, m.reply_to_id, m.sender_id, u.first_name, u.last_name
     ORDER BY m.sent_at DESC
     LIMIT $2 OFFSET $3`,
    [groupId, limit, offset]
  );

  // Update last_read_at for this user
  await query(
    `UPDATE message_group_members SET last_read_at = NOW()
     WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    messages: rows.map(({ total_count, ...r }) => r).reverse(),
    total   : parseInt(total, 10),
    page,
    limit,
  };
}

export async function getDMHistory(userId, otherUserId, { page = 1, limit = 50 } = {}) {
  // Find or create DM group between two users
  const { rows: existing } = await query(
    `SELECT mg.id FROM message_groups mg
     JOIN message_group_members a ON a.group_id = mg.id AND a.user_id = $1 AND a.left_at IS NULL
     JOIN message_group_members b ON b.group_id = mg.id AND b.user_id = $2 AND b.left_at IS NULL
     WHERE mg.type = 'DIRECT'
     LIMIT 1`,
    [userId, otherUserId]
  );

  let groupId = existing[0]?.id;
  if (!groupId) {
    const group = await createGroup(null, 'DIRECT', userId, [otherUserId]);
    groupId = group.id;
  }

  return getGroupHistory(groupId, userId, { page, limit });
}

export async function deleteMessage(messageId, userId) {
  const { rows } = await query(
    `SELECT * FROM messages WHERE id = $1 AND is_deleted = FALSE`,
    [messageId]
  );
  if (!rows[0]) return null;

  const msg     = rows[0];
  const ageMs   = Date.now() - new Date(msg.sent_at).getTime();
  const isOwner = msg.sender_id === userId;

  if (!isOwner) return 'FORBIDDEN';

  const deleteForEveryone = ageMs <= DELETE_WINDOW;

  if (deleteForEveryone) {
    await query(
      `UPDATE messages SET is_deleted = TRUE, content = '', encryption_iv = '', deleted_at = NOW()
       WHERE id = $1`,
      [messageId]
    );
  } else {
    // Delete for me only — store in a per-user hidden list
    await query(
      `INSERT INTO message_hidden (id, message_id, user_id, hidden_at)
       VALUES (gen_random_uuid(), $1, $2, NOW())
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [messageId, userId]
    );
  }

  return { messageId, deleteForEveryone };
}

export async function addReaction(messageId, userId, emoji) {
  // Upsert reaction
  await query(
    `INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, NOW())
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
    [messageId, userId, emoji]
  );

  const { rows } = await query(
    `SELECT emoji, user_id FROM message_reactions WHERE message_id = $1`,
    [messageId]
  );
  return rows;
}

export async function removeReaction(messageId, userId, emoji) {
  await query(
    `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [messageId, userId, emoji]
  );
}

export async function getPinnedMessages(groupId) {
  const { rows } = await query(
    `SELECT m.id, m.content, m.encryption_iv, m.sent_at,
            u.first_name || ' ' || u.last_name AS sender_name,
            pm.pinned_at, pm.pinned_by
     FROM pinned_messages pm
     JOIN messages m ON m.id = pm.message_id
     JOIN users    u ON u.id = m.sender_id
     WHERE pm.group_id = $1
     ORDER BY pm.pinned_at DESC`,
    [groupId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Redis pub/sub helpers
// ---------------------------------------------------------------------------
export async function publishEvent(event, payload) {
  await redis.publish(PUBSUB_CHANNEL, JSON.stringify({ event, payload }));
}

export { PUBSUB_CHANNEL };

export async function markGroupRead(groupId, userId) {
  await query(
    `UPDATE message_group_members SET last_read_at = NOW()
     WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
}

export async function getReactions(messageId) {
  return query(
    `SELECT emoji, user_id FROM message_reactions WHERE message_id = $1`,
    [messageId]
  );
}

export async function markMessageRead(messageId, userId) {
  const { rows } = await query(
    `SELECT id FROM messages WHERE id = $1`,
    [messageId]
  );
  if (!rows[0]) return null;

  await query(
    `INSERT INTO message_reads (id, message_id, user_id, read_at)
     VALUES (gen_random_uuid(), $1, $2, NOW())
     ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = NOW()`,
    [messageId, userId]
  );

  return { messageId, userId };
}
