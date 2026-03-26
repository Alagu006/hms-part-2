import { query } from '../../shared/db/pool.js';

export async function listHandoverNotes({ toNurseId, toShiftType, unreadOnly, patientId, page, limit }) {
  const offset   = (page - 1) * limit;
  const params   = [];
  const where    = ['hn.deleted_at IS NULL'];

  if (toNurseId) {
    params.push(toNurseId);
    where.push(`hn.to_nurse_id = $${params.length}`);
  }

  if (toShiftType) {
    params.push(toShiftType);
    where.push(`hn.to_shift_type = $${params.length}`);
  }

  if (unreadOnly) {
    where.push(`hn.is_read = FALSE`);
  }

  if (patientId) {
    params.push(patientId);
    where.push(`hn.patient_id = $${params.length}`);
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      hn.id, hn.priority, hn.note, hn.is_read, hn.created_at,
      hn.patient_id,
      p.mrn, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
      u_from.first_name || ' ' || u_from.last_name AS from_nurse_name,
      u_to.first_name   || ' ' || u_to.last_name   AS to_nurse_name,
      COUNT(*) OVER() AS total_count
    FROM handover_notes hn
    JOIN patients p ON p.id = hn.patient_id
    JOIN users u_from ON u_from.id = hn.from_nurse_id
    LEFT JOIN users u_to ON u_to.id = hn.to_nurse_id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE hn.priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH'   THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW'    THEN 4
      END,
      hn.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total   = rows[0]?.total_count ?? 0;
  const items   = rows.map(({ total_count, ...r }) => r);

  return { handoverNotes: items, total: parseInt(total, 10), page, limit };
}

export async function createHandoverNote(data, fromNurseId) {
  const { rows } = await query(
    `INSERT INTO handover_notes
       (id, from_nurse_id, to_nurse_id, to_shift_type, patient_id, priority, note, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [fromNurseId, data.toNurseId ?? null, data.toShiftType ?? null,
     data.patientId, data.priority, data.note]
  );
  return rows[0];
}

export async function markRead(noteId, nurseId) {
  const { rows } = await query(
    `UPDATE handover_notes
     SET is_read = TRUE, read_at = NOW()
     WHERE id = $1 AND (to_nurse_id = $2 OR to_nurse_id IS NULL)
     RETURNING *`,
    [noteId, nurseId]
  );
  return rows[0] ?? null;
}
