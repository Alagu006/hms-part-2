import { query } from '../../shared/db/pool.js';

export async function listShifts({ userId, departmentId, shiftDate, shiftType, page, limit }) {
  const offset   = (page - 1) * limit;
  const params   = [];
  const where    = ['s.deleted_at IS NULL'];

  if (userId) {
    params.push(userId);
    where.push(`s.user_id = $${params.length}`);
  }
  if (departmentId) {
    params.push(departmentId);
    where.push(`s.department_id = $${params.length}`);
  }
  if (shiftDate) {
    params.push(shiftDate);
    where.push(`s.shift_date = $${params.length}`);
  }
  if (shiftType) {
    params.push(shiftType);
    where.push(`s.shift_type = $${params.length}`);
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      s.id, s.user_id, s.department_id, s.shift_type,
      s.shift_date, s.start_time, s.end_time, s.status, s.notes,
      u.first_name, u.last_name, u.employee_id,
      d.name AS department_name,
      COUNT(*) OVER() AS total_count
    FROM shift_schedules s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.shift_date DESC, s.start_time ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const items    = rows.map(({ total_count, ...r }) => r);

  return { shifts: items, total: parseInt(total, 10), page, limit };
}

export async function createShift(data, createdBy) {
  const { rows } = await query(
    `INSERT INTO shift_schedules
       (id, user_id, department_id, shift_type, shift_date, start_time, end_time, notes, created_by, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (user_id, shift_date, shift_type) DO NOTHING
     RETURNING *`,
    [data.userId, data.departmentId ?? null, data.shiftType,
     data.shiftDate, data.startTime, data.endTime, data.notes ?? null, createdBy]
  );
  return rows[0] ?? null;
}

export async function deleteShift(id) {
  const { rows } = await query(
    `UPDATE shift_schedules SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}
