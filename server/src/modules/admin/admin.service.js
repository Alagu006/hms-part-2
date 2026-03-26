import crypto from 'crypto';
import { pool } from '../../shared/db/pool.js';
import { redis } from '../../shared/db/redis.js';

const STATS_CACHE_KEY = 'admin:stats';
const STATS_CACHE_TTL = 5 * 60; // 5 minutes

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
export async function getStats() {
  const cached = await redis.get(STATS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  const [admissions, beds, revenue, users, failedLogins] = await Promise.all([
    // Today's admissions
    pool.query(
      `SELECT COUNT(*) AS count FROM patients
       WHERE DATE(created_at) = CURRENT_DATE AND deleted_at IS NULL`
    ),
    // Bed occupancy
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'occupied') AS occupied,
         COUNT(*) AS total
       FROM beds WHERE deleted_at IS NULL`
    ),
    // Pending revenue
    pool.query(
      `SELECT
         COALESCE(SUM(net_amount), 0) AS pending_revenue,
         COUNT(*) AS pending_bills
       FROM bills
       WHERE status = 'unpaid' AND deleted_at IS NULL`
    ),
    // Active users
    pool.query(
      `SELECT COUNT(*) AS count FROM users
       WHERE is_active = TRUE AND deleted_at IS NULL`
    ),
    // Failed logins in last 24h from audit_logs
    pool.query(
      `SELECT COUNT(*) AS count FROM audit_logs
       WHERE action = 'LOGIN_FAILED'
         AND created_at >= NOW() - INTERVAL '24 hours'`
    ),
  ]);

  const stats = {
    todayAdmissions: parseInt(admissions.rows[0].count, 10),
    bedOccupancy: {
      occupied: parseInt(beds.rows[0].occupied, 10),
      total   : parseInt(beds.rows[0].total, 10),
    },
    pendingRevenue: parseFloat(revenue.rows[0].pending_revenue),
    pendingBills  : parseInt(revenue.rows[0].pending_bills, 10),
    activeUsers   : parseInt(users.rows[0].count, 10),
    failedLogins24h: parseInt(failedLogins.rows[0].count, 10),
  };

  await redis.setex(STATS_CACHE_KEY, STATS_CACHE_TTL, JSON.stringify(stats));
  return stats;
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------
export async function getAuditLogs({ userId, role, action, entity, severity, dateFrom, dateTo, page = 1, limit = 50 }) {
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (userId) { conditions.push(`al.user_id = $${p++}`); params.push(userId); }
  if (action) { conditions.push(`al.action ILIKE $${p++}`); params.push(`%${action}%`); }
  if (entity) { conditions.push(`al.entity ILIKE $${p++}`); params.push(`%${entity}%`); }
  if (dateFrom) { conditions.push(`al.created_at >= $${p++}`); params.push(dateFrom); }
  if (dateTo)   { conditions.push(`al.created_at <= $${p++}`); params.push(dateTo); }

  // role filter joins user_roles
  let roleJoin = '';
  if (role) {
    roleJoin = `JOIN user_roles ur ON ur.user_id = al.user_id AND ur.revoked_at IS NULL`;
    conditions.push(`ur.role = $${p++}`);
    params.push(role);
  }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       al.id, al.user_id, al.action, al.entity, al.entity_id,
       al.prev_data, al.next_data, al.ip_address, al.user_agent,
       al.prev_hash, al.row_hash, al.created_at,
       u.first_name, u.last_name, u.employee_id
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );

  const countParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}`,
    countParams
  );

  return {
    rows,
    total: parseInt(countRows[0].total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Audit log hash chain verification
// ---------------------------------------------------------------------------
export async function verifyAuditChain() {
  const { rows } = await pool.query(
    `SELECT id, user_id, action, entity, entity_id,
            prev_data, next_data, ip_address, prev_hash, row_hash, created_at
     FROM audit_logs
     ORDER BY created_at ASC`
  );

  const results = [];
  let firstBrokenId = null;

  for (const row of rows) {
    const rowContent = JSON.stringify({
      userId  : row.user_id,
      action  : row.action,
      entity  : row.entity,
      entityId: row.entity_id,
      prevData: row.prev_data ? JSON.parse(row.prev_data) : null,
      nextData: row.next_data ? JSON.parse(row.next_data) : null,
      ip      : row.ip_address,
      prevHash: row.prev_hash,
      ts      : new Date(row.created_at).toISOString(),
    });

    const computed = crypto.createHash('sha256').update(rowContent).digest('hex');
    const intact   = computed === row.row_hash;

    if (!intact && !firstBrokenId) firstBrokenId = row.id;

    results.push({
      id       : row.id,
      action   : row.action,
      entity   : row.entity,
      createdAt: row.created_at,
      intact,
    });
  }

  return { results, firstBrokenId, totalRows: rows.length };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function getUsers({ role, department, status, page = 1, limit = 50 }) {
  const conditions = ['u.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (department) { conditions.push(`u.department_id = $${p++}`); params.push(department); }
  if (status === 'active')   { conditions.push(`u.is_active = TRUE`); }
  if (status === 'inactive') { conditions.push(`u.is_active = FALSE`); }

  let roleJoin = '';
  if (role) {
    roleJoin = `JOIN user_roles ur2 ON ur2.user_id = u.id AND ur2.revoked_at IS NULL AND ur2.role = $${p++}`;
    params.push(role);
  }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       u.id, u.employee_id, u.first_name, u.last_name,
       u.is_active, u.must_change_password, u.last_login_at,
       u.created_at, u.department_id,
       d.name AS department_name,
       array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}
     GROUP BY u.id, d.name
     ORDER BY u.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );

  return rows;
}

export async function setUserStatus(targetId, isActive, actorId) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING id, is_active`,
    [isActive, targetId]
  );
  if (!rows[0]) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function getActiveSessions() {
  // Scan all refresh:* keys
  const keys = await redis.keys('refresh:*');
  if (!keys.length) return [];

  const pipeline = redis.pipeline();
  keys.forEach((k) => pipeline.get(k));
  const results = await pipeline.exec();

  const userIds = [...new Set(
    results.map(([, v]) => v).filter(Boolean)
  )];

  if (!userIds.length) return [];

  const { rows: users } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.employee_id,
            array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = ANY($1::uuid[])
     GROUP BY u.id`,
    [userIds]
  );

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return keys.map((key, i) => {
    const userId = results[i][1];
    const user   = userMap[userId] || {};
    return {
      sessionId : key.replace('refresh:', ''),
      userId,
      firstName : user.first_name,
      lastName  : user.last_name,
      employeeId: user.employee_id,
      roles     : user.roles ?? [],
    };
  }).filter((s) => s.userId);
}

export async function forceLogout(sessionId) {
  const key    = `refresh:${sessionId}`;
  const userId = await redis.get(key);
  if (!userId) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }
  await redis.del(key);
  return { sessionId, userId };
}
