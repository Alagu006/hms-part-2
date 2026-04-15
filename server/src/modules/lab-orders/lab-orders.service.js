import { query } from '../../shared/db/pool.js';
import { pgEncrypt, pgDecrypt } from '../../shared/db/pgcrypto.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';

export async function listLabOrders({ status, priority, date, patientId, page, limit }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where  = ['lo.deleted_at IS NULL'];

  if (status)    { params.push(status);    where.push(`lo.status = $${params.length}`); }
  if (priority)  { params.push(priority);  where.push(`lo.priority = $${params.length}`); }
  if (date)      { params.push(date);      where.push(`DATE(lo.ordered_at) = $${params.length}`); }
  if (patientId) { params.push(patientId); where.push(`lo.patient_id = $${params.length}`); }

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

export async function createLabOrder(data, orderedBy, io) {
  // Ensure the patient has a medical record; create one if not
  const { rows: mrRows } = await query(
    `INSERT INTO medical_records (id, patient_id, attending_doctor_id, visit_date, created_at, updated_at)
     SELECT gen_random_uuid(), $1, $2, NOW(), NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM medical_records WHERE patient_id = $1 AND deleted_at IS NULL)
     RETURNING id`,
    [data.patientId, orderedBy]
  );

  // Now fetch the latest (just created or pre-existing)
  const { rows: latestMr } = await query(
    `SELECT id FROM medical_records WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [data.patientId]
  );
  const medicalRecordId = latestMr[0]?.id;
  if (!medicalRecordId) throw Object.assign(new Error('Could not resolve medical record for patient'), { status: 500 });

  const { rows } = await query(
    `INSERT INTO lab_orders
       (id, medical_record_id, patient_id, ordered_by, test_name, test_code, priority, status, notes, ordered_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PENDING', $7, NOW(), NOW(), NOW())
     RETURNING *`,
    [medicalRecordId, data.patientId, orderedBy, data.testName, data.testCode ?? null, data.priority ?? 'ROUTINE', data.notes ?? null]
  );
  const order = rows[0];

  const { rows: patRows } = await query(
    `SELECT first_name, last_name FROM patients WHERE id = $1`,
    [data.patientId]
  );
  const patientName = patRows[0]
    ? `${patRows[0].first_name} ${patRows[0].last_name}`
    : 'Unknown';

  const { rows: labTechs } = await query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE ur.role = 'LAB_TECH' AND u.is_active = TRUE AND u.deleted_at IS NULL`
  );

  await Promise.all(
    labTechs.map((lt) =>
      createNotification(
        lt.id,
        NotificationType.LAB_ORDER_CREATED,
        'New Lab Test Ordered',
        `${data.priority ?? 'ROUTINE'} — ${data.testName} ordered for patient ${patientName}.`,
        { entityType: 'LAB_ORDER', entityId: order.id },
        io
      )
    )
  );

  return order;
}

export async function updateLabOrder(id, data) {
  const setClauses = [];
  const params     = [];

  if (data.status !== undefined)     { params.push(data.status);     setClauses.push(`status = $${params.length}`); }
  if (data.assignedTo !== undefined) { params.push(data.assignedTo); setClauses.push(`assigned_to = $${params.length}`); }
  if (data.notes !== undefined)      { params.push(data.notes);      setClauses.push(`notes = $${params.length}`); }

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

export async function createLabResult(data, performedBy, io) {
  const resultText = data.resultData ?? data.resultText ?? '';
  const interpretation = data.interpretation ?? '';

  const [encResultData, encInterpretation] = await Promise.all([
    pgEncrypt(resultText || 'See attached file'),
    pgEncrypt(interpretation || ''),
  ]);

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
      encResultData,
      encInterpretation,
      data.isAbnormal ?? false,
      data.referenceRange ?? null,
    ]
  );
  const result = rows[0];

  // Notify the ordering doctor
  const { rows: orderRows } = await query(
    `SELECT lo.ordered_by, lo.test_name, p.first_name, p.last_name
     FROM lab_orders lo
     JOIN patients p ON p.id = lo.patient_id
     WHERE lo.id = $1`,
    [data.labOrderId]
  );
  if (orderRows[0]) {
    const { ordered_by, test_name, first_name, last_name } = orderRows[0];
    await createNotification(
      ordered_by,
      NotificationType.LAB_RESULT_UPLOADED,
      'Lab Result Ready',
      `Result for ${test_name} — ${first_name} ${last_name} is now available.`,
      { entityType: 'LAB_RESULT', entityId: result.id },
      io
    );
  }

  return result;
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

export async function getLabResultById(id) {
  const { rows } = await query(
    `SELECT lr.*,
            p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
            u.first_name || ' ' || u.last_name AS performed_by_name,
            lo.test_name, lo.test_code, lo.ordered_at
     FROM lab_results lr
     JOIN lab_orders lo ON lo.id = lr.lab_order_id
     JOIN patients p ON p.id = lo.patient_id
     JOIN users u ON u.id = lr.performed_by
     WHERE lr.id = $1 AND lr.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getPatientLabResults(patientId, { page, limit }) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT
       lr.id, lr.is_abnormal, lr.reference_range, lr.performed_at, lr.created_at,
       lr.result_data, lr.interpretation,
       lo.id AS order_id, lo.test_name, lo.test_code, lo.ordered_at, lo.priority, lo.status AS order_status,
       u.first_name || ' ' || u.last_name AS performed_by_name,
       f.id AS file_id, f.original_name AS file_name, f.mime_type AS file_mime,
       COUNT(*) OVER() AS total_count
     FROM lab_results lr
     JOIN lab_orders lo ON lo.id = lr.lab_order_id
     JOIN users u ON u.id = lr.performed_by
     LEFT JOIN files f ON f.entity_type = 'LAB_RESULT' AND f.entity_id = lr.id AND f.is_deleted = FALSE
     WHERE lr.patient_id = $1
     ORDER BY lr.performed_at DESC
     LIMIT $2 OFFSET $3`,
    [patientId, limit, offset]
  );

  const total = rows[0]?.total_count ?? 0;

  const decrypted = await Promise.all(
    rows.map(async ({ total_count, ...r }) => {
      try {
        const [resultData, interpretation] = await Promise.all([
          pgDecrypt(r.result_data),
          pgDecrypt(r.interpretation),
        ]);
        return { ...r, result_data: resultData, interpretation };
      } catch {
        return { ...r, result_data: '[Encrypted]', interpretation: '[Encrypted]' };
      }
    })
  );

  return { results: decrypted, total: parseInt(total, 10), page, limit };
}
