import { query, withTransaction } from '../../shared/db/pool.js';
import { pgEncryptFields, pgDecryptFields } from '../../shared/db/pgcrypto.js';

const ENCRYPTED_FIELDS = ['visitor_name', 'visitor_phone', 'id_number'];

async function decryptRow(row) {
  if (!row) return null;
  return pgDecryptFields(row, ENCRYPTED_FIELDS);
}

async function decryptRows(rows) {
  return Promise.all(rows.map(decryptRow));
}

export async function logVisitor(data, loggedBy, ip, userAgent) {
  const encrypted = await pgEncryptFields(data, ENCRYPTED_FIELDS.filter(f => data[f] != null));

  const { rows } = await query(
    `INSERT INTO visitor_logs
       (id, patient_id, visitor_name, visitor_phone, relationship,
        id_type, id_number, purpose, checked_in_at, approved_by, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), $8, NOW())
     RETURNING *`,
    [
      data.patientId,
      encrypted.visitor_name ?? null,
      encrypted.visitor_phone ?? null,
      data.relationship ?? null,
      data.idType ?? null,
      encrypted.id_number ?? null,
      data.purpose ?? null,
      loggedBy,
    ]
  );

  return decryptRow(rows[0]);
}

export async function getVisitorHistory(patientId, { page, limit }) {
  const offset      = (page - 1) * limit;
  const limitIdx    = 2;
  const offsetIdx   = 3;

  const sql = `
    SELECT
      v.id, v.patient_id, v.visitor_name, v.visitor_phone,
      v.relationship, v.id_type, v.id_number, v.purpose,
      v.checked_in_at, v.checked_out_at, v.badge_number,
      u.first_name || ' ' || u.last_name AS approved_by_name,
      COUNT(*) OVER() AS total_count
    FROM visitor_logs v
    LEFT JOIN users u ON u.id = v.approved_by
    WHERE v.patient_id = $1
    ORDER BY v.checked_in_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, [patientId, limit, offset]);
  const total   = rows[0]?.total_count ?? 0;
  const items   = await decryptRows(rows.map(({ total_count, ...r }) => r));

  return { visitors: items, total: parseInt(total, 10), page, limit };
}

export async function checkoutVisitor(id, approvedBy) {
  const { rows } = await query(
    `UPDATE visitor_logs
     SET checked_out_at = NOW(), approved_by = $2
     WHERE id = $1 AND checked_out_at IS NULL
     RETURNING *`,
    [id, approvedBy]
  );
  return rows[0] ? decryptRow(rows[0]) : null;
}
