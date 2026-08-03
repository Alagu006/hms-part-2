import { pool } from '../../shared/db/pool.js';
import { redis } from '../../shared/services/redis.service.js';
import { pgEncrypt } from '../../shared/db/pgcrypto.js';
import { sendTempPassword } from '../../shared/services/email.service.js';
import { getOrCreateDepartmentGroup } from '../messaging/messaging.service.js';
import argon2 from 'argon2';
import crypto from 'crypto';
import { logger } from '../../shared/logger.js';

// Normalize PostgreSQL array_agg results which can come back as '{VAL1,VAL2}' strings
function normalizePgArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return [];
}

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
export async function getAuditLogs({ userId, role, action, entity, severity, dateFrom, dateTo, flagged, page = 1, limit = 50 }) {
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (userId)   { conditions.push(`al.user_id = $${p++}`);       params.push(userId); }
  if (action)   { conditions.push(`al.action ILIKE $${p++}`);    params.push(`%${action}%`); }
  if (entity)   { conditions.push(`al.entity ILIKE $${p++}`);    params.push(`%${entity}%`); }
  if (dateFrom) { conditions.push(`al.created_at >= $${p++}`);   params.push(dateFrom); }
  if (dateTo)   { conditions.push(`al.created_at <= $${p++}`);   params.push(dateTo); }
  if (flagged === 'true')  { conditions.push('al.flagged = TRUE'); }
  if (flagged === 'false') { conditions.push('al.flagged = FALSE'); }

  let roleJoin = '';
  if (role) {
    roleJoin = `JOIN user_roles ur ON ur.user_id = al.user_id AND ur.revoked_at IS NULL`;
    conditions.push(`ur.role = $${p++}`);
    params.push(role);
  }

  const offset = (page - 1) * limit;
  const limitIdx  = p++;
  const offsetIdx = p++;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       al.id, al.user_id, al.action, al.entity, al.entity_id,
       al.prev_data, al.next_data, al.ip_address, al.user_agent,
       al.prev_hash, al.row_hash, al.created_at,
       al.flagged, al.flag_reason, al.flagged_at,
       u.first_name, u.last_name, u.employee_id,
       fu.first_name AS flagged_by_first, fu.last_name AS flagged_by_last
     FROM audit_logs al
     LEFT JOIN users u  ON u.id  = al.user_id
     LEFT JOIN users fu ON fu.id = al.flagged_by
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
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
// Verifies that each row's prev_hash matches the previous row's row_hash
// ---------------------------------------------------------------------------
export async function verifyAuditChain() {
  const { rows } = await pool.query(
    `SELECT id, prev_hash, row_hash, created_at
     FROM audit_logs
     ORDER BY created_at ASC`
  );

  if (rows.length === 0) {
    return { valid: true, totalChecked: 0 };
  }

  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1];
    const curRow  = rows[i];

    if (curRow.prev_hash !== prevRow.row_hash) {
      return {
        valid          : false,
        firstTamperedId: curRow.id,
        totalChecked   : i,
        checkedUntil   : i,
      };
    }
  }

  return { valid: true, totalChecked: rows.length };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function getUsers({ role, department, status, search, page = 1, limit = 50 }) {
  const conditions = ['u.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (department) { conditions.push(`u.department_id = $${p++}`); params.push(department); }
  if (status === 'active')   { conditions.push(`u.is_active = TRUE`); }
  if (status === 'inactive') { conditions.push(`u.is_active = FALSE`); }
  if (search) {
    conditions.push(`(u.employee_id ILIKE $${p} OR (u.first_name || ' ' || u.last_name) ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }

  let roleJoin = '';
  if (role) {
    roleJoin = `JOIN user_roles ur2 ON ur2.user_id = u.id AND ur2.revoked_at IS NULL AND ur2.role = $${p++}`;
    params.push(role);
  }

  const offset = (page - 1) * limit;
  const limitIdx = p++;
  const offsetIdx = p++;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       u.id, u.employee_id, u.first_name, u.last_name,
       u.is_active, u.must_change_password, u.last_login_at,
       u.created_at, u.department_id, u.profile_image_file_id,
       d.name AS department_name,
       pat.mrn AS patient_mrn,
       array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL AND ur.revoked_at IS NULL) AS roles
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN patients pat ON pat.user_id = u.id AND pat.deleted_at IS NULL
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}
     GROUP BY u.id, d.name, pat.mrn
     ORDER BY u.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return rows.map(u => ({ ...u, roles: normalizePgArray(u.roles) }));
}


export async function createUser({ firstName, lastName, email, phone, role, departmentId, dateOfBirth, gender, bloodGroup, address, emergencyContact, specialization, licenseNumber, shiftType }, actorId) {
  const tempPassword = crypto.randomBytes(16).toString('base64url');

  // Privileged roles may only be granted by a SUPER_ADMIN (prevents HR/admin
  // privilege escalation via /admin/users).
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
    const { rows: actorRows } = await pool.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'SUPER_ADMIN' AND revoked_at IS NULL LIMIT 1`,
      [actorId]
    );
    if (!actorRows[0]) {
      throw Object.assign(
        new Error('Only a SUPER_ADMIN can create ADMIN accounts'),
        { status: 403 }
      );
    }
  }

  const [emailEnc, phoneEnc, passwordHash] = await Promise.all([
    pgEncrypt(email),
    phone ? pgEncrypt(phone) : Promise.resolve(null),
    argon2.hash(tempPassword, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 }),
  ]);

  const employeeId = `${role.slice(0, 3).toUpperCase()}${Date.now().toString().slice(-6)}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, employee_id,
         department_id, date_of_birth, gender, blood_group, address, emergency_contact,
         must_change_password, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, TRUE, NOW(), NOW())
       RETURNING id, employee_id, first_name, last_name`,
      [firstName, lastName, emailEnc, phoneEnc, passwordHash, employeeId,
       departmentId || null, dateOfBirth || null, gender || null,
       bloodGroup || null, address || null, emergencyContact || null]
    );

    const user = rows[0];

    await client.query(
      `INSERT INTO user_roles (user_id, role, granted_by, granted_at)
       VALUES ($1, $2, $3, NOW())`,
      [user.id, role, actorId]
    );

    // If the role is PATIENT, create the corresponding patients record
    if (role === 'PATIENT') {
      const mrn = `MRN-${Date.now().toString().slice(-6)}`;
      await client.query(
        `INSERT INTO patients (mrn, first_name, last_name, date_of_birth, gender, user_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, '1900-01-01', 'PREFER_NOT_TO_SAY', $4, $5, NOW(), NOW())`,
        [mrn, firstName, lastName, user.id, actorId]
      );
    }

    await client.query('COMMIT');

    // Send welcome email with temp password (fire-and-forget)
    sendTempPassword(email, user.employee_id, tempPassword).catch(err =>
      logger.error('[admin] Failed to queue welcome email', { message: err.message })
    );

    // Auto-join department group if user has a department (fire-and-forget)
    if (departmentId && role !== 'PATIENT') {
      getOrCreateDepartmentGroup(departmentId, user.id, actorId)
        .catch(err => logger.error('[admin] Dept group auto-join failed', { message: err.message }));
    }

    // Auto-join General Staff group for all non-patient staff
    if (role !== 'PATIENT') {
      getOrCreateDepartmentGroup(null, user.id, actorId, 'General Staff')
        .catch(err => logger.error('[admin] General group auto-join failed', { message: err.message }));
    }

    return { ...user, role, email, tempPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateUser(targetId, fields, actorId) {
  const allowed = ['firstName','lastName','phone','departmentId','dateOfBirth',
                   'gender','bloodGroup','address','emergencyContact',
                   'specialization','licenseNumber','shiftType','profileImageFileId'];
  const setClauses = [];
  const params = [];
  let p = 1;

  for (const key of allowed) {
    if (fields[key] === undefined) continue;
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (key === 'phone' && fields[key]) {
      params.push(await pgEncrypt(fields[key]));
    } else {
      params.push(fields[key] ?? null);
    }
    setClauses.push(`${col} = $${p++}`);
  }

  if (!setClauses.length) {
    const err = new Error('No updatable fields provided');
    err.status = 422;
    throw err;
  }

  setClauses.push(`updated_at = NOW()`);
  params.push(targetId);

  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')}
     WHERE id = $${p} AND deleted_at IS NULL
     RETURNING id, first_name, last_name, employee_id, is_active, profile_image_file_id`,
    params
  );
  if (!rows[0]) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

export async function deleteUser(targetId, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE users SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [targetId]
    );
    if (!rows[0]) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }

    // Also soft-delete the linked patient record if one exists
    await client.query(
      `UPDATE patients SET deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [targetId]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    results.map(([, v]) => {
      if (!v) return null;
      try { return JSON.parse(v).userId; } catch { return null; }
    }).filter(Boolean)
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
    const raw = results[i][1];
    if (!raw) return null;
    let userId, sessionId;
    try { ({ userId, sessionId } = JSON.parse(raw)); } catch { return null; }
    // redisToken is the actual key suffix used to delete from Redis
    const redisToken = key.replace('refresh:', '');
    const user = userMap[userId] || {};
    const roles = normalizePgArray(user.roles);
    return {
      sessionId : redisToken,   // used by forceLogout to delete the Redis key
      dbSessionId: sessionId,   // the DB session UUID (for reference)
      userId,
      firstName : user.first_name,
      lastName  : user.last_name,
      employeeId: user.employee_id,
      roles,
    };
  }).filter(Boolean);
}

export async function forceLogout(sessionId, io) {
  const key = `refresh:${sessionId}`;
  const raw = await redis.get(key);
  if (!raw) {
    const err = new Error('Session not found');
    err.status = 404;
    throw err;
  }
  let userId;
  try { ({ userId } = JSON.parse(raw)); } catch { userId = raw; }
  await redis.del(key);

  // Push force:logout via the io instance passed from the controller
  if (io) {
    try {
      const rooms = [`user:${userId}`];
      for (const ns of ['/', '/messaging', '/notifications', '/telemedicine']) {
        io.of(ns).to(rooms).emit('force:logout', { reason: 'Session terminated by administrator' });
      }
    } catch (e) {
      logger.error('[forceLogout] socket push failed', { message: e.message });
    }
  }

  return { sessionId, userId };
}

// ---------------------------------------------------------------------------
// Flag an audit log entry
// ---------------------------------------------------------------------------
export async function flagAuditLog(logId, reason, actorId) {
  const { rows } = await pool.query(
    `UPDATE audit_logs
     SET flagged = TRUE, flag_reason = $1, flagged_by = $2, flagged_at = NOW()
     WHERE id = $3
     RETURNING id, flagged, flag_reason, flagged_at`,
    [reason || null, actorId, logId]
  );
  if (!rows[0]) {
    const err = new Error('Audit log entry not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

export async function unflagAuditLog(logId) {
  const { rows } = await pool.query(
    `UPDATE audit_logs
     SET flagged = FALSE, flag_reason = NULL, flagged_by = NULL, flagged_at = NULL
     WHERE id = $1
     RETURNING id, flagged`,
    [logId]
  );
  if (!rows[0]) {
    const err = new Error('Audit log entry not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Blocked IPs
// ---------------------------------------------------------------------------
const BLOCKED_IPS_CACHE_KEY = 'security:blocked_ips';
const BLOCKED_IPS_CACHE_TTL = 60; // 1 minute

export async function getBlockedIps() {
  const { rows } = await pool.query(
    `SELECT bi.id, bi.ip_address, bi.reason, bi.blocked_at, bi.expires_at, bi.unblocked_at,
            u.first_name || ' ' || u.last_name AS blocked_by_name
     FROM blocked_ips bi
     LEFT JOIN users u ON u.id = bi.blocked_by
     ORDER BY bi.blocked_at DESC`
  );
  return rows;
}

export async function blockIp(ipAddress, reason, actorId, expiresAt) {
  const { rows } = await pool.query(
    `INSERT INTO blocked_ips (ip_address, reason, blocked_by, expires_at)
     VALUES ($1::inet, $2, $3, $4)
     ON CONFLICT (ip_address) DO UPDATE
       SET reason = EXCLUDED.reason,
           blocked_by = EXCLUDED.blocked_by,
           blocked_at = NOW(),
           expires_at = EXCLUDED.expires_at,
           unblocked_at = NULL,
           unblocked_by = NULL
     RETURNING id, ip_address, reason, blocked_at, expires_at`,
    [ipAddress, reason || null, actorId, expiresAt || null]
  );
  // Invalidate cache
  await redis.del(BLOCKED_IPS_CACHE_KEY);
  return rows[0];
}

export async function unblockIp(id, actorId) {
  const { rows } = await pool.query(
    `UPDATE blocked_ips
     SET unblocked_at = NOW(), unblocked_by = $1
     WHERE id = $2 AND unblocked_at IS NULL
     RETURNING id, ip_address`,
    [actorId, id]
  );
  if (!rows[0]) {
    const err = new Error('Blocked IP not found or already unblocked');
    err.status = 404;
    throw err;
  }
  await redis.del(BLOCKED_IPS_CACHE_KEY);
  return rows[0];
}

export async function isIpBlocked(ipAddress) {
  // Redis is only a cache — blocked_ips in Postgres is the source of truth.
  // A Redis outage must NOT fail or hang the check. With the BullMQ-required
  // maxRetriesPerRequest:null, a command against an unavailable Redis would
  // block in the offline queue for the whole reconnect backoff (~minutes), so
  // when the client is not ready we skip the cache read entirely and go
  // straight to Postgres. Any other cache read error logs and falls through
  // the same way.
  let cached = null;
  if (redis.status === 'ready') {
    try {
      cached = await redis.get(BLOCKED_IPS_CACHE_KEY);
    } catch (err) {
      logger.error('[ipblock] Redis cache read failed — falling through to Postgres:', { message: err.message });
    }
  }

  if (cached) {
    try {
      const list = JSON.parse(cached);
      return list.some((ip) => ip === ipAddress);
    } catch { /* fall through */ }
  }

  const { rows } = await pool.query(
    `SELECT ip_address FROM blocked_ips
     WHERE unblocked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
  );
  const blockedList = rows.map((r) => r.ip_address);

  // Best-effort cache re-population — skip it when the client is not ready
  // (same offline-queue hang) and never let a cache write fail the check.
  if (redis.status === 'ready') {
    try {
      await redis.setex(BLOCKED_IPS_CACHE_KEY, BLOCKED_IPS_CACHE_TTL, JSON.stringify(blockedList));
    } catch (err) {
      logger.error('[ipblock] Redis cache write failed (best-effort):', { message: err.message });
    }
  }
  return blockedList.includes(ipAddress);
}
