import { pool } from '../../shared/db/pool.js';
import { auditLog } from '../../shared/middleware/audit.js';
import { createNotification } from '../../shared/services/notification.service.js';

// Default annual allocations per leave type
const DEFAULT_BALANCES = {
  ANNUAL      : 15,
  SICK        : 12,
  EMERGENCY   : 5,
  MATERNITY   : 90,
  PATERNITY   : 7,
  UNPAID      : 0,
  COMPENSATORY: 0,
};

const LEAVE_TYPES = ['ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','EMERGENCY','COMPENSATORY'];

// ---------------------------------------------------------------------------
// Seed default balances for a new user (called from user creation)
// ---------------------------------------------------------------------------
export async function seedLeaveBalances(userId, client) {
  const year = new Date().getFullYear();
  const db   = client ?? pool;

  const values = Object.entries(DEFAULT_BALANCES).map(([type, days]) =>
    `(gen_random_uuid(), '${userId}', '${type}', ${year}, ${days}, 0, 0, NOW())`
  ).join(',\n');

  await db.query(
    `INSERT INTO leave_balances (id, user_id, leave_type, year, total_days, used_days, pending_days, updated_at)
     VALUES ${values}
     ON CONFLICT (user_id, leave_type, year) DO NOTHING`
  );
}

// ---------------------------------------------------------------------------
// Apply for leave
// ---------------------------------------------------------------------------
export async function applyLeave({ userId, leaveType, startDate, endDate, reason }, ip) {
  if (!LEAVE_TYPES.includes(leaveType)) {
    const err = new Error(`Invalid leave type: ${leaveType}`);
    err.status = 400;
    throw err;
  }

  const start = new Date(startDate);
  const end   = new Date(endDate);
  if (end < start) {
    const err = new Error('end_date must be >= start_date');
    err.status = 400;
    throw err;
  }

  // Business days count (Mon–Fri)
  const daysCount = countBusinessDays(start, end);
  if (daysCount <= 0) {
    const err = new Error('Leave must include at least one working day');
    err.status = 400;
    throw err;
  }

  const year = start.getFullYear();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock balance row for this user+type+year
    const { rows: balRows } = await client.query(
      `SELECT * FROM leave_balances
       WHERE user_id = $1 AND leave_type = $2 AND year = $3
       FOR UPDATE`,
      [userId, leaveType, year]
    );

    // Auto-seed if missing
    if (!balRows[0]) {
      await seedLeaveBalances(userId, client);
      const { rows } = await client.query(
        `SELECT * FROM leave_balances
         WHERE user_id = $1 AND leave_type = $2 AND year = $3 FOR UPDATE`,
        [userId, leaveType, year]
      );
      balRows[0] = rows[0];
    }

    const bal = balRows[0];
    const available = parseFloat(bal.total_days) - parseFloat(bal.used_days) - parseFloat(bal.pending_days);

    if (leaveType !== 'UNPAID' && available < daysCount) {
      const err = new Error(
        `Insufficient ${leaveType} balance. Available: ${available}, Requested: ${daysCount}`
      );
      err.status = 422;
      throw err;
    }

    // Check for overlapping approved/pending leaves
    const { rows: overlap } = await client.query(
      `SELECT id FROM leaves
       WHERE user_id = $1
         AND status IN ('PENDING','APPROVED')
         AND deleted_at IS NULL
         AND start_date <= $3 AND end_date >= $2`,
      [userId, startDate, endDate]
    );
    if (overlap.length) {
      const err = new Error('You already have a leave request overlapping these dates');
      err.status = 409;
      throw err;
    }

    // Insert leave
    const { rows: leaveRows } = await client.query(
      `INSERT INTO leaves
         (id, user_id, leave_type, start_date, end_date, days_count, reason, status, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PENDING', NOW(), NOW())
       RETURNING *`,
      [userId, leaveType, startDate, endDate, daysCount, reason ?? null]
    );

    // Increment pending_days
    await client.query(
      `UPDATE leave_balances
       SET pending_days = pending_days + $1, updated_at = NOW()
       WHERE user_id = $2 AND leave_type = $3 AND year = $4`,
      [daysCount, userId, leaveType, year]
    );

    await client.query('COMMIT');

    await auditLog({ userId, action: 'CREATE', entity: 'leaves', entityId: leaveRows[0].id, nextData: leaveRows[0], ip });
    return leaveRows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// My leaves + balances
// ---------------------------------------------------------------------------
export async function getMyLeaves(userId) {
  const year = new Date().getFullYear();

  const [leavesRes, balRes] = await Promise.all([
    pool.query(
      `SELECT l.*,
              u.first_name AS reviewer_first, u.last_name AS reviewer_last
       FROM leaves l
       LEFT JOIN users u ON u.id = l.reviewed_by
       WHERE l.user_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC`,
      [userId]
    ),
    pool.query(
      `SELECT leave_type, total_days, used_days, pending_days,
              (total_days - used_days - pending_days) AS available_days
       FROM leave_balances
       WHERE user_id = $1 AND year = $2`,
      [userId, year]
    ),
  ]);

  return { leaves: leavesRes.rows, balances: balRes.rows };
}

// ---------------------------------------------------------------------------
// All leaves (HR/ADMIN)
// ---------------------------------------------------------------------------
export async function getAllLeaves({ role, department, status, dateFrom, dateTo, page = 1, limit = 50 }) {
  const conditions = ['l.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (status)   { conditions.push(`l.status = $${p++}`);     params.push(status); }
  if (dateFrom) { conditions.push(`l.start_date >= $${p++}`); params.push(dateFrom); }
  if (dateTo)   { conditions.push(`l.end_date <= $${p++}`);   params.push(dateTo); }
  if (department) {
    conditions.push(`u.department_id = $${p++}`);
    params.push(department);
  }

  let roleJoin = '';
  if (role) {
    roleJoin = `JOIN user_roles ur ON ur.user_id = l.user_id AND ur.revoked_at IS NULL AND ur.role = $${p++}`;
    params.push(role);
  }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       l.*,
       u.first_name, u.last_name, u.employee_id,
       d.name AS department_name,
       rv.first_name AS reviewer_first, rv.last_name AS reviewer_last,
       lb.total_days, lb.used_days, lb.pending_days,
       (lb.total_days - lb.used_days - lb.pending_days) AS available_days
     FROM leaves l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN users rv ON rv.id = l.reviewed_by
     LEFT JOIN leave_balances lb
       ON lb.user_id = l.user_id
       AND lb.leave_type = l.leave_type
       AND lb.year = EXTRACT(YEAR FROM l.start_date)::INT
     ${roleJoin}
     WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Approve — atomic balance deduction
// ---------------------------------------------------------------------------
export async function approveLeave(leaveId, reviewerId, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: leaveRows } = await client.query(
      `SELECT * FROM leaves WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [leaveId]
    );
    const leave = leaveRows[0];
    if (!leave) { const e = new Error('Leave not found'); e.status = 404; throw e; }
    if (leave.status !== 'PENDING') {
      const e = new Error(`Cannot approve a leave with status: ${leave.status}`);
      e.status = 409;
      throw e;
    }

    const year = new Date(leave.start_date).getFullYear();

    // Lock balance
    const { rows: balRows } = await client.query(
      `SELECT * FROM leave_balances
       WHERE user_id = $1 AND leave_type = $2 AND year = $3 FOR UPDATE`,
      [leave.user_id, leave.leave_type, year]
    );
    const bal = balRows[0];
    if (!bal) { const e = new Error('Balance record not found'); e.status = 500; throw e; }

    const available = parseFloat(bal.total_days) - parseFloat(bal.used_days) - parseFloat(bal.pending_days);
    if (leave.leave_type !== 'UNPAID' && available < parseFloat(leave.days_count)) {
      const e = new Error('Insufficient balance to approve this leave');
      e.status = 422;
      throw e;
    }

    // Update leave status
    const { rows: updated } = await client.query(
      `UPDATE leaves
       SET status = 'APPROVED', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reviewerId, leaveId]
    );

    // Deduct: move pending → used
    await client.query(
      `UPDATE leave_balances
       SET used_days    = used_days    + $1,
           pending_days = GREATEST(pending_days - $1, 0),
           updated_at   = NOW()
       WHERE user_id = $2 AND leave_type = $3 AND year = $4`,
      [leave.days_count, leave.user_id, leave.leave_type, year]
    );

    await client.query('COMMIT');

    // Notify applicant
    await createNotification(
      leave.user_id,
      'LEAVE',
      'Leave Approved',
      `Your ${leave.leave_type} leave (${leave.start_date} – ${leave.end_date}) has been approved.`,
      { entityType: 'leaves', entityId: leaveId }
    );

    await auditLog({
      userId  : reviewerId,
      action  : 'APPROVE',
      entity  : 'leaves',
      entityId: leaveId,
      prevData: { status: 'PENDING' },
      nextData: { status: 'APPROVED' },
      ip,
    });

    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------
export async function rejectLeave(leaveId, reviewerId, reviewNote, ip) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: leaveRows } = await client.query(
      `SELECT * FROM leaves WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [leaveId]
    );
    const leave = leaveRows[0];
    if (!leave) { const e = new Error('Leave not found'); e.status = 404; throw e; }
    if (leave.status !== 'PENDING') {
      const e = new Error(`Cannot reject a leave with status: ${leave.status}`);
      e.status = 409;
      throw e;
    }

    const year = new Date(leave.start_date).getFullYear();

    const { rows: updated } = await client.query(
      `UPDATE leaves
       SET status = 'REJECTED', reviewed_by = $1, reviewed_at = NOW(),
           review_note = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reviewerId, reviewNote ?? null, leaveId]
    );

    // Release pending days
    await client.query(
      `UPDATE leave_balances
       SET pending_days = GREATEST(pending_days - $1, 0), updated_at = NOW()
       WHERE user_id = $2 AND leave_type = $3 AND year = $4`,
      [leave.days_count, leave.user_id, leave.leave_type, year]
    );

    await client.query('COMMIT');

    await createNotification(
      leave.user_id,
      'LEAVE',
      'Leave Rejected',
      `Your ${leave.leave_type} leave request was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
      { entityType: 'leaves', entityId: leaveId }
    );

    await auditLog({
      userId  : reviewerId,
      action  : 'REJECT',
      entity  : 'leaves',
      entityId: leaveId,
      prevData: { status: 'PENDING' },
      nextData: { status: 'REJECTED', reviewNote },
      ip,
    });

    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Balances for a user
// ---------------------------------------------------------------------------
export async function getBalances(userId) {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT leave_type, total_days, used_days, pending_days,
            (total_days - used_days - pending_days) AS available_days
     FROM leave_balances
     WHERE user_id = $1 AND year = $2`,
    [userId, year]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Calendar — who is on leave per date
// ---------------------------------------------------------------------------
export async function getLeaveCalendar({ month, year, department }) {
  const params = [year, month];
  let p = 3;
  const extra = [];

  if (department) {
    extra.push(`u.department_id = $${p++}`);
    params.push(department);
  }

  const extraWhere = extra.length ? `AND ${extra.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.days_count,
       u.first_name, u.last_name,
       d.name AS department_name
     FROM leaves l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE l.status = 'APPROVED'
       AND l.deleted_at IS NULL
       AND EXTRACT(YEAR FROM l.start_date)::INT <= $1
       AND EXTRACT(YEAR FROM l.end_date)::INT   >= $1
       AND EXTRACT(MONTH FROM l.start_date)::INT <= $2
       AND EXTRACT(MONTH FROM l.end_date)::INT   >= $2
       ${extraWhere}
     ORDER BY l.start_date`,
    params
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countBusinessDays(start, end) {
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
