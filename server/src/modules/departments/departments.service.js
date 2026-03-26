import { query } from '../../shared/db/pool.js';

export async function listDepartments({ search, isActive, page, limit }) {
  const offset      = (page - 1) * limit;
  const params     = [];
  const conditions = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(d.name ILIKE $${params.length} OR d.code ILIKE $${params.length})`);
  }

  if (isActive !== undefined) {
    params.push(isActive);
    conditions.push(`d.is_active = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      d.id, d.name, d.code, d.head_of_department,
      d.floor, d.is_active, d.created_at, d.updated_at,
      u.first_name AS hod_first_name, u.last_name AS hod_last_name,
      COUNT(*) OVER() AS total_count
    FROM departments d
    LEFT JOIN users u ON u.id = d.head_of_department
    ${where}
    ORDER BY d.name ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const items    = rows.map(({ total_count, ...r }) => r);

  return { departments: items, total: parseInt(total, 10), page, limit };
}

export async function createDepartment(data, createdBy) {
  const { rows } = await query(
    `INSERT INTO departments (id, name, code, head_of_department, floor, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [data.name, data.code, data.headOfDepartmentId ?? null, data.floor ?? null]
  );
  return rows[0];
}

export async function updateDepartment(id, data) {
  const setClauses = [];
  const params     = [];

  if (data.name !== undefined) {
    params.push(data.name);
    setClauses.push(`name = $${params.length}`);
  }
  if (data.headOfDepartmentId !== undefined) {
    params.push(data.headOfDepartmentId);
    setClauses.push(`head_of_department = $${params.length}`);
  }
  if (data.floor !== undefined) {
    params.push(data.floor);
    setClauses.push(`floor = $${params.length}`);
  }
  if (data.isActive !== undefined) {
    params.push(data.isActive);
    setClauses.push(`is_active = $${params.length}`);
  }

  if (setClauses.length === 0) return null;

  params.push(id);
  const { rows } = await query(
    `UPDATE departments SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params
  );

  return rows[0] ?? null;
}
