import { pool } from '../../shared/db/pool.js';

export async function listCaseNotes({ patientId, page = 1, limit = 50 }) {
  const conditions = ['cn.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (patientId) { conditions.push(`cn.patient_id = $${p++}`); params.push(patientId); }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT cn.*,
            pt.first_name AS patient_first_name, pt.last_name AS patient_last_name, pt.mrn,
            u.first_name  AS worker_first_name, u.last_name AS worker_last_name
     FROM case_notes cn
     JOIN patients pt ON pt.id = cn.patient_id
     LEFT JOIN users u ON u.id = cn.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY cn.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );
  return rows;
}

export async function createCaseNote(data, userId) {
  const { patientId, noteType, content, followUpDate } = data;
  const { rows } = await pool.query(
    `INSERT INTO case_notes (patient_id, note_type, content, follow_up_date, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [patientId, noteType ?? 'ASSESSMENT', content, followUpDate ?? null, userId]
  );
  return rows[0];
}

export async function updateCaseNote(id, data, userId) {
  const fields = [];
  const params = [];
  let p = 1;

  if (data.content     !== undefined) { fields.push(`content = $${p++}`);      params.push(data.content); }
  if (data.followUpDate !== undefined) { fields.push(`follow_up_date = $${p++}`); params.push(data.followUpDate); }
  if (data.resolved    !== undefined) { fields.push(`resolved = $${p++}`);     params.push(data.resolved); }

  if (!fields.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE case_notes SET ${fields.join(', ')} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!rows.length) throw Object.assign(new Error('Case note not found'), { status: 404 });
  return rows[0];
}
