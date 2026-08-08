import { query } from '../../shared/db/pool.js';
import { pgEncrypt, pgDecrypt } from '../../shared/db/pgcrypto.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { logger } from '../../shared/logger.js';

async function decryptSafe(value) {
  try { return await pgDecrypt(value); } catch { return null; }
}

async function decryptApptRow(row) {
  if (!row) return null;
  const [reason, notes, cancellationReason] = await Promise.all([
    decryptSafe(row.reason),
    decryptSafe(row.notes),
    decryptSafe(row.cancellation_reason),
  ]);
  return { ...row, reason, notes, cancellation_reason: cancellationReason };
}

export async function listAppointments({ doctorId, patientId, date, status, page, limit }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where  = ['a.deleted_at IS NULL'];

  if (doctorId) {
    params.push(doctorId);
    where.push('a.doctor_id = $' + params.length);
  }
  if (patientId) {
    params.push(patientId);
    where.push('a.patient_id = $' + params.length);
  }
  if (date) {
    params.push(date);
    where.push('DATE(a.scheduled_at) = $' + params.length);
  }
  if (status) {
    params.push(status);
    where.push('a.status = $' + params.length);
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      a.id, a.patient_id, a.doctor_id, a.department_id,
      a.scheduled_at, a.duration_minutes, a.type,
      a.status, a.reason, a.notes, a.cancellation_reason,
      p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
      u.first_name AS doctor_first_name, u.last_name AS doctor_last_name,
      d.name AS department_name,
      COUNT(*) OVER() AS total_count
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users u ON u.id = a.doctor_id
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.scheduled_at ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const items    = await Promise.all(rows.map(({ total_count, ...r }) => decryptApptRow(r)));

  return { appointments: items, total: parseInt(total, 10), page, limit };
}

export async function getAppointmentById(id) {
  const { rows } = await query(
    `SELECT
       a.*,
       p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.mrn,
       u.first_name AS doctor_first_name, u.last_name AS doctor_last_name,
       d.name AS department_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN users u ON u.id = a.doctor_id
     LEFT JOIN departments d ON d.id = a.department_id
     WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [id]
  );
  return decryptApptRow(rows[0] ?? null);
}

export async function updateAppointmentStatus(id, { status, notes }, cancelledBy) {
  const { rows } = await query(
    `UPDATE appointments
     SET status = $1,
         notes = COALESCE($2, notes),
         cancelled_by = $3,
         cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN NOW() ELSE cancelled_at END,
         updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL
     RETURNING *`,
    [status, notes != null ? await pgEncrypt(notes) : null, cancelledBy ?? null, id]
  );
  return decryptApptRow(rows[0] ?? null);
}

export async function patientUpdateAppointment(id, patientUserId, { action, cancellationReason, scheduledAt, type, reason }) {
  // Verify ownership — patient can only touch their own SCHEDULED appointments
  const { rows: own } = await query(
    `SELECT a.id FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = $1 AND p.user_id = $2 AND a.status = 'SCHEDULED' AND a.deleted_at IS NULL`,
    [id, patientUserId]
  );
  if (!own[0]) return null;

  if (action === 'cancel') {
    const { rows } = await query(
      `UPDATE appointments
       SET status = 'CANCELLED', cancellation_reason = $1,
           cancelled_by = (SELECT id FROM patients WHERE user_id = $2),
           cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [cancellationReason != null ? await pgEncrypt(cancellationReason) : null, patientUserId, id]
    );
    return decryptApptRow(rows[0] ?? null);
  }

  // action === 'update'
  const { rows } = await query(
    `UPDATE appointments
     SET scheduled_at = COALESCE($1, scheduled_at),
         type         = COALESCE($2, type),
         reason       = COALESCE($3, reason),
         updated_at   = NOW()
     WHERE id = $4 RETURNING *`,
    [scheduledAt ?? null, type ?? null, reason != null ? await pgEncrypt(reason) : null, id]
  );
  return decryptApptRow(rows[0] ?? null);
}

export async function createAppointment(data, createdBy) {
  const { rows } = await query(
    `INSERT INTO appointments
       (id, patient_id, doctor_id, department_id, scheduled_at, duration_minutes,
        type, status, reason, created_by, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'SCHEDULED', $7, $8, NOW(), NOW())
     RETURNING *`,
    [data.patientId, data.doctorId, data.departmentId ?? null,
     data.scheduledAt, data.durationMinutes, data.type,
     data.reason != null ? await pgEncrypt(data.reason) : null, createdBy]
  );
  const appt = await decryptApptRow(rows[0]);

  // Notify patient
  setImmediate(async () => {
    try {
      const { rows: patRows } = await query(
        'SELECT user_id FROM patients WHERE id = $1', [data.patientId]
      );
      const { rows: docRows } = await query(
        'SELECT first_name, last_name FROM users WHERE id = $1', [data.doctorId]
      );
      if (patRows[0] && docRows[0]) {
        const dt = new Date(data.scheduledAt);
        const timeStr = dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        const isTele = data.type === 'TELEMEDICINE';
        await createNotification(
          patRows[0].user_id,
          NotificationType.APPOINTMENT_BOOKED,
          isTele ? 'Telemedicine appointment booked' : 'Appointment booked',
          'Your ' + (isTele ? 'video consultation' : 'appointment') + ' with Dr. ' +
            docRows[0].first_name + ' ' + docRows[0].last_name + ' is on ' + timeStr +
            (isTele ? '. Join from My Appointments when it is time.' : '.'),
          { entityType: 'APPOINTMENT', entityId: appt.id, priority: 'MEDIUM' }
        );
      }
    } catch (err) {
      logger.error('[appointments] Post-create notification failed', { message: err.message });
    }
  });

  return appt;
}
