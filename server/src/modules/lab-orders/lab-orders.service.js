import { query } from '../../shared/db/pool.js';
import { pgEncrypt, pgDecrypt } from '../../shared/db/pgcrypto.js';

const RESULT_FIELDS = ['result_data', 'interpretation'];

export async function listLabOrders({ status, priority, date, patientId, page, limit }) {
  const offset   = (page - 1) * limit;
  const params   = [];
  const where    = ['lo.deleted_at IS NULL'];

  if (status) {
    params.push(status);
    where.push(`lo.status = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    where.push(`lo.priority = $${params.length}`);
  }
  if (date) {
    params.push(date);
    where.push(`DATE(lo.ordered_at) = $${params.length}`);
  }
  if (patientId) {
    params.push(patientId);
    where.push(`lo.patient_id = $${params.length}`);
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      lo.id, lo.test_name, lo.test_code, lo.priority, lo.status,
      lo.ordered_at, lo.collected_at, lo.notes,
      lo.patient_id,
      p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
      u_order.first_name || ' ' || u_order.last_name AS ordered_by_name,
      u_assign.first_name || ' ' || u_assign.last_name AS assigned_to_name,
      COUNT(*) OVER() AS total_count
    FROM lab_orders lo
    JOIN patients p ON p.id = lo.patient_id
    JOIN users u_order ON u_order.id = lo.ordered_by
    LEFT JOIN users u_assign ON u_assign.id = lo.assigned_to
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE lo.priority
        WHEN 'STAT'    THEN 1
        WHEN 'URGENT'  THEN 2
        WHEN 'ROUTINE' THEN 3
      END,
      lo.ordered_at ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const items    = rows.map(({ total_count, ...r }) => r);

  return { labOrders: items, total: parseInt(total, 10), page, limit };
}

export async function updateLabOrder(id, data) {
  const setClauses = [];
  const params     = [];

  if (data.status !== undefined) {
    params.push(data.status);
    setClauses.push(`status = $${params.length}`);
  }
  if (data.assignedTo !== undefined) {
    params.push(data.assignedTo);
    setClauses.push(`assigned_to = $${params.length}`);
  }
  if (data.notes !== undefined) {
    params.push(data.notes);
    setClauses.push(`notes = $${params.length}`);
  }

  if (setClauses.length === 0) return null;

  params.push(id);
  const { rows } = await query(
    `UPDATE lab_orders SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params
  );

  return rows[0] ?? null;
}

export async function createLabResult(data, performedBy) {
  const enc = await pgEncrypt({
    result_data   : data.resultData ?? '',
    interpretation: data.interpretation ?? '',
  }, RESULT_FIELDS);

  const { rows } = await query(
    `INSERT INTO lab_results
       (id, lab_order_id, patient_id, performed_by, result_data, interpretation,
        is_abnormal, reference_range, performed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
     RETURNING *`,
    [
      data.labOrderId,
      (await getLabOrderPatient(data.labOrderId)),
      performedBy,
      enc.result_data,
      enc.interpretation,
      data.isAbnormal ?? false,
      data.referenceRange ?? null,
    ]
  );

  return rows[0];
}

async function getLabOrderPatient(orderId) {
  const { rows } = await query(
    `SELECT patient_id FROM lab_orders WHERE id = $1`,
    [orderId]
  );
  return rows[0]?.patient_id;
}

export async function getLabOrderById(id) {
  const { rows } = await query(
    `SELECT lo.*,
            p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
            u.first_name || ' ' || u.last_name AS ordered_by_name
     FROM lab_orders lo
     JOIN patients p ON p.id = lo.patient_id
     JOIN users u ON u.id = lo.ordered_by
     WHERE lo.id = $1 AND lo.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}
