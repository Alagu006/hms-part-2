import { pool, withTransaction } from '../../shared/db/pool.js';
import { auditLog }           from '../../shared/middleware/audit.js';
import { createNotification } from '../../shared/services/notification.service.js';
import { pgEncrypt, pgDecrypt } from '../../shared/db/pgcrypto.js';

async function decryptNotes(row) {
  if (!row?.notes) return row;
  try { row.notes = await pgDecrypt(row.notes); } catch { row.notes = null; }
  return row;
}

// ---------------------------------------------------------------------------
// Create OT schedule (with conflict check)
// ---------------------------------------------------------------------------
export async function createOTSchedule(
  { patientId, doctorId, anesthetistId, theatre, scheduledAt, durationMinutes, procedure, status, notes },
  createdBy, io, ip
) {
  const start = new Date(scheduledAt);
  const end   = new Date(start.getTime() + durationMinutes * 60_000);
  const encryptedNotes = notes != null ? await pgEncrypt(notes) : null;

  // Conflict check + INSERT must be atomic: two concurrent bookings for the
  // same theatre could otherwise both pass the overlap check and double-book.
  // Locking the room row FOR UPDATE serialises bookings per theatre.
  const [row] = await withTransaction(async (client) => {
    const roomId = await checkConflict(client, theatre, start, end, null);
    const { rows } = await client.query(
      `INSERT INTO ot_schedules
         (id, patient_id, surgeon_id, anesthetist_id, room_id, procedure_name,
          scheduled_start, scheduled_end, status, notes, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [patientId, doctorId, anesthetistId ?? null, roomId, procedure, start, end, status ?? 'SCHEDULED', encryptedNotes, createdBy]
    );
    return rows;
  });

  const schedule = { ...row, theatre };
  await decryptNotes(schedule);

  await auditLog({ userId: createdBy, action: 'CREATE', entity: 'ot_schedules', entityId: row.id, nextData: row, ip });
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
  return Promise.all(rows.map(decryptNotes));
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
  return decryptNotes(rows[0]);
}

// ---------------------------------------------------------------------------
// Update OT schedule
// ---------------------------------------------------------------------------
export async function updateOTSchedule(id, updates, userId, io, ip) {
  // Conflict check + UPDATE must be atomic (same race as create): the target
  // schedule row and the theatre room row are locked FOR UPDATE so concurrent
  // edits cannot both pass the overlap check.
  const result = await withTransaction(async (client) => {
    const { rows: prevRows } = await client.query(
      `SELECT os.*, r.room_number AS theatre
       FROM ot_schedules os
       LEFT JOIN rooms r ON r.id = os.room_id
       WHERE os.id = $1 AND os.deleted_at IS NULL
       FOR UPDATE OF os`,
      [id]
    );
    if (!prevRows[0]) { const e = new Error('OT schedule not found'); e.status = 404; throw e; }
    const prev = prevRows[0];

    const theatre = updates.theatre ?? prev.theatre;
    const start   = updates.scheduledAt ? new Date(updates.scheduledAt) : new Date(prev.scheduled_start);
    const dur     = updates.durationMinutes ?? Math.round((new Date(prev.scheduled_end) - new Date(prev.scheduled_start)) / 60_000);
    const end     = new Date(start.getTime() + dur * 60_000);

    if (updates.scheduledAt || updates.theatre || updates.durationMinutes) {
      await checkConflict(client, theatre, start, end, id);
    }

    const fields = [];
    const params = [];
    let p = 1;

    const colMap = {
      patientId: 'patient_id', doctorId: 'surgeon_id', anesthetistId: 'anesthetist_id',
      procedure: 'procedure_name', status: 'status',
    };

    const encryptedNotes = updates.notes != null ? await pgEncrypt(updates.notes) : null;

    for (const [key, val] of Object.entries(updates)) {
      if (key === 'theatre' || key === 'scheduledAt' || key === 'durationMinutes') continue;
      const col = colMap[key] ?? key;
      fields.push(`${col} = $${p++}`);
      params.push(key === 'notes' ? encryptedNotes : val);
    }

    if (updates.scheduledAt || updates.durationMinutes) {
      fields.push(`scheduled_start = $${p++}`, `scheduled_end = $${p++}`);
      params.push(start, end);
    }

    if (updates.theatre) {
      const { rows: roomRows } = await client.query(
        `SELECT id FROM rooms WHERE room_number = $1 AND room_type = 'OT' AND deleted_at IS NULL LIMIT 1`,
        [updates.theatre]
      );
      fields.push(`room_id = $${p++}`);
      params.push(roomRows[0]?.id ?? null);
    }

    if (!fields.length) return { prev, changed: false };

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await client.query(
      `UPDATE ot_schedules SET ${fields.join(', ')} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!rows[0]) { const e = new Error('OT schedule not found'); e.status = 404; throw e; }

    return { prev, next: rows[0], changed: true };
  });

  if (!result.changed) return result.prev;

  await auditLog({ userId, action: 'UPDATE', entity: 'ot_schedules', entityId: id, prevData: result.prev, nextData: result.next, ip });
  return decryptNotes(result.next);
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
// Conflict check: no two surgeries in same theatre at same time.
// Runs on the supplied query runner (a transaction client when called from
// create/update) and locks the theatre room row FOR UPDATE so concurrent
// bookings for the same room are serialised. Returns the room id (or null if
// the room does not exist — the check is skipped).
// ---------------------------------------------------------------------------
async function checkConflict(db, theatre, start, end, excludeId) {
  const { rows: roomRows } = await db.query(
    `SELECT id FROM rooms WHERE room_number = $1 AND room_type = 'OT' AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [theatre]
  );
  if (!roomRows[0]) return null; // room not found — skip check

  const params = [roomRows[0].id, start, end];
  let excludeClause = '';
  if (excludeId) { excludeClause = `AND id != $4`; params.push(excludeId); }

  const { rows } = await db.query(
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
  return roomRows[0].id;
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
    ).catch(() => {}); // best-effort notification — must not fail the OT schedule
  }
}
