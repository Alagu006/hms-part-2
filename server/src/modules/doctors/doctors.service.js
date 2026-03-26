import { query } from '../../shared/db/pool.js';

export async function listDoctors({ departmentId, search, page, limit }) {
  const offset   = (page - 1) * limit;
  const params   = [];
  const where    = ['u.is_active = TRUE', 'u.deleted_at IS NULL'];

  if (departmentId) {
    params.push(departmentId);
    where.push(`u.department_id = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`(u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`);
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      u.id, u.first_name, u.last_name, u.employee_id,
      d.id AS department_id, d.name AS department_name, d.code AS department_code,
      COUNT(*) OVER() AS total_count
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE ${where.join(' AND ')}
      AND ur.role = 'DOCTOR'
    ORDER BY u.first_name, u.last_name
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const items    = rows.map(({ total_count, ...r }) => r);

  return { doctors: items, total: parseInt(total, 10), page, limit };
}
