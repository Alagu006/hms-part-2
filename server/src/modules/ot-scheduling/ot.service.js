import { pool }               from '../../shared/db/pool.js';
import { auditLog }           from '../../shared/middleware/audit.js';
import { createNotification } from '../../shared/services/notification.service.js';

// ---------------------------------------------------------------------------
// Create OT schedule (with conflict check)
// ---------------------------------------------------------------------------
export async function createOTSchedule(
  { patientId, doctorId, anesthetistId, theatre, scheduledAt, durationMinutes, procedure, status },
  createdBy, io, ip
) {
  const start = new Date(scheduledAt);
  const end   = new Date(start.getTime() + durationMinutes * 60_000);

  await checkConflict(theatre, start, end, null);

  // Resolve theatre room_id
  const { rows: roomRows } = await pool.query(
    `SELECT id FROM rooms WHERE room_number = $1 AND room_type = 'OT' AND deleted_at IS NULL LIMIT 1`,
    [theatre]
  );
  const roomId = roomRows[0]?.id ?? null;

  const { rows } = await pool.query(
    `INSERT INTO ot_schedules
       (id, patient_id, surgeon_id, anesthetist_id, room_id, procedure_name,
        scheduled_start, scheduled_end, status, created_by, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [patientId, doctorId, anesthetistId ?? null, roomId, procedure, start, end, status ?? 'SCHEDULED', createdBy]
  );
  const schedule = { ...rows[0], theatre };

  await auditLog({ userId: createdBy, action: 'CREATE', entity: 'ot_schedules', entityId: rows[0].id, nextData: rows[0], ip });
  await notifyOTParties(schedule, doctorId, anesthetistId, patientId, io, 'OT_SCHEDULED');

  return schedule;
}

// ---------------------------------------------------------------------------
// Get OT schedules
// ---------------------------------------------------------------------------
export async function getOTSchedules({ date, theatre, status }) {
  const conditions = ['os.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (date) {
    conditions.push(`DATE(os.scheduled_start) = $${p++}`);
    params.push(date);
  }
  if (theatre) {
    conditions.push(`r.room_number = $${p++}`);
    params.push(theatre);
  }
  if (status) {
    conditions.push(`os.status = $${p++}`);
    params.push(status);
  }

  const { rows } = await pool.query(
    `SELECT os.*,
            r.room_number AS theatre,
            p.first_name AS patient_first, p.last_name AS patient_last,
            d.first_name AS doctor_first,  d.last_name AS doctor_last,
            a.first_name AS anest_first,   a.last_name AS anest_last
     FROM ot_schedules os
     LEFT JOIN rooms r   ON r.id = os.room_id
     LEFT JOIN patients p ON p.id = os.patient_id
     LEFT JOIN users d   ON d.id = os.surgeon_id
     LEFT JOIN users a   ON a.id = os.anesthetist_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY os.scheduled_start`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Get single OT schedule
// ---------------------------------------------------------------------------
export async function getOTSchedule(id) {
  const { rows } = await pool.query(
    `SELECT os.*, r.room_number AS theatre,
            p.first_name AS patient_first, p.last_name AS patient_last,
            d.first_name AS doctor_first,  d.last_name AS doctor_last,
            a.first_name AS anest_first,   a.last_name AS anest_last
     FROM ot_schedules os
     LEFT JOIN rooms r   ON r.id = os.room_id
     LEFT JOIN patients p ON p.id = os.patient_id
     LEFT JOIN users d   ON d.id = os.surgeon_id
     LEFT JOIN users a   ON a.id = os.anesthetist_id
     WHERE os.id = $1 AND os.deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) { const e = new Error('OT schedule not found'); e.status = 404; throw e; }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Update OT schedule
// ---------------------------------------------------------------------------
export async function updateOTSchedule(id, updates, userId, io, ip) {
  const prev = await getOTSchedule(id);

  // Conflict check if time/theatre changed
  const theatre = updates.theatre ?? prev.theatre;
  const start   = updates.scheduledAt ? new Date(updates.scheduledAt) : new Date(prev.scheduled_start);
  const dur     = updates.durationMinutes ?? Math.round((new Date(prev.scheduled_end) - new Date(prev.scheduled_start)) / 60_000);
  const end     = new Date(start.getTime() + dur * 60_000);

  if (updates.scheduledAt || updates.theatre || updates.durationMinutes) {
    await checkConflict(theatre, start, end, id);
  }

  const fields = [];
  const params = [];
  let p = 1;

  const colMap = {
    patientId: 'patient_id', doctorId: 'surgeon_id', anesthetistId: 'anesthetist_id',
    procedure: 'procedure_name', status: 'status',
  };

  for (const [key, val] of Object.entries(updates)) {
    if (key === 'theatre' || key === 'scheduledAt' || key === 'durationMinutes') continue;
    const col = colMap[key] ?? key;
    fields.push(`${col} = $${p++}`);
    params.push(val);
  }

  if (updates.scheduledAt || updates.durationMinutes) {
    fields.push(`scheduled_start = $${p++}`, `scheduled_end = $${p++}`);
    params.push(start, end);
  }

  if (updates.theatre) {
    const { rows: roomRows } = await pool.query(
      `SELECT id FROM rooms WHERE room_number = $1 AND room_type = 'OT' AND deleted_at IS NULL LIMIT 1`,
      [updates.theatre]
    );
    fields.push(`room_id = $${p++}`);
    params.push(roomRows[0]?.id ?? null);
  }

  if (!fields.length) return prev;
  fields.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE ot_schedules SET ${fields.join(', ')} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!rows[0]) { const e = new Error('OT schedule not found'); e.status = 404; throw e; }

  await auditLog({ userId, action: 'UPDATE', entity: 'ot_schedules', entityId: id, prevData: prev, nextData: rows[0], ip });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Delete OT schedule (soft)
// ---------------------------------------------------------------------------
export async function deleteOTSchedule(id, userId, ip) {
  const { rows } = await pool.query(
    `UPDATE ot_schedules SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (!rows[0]) { const e = new Error('OT schedule not found'); e.status = 404; throw e; }
  await auditLog({ userId, action: 'DELETE', entity: 'ot_schedules', entityId: id, ip });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Conflict check: no two surgeries in same theatre at same time
// ---------------------------------------------------------------------------
async function checkConflict(theatre, start, end, excludeId) {
  const { rows: roomRows } = await pool.query(
    `SELECT id FROM rooms WHERE room_number = $1 AND room_type = 'OT' AND deleted_at IS NULL LIMIT 1`,
    [theatre]
  );
  if (!roomRows[0]) return; // room not found — skip check

  const params = [roomRows[0].id, start, end];
  let excludeClause = '';
  if (excludeId) { excludeClause = `AND id != $4`; params.push(excludeId); }

  const { rows } = await pool.query(
    `SELECT id FROM ot_schedules
     WHERE room_id = $1
       AND status NOT IN ('CANCELLED','COMPLETED')
       AND deleted_at IS NULL
       AND scheduled_start < $3
       AND scheduled_end   > $2
       ${excludeClause}`,
    params
  );
  if (rows.length) {
    const e = new Error(`Theatre ${theatre} is already booked during this time slot`);
    e.status = 409;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Notify all parties about OT schedule
// ---------------------------------------------------------------------------
async function notifyOTParties(schedule, doctorId, anesthetistId, patientId, io, type) {
  const msg = `OT scheduled: ${schedule.procedure_name} in ${schedule.theatre} at ${new Date(schedule.scheduled_start).toLocaleString()}`;

  const targets = new Set([doctorId]);
  if (anesthetistId) targets.add(anesthetistId);

  // Nurse assigned to patient
  const { rows: nurses } = await pool.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE ur.role = 'NURSE' AND u.is_active = TRUE AND u.deleted_at IS NULL
     LIMIT 5`
  );
  nurses.forEach(n => targets.add(n.id));

  // Receptionists
  const { rows: receps } = await pool.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE ur.role = 'RECEPTIONIST' AND u.is_active = TRUE AND u.deleted_at IS NULL
     LIMIT 5`
  );
  receps.forEach(r => targets.add(r.id));

  for (const uid of targets) {
    await createNotification(uid, 'OT_SCHEDULED', 'OT Scheduled', msg,
      { entityType: 'ot_schedules', entityId: schedule.id }, io
    ).catch(() => {});
  }
}
