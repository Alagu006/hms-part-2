import crypto from 'crypto';
import { query, withTransaction } from '../../shared/db/pool.js';
import { auditLog } from '../../shared/middleware/audit.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { emailQueue } from '../../shared/jobs/queue.js';
import { Queue } from 'bullmq';

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_QUEUE_DB || '1', 10),
  maxRetriesPerRequest: null,
};

export const teleQueue = new Queue('telemedicine', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

function generateRoomToken(sessionId) {
  const secret = process.env.TELE_ROOM_SECRET || 'change-me-in-env';
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('hex').slice(0, 16);
  return sessionId.replace(/-/g, '') + '-' + sig;
}

export function verifyRoomId(sessionId, roomId) {
  const expected = generateRoomToken(sessionId);
  return crypto.timingSafeEqual(Buffer.from(roomId), Buffer.from(expected));
}

export async function createSession(data, createdBy, ip, userAgent, io) {
  const { patientId, doctorId, appointmentId } = data;

  return withTransaction(async (client) => {
    const { rows: patRows } = await query(
      'SELECT p.id, u.first_name, u.last_name, u.email, u.id AS user_id ' +
      'FROM patients p JOIN users u ON u.id = p.user_id ' +
      'WHERE p.id = $1 AND p.deleted_at IS NULL',
      [patientId], client
    );
    if (!patRows[0]) throw Object.assign(new Error('Patient not found'), { status: 404 });

    const { rows: docRows } = await query(
      'SELECT u.id, u.first_name, u.last_name, u.email ' +
      'FROM users u JOIN user_roles ur ON ur.user_id = u.id ' +
      "WHERE u.id = $1 AND ur.role = 'DOCTOR' AND ur.revoked_at IS NULL AND u.deleted_at IS NULL",
      [doctorId], client
    );
    if (!docRows[0]) throw Object.assign(new Error('Doctor not found'), { status: 404 });

    const { rows: apptRows } = await query(
      'SELECT id, scheduled_at, duration_minutes FROM appointments ' +
      "WHERE id = $1 AND patient_id = $2 AND doctor_id = $3 AND type = 'TELEMEDICINE' AND deleted_at IS NULL",
      [appointmentId, patientId, doctorId], client
    );
    if (!apptRows[0]) throw Object.assign(new Error('Appointment not found or not a telemedicine appointment'), { status: 404 });

    const appt = apptRows[0];
    const patient = patRows[0];
    const doctor = docRows[0];

    const { rows: existing } = await query(
      "SELECT id, room_token FROM telemedicine_sessions WHERE appointment_id = $1 AND status IN ('WAITING','ACTIVE')",
      [appointmentId], client
    );
    if (existing[0]) return { ...existing[0], room_id: existing[0].room_token };

    const tempId = crypto.randomUUID();
    const roomToken = generateRoomToken(tempId);

    const { rows: sessRows } = await query(
      'INSERT INTO telemedicine_sessions ' +
      '(id, appointment_id, patient_id, doctor_id, room_token, status, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, $4, $5, 'WAITING', NOW(), NOW()) RETURNING *",
      [tempId, appointmentId, patientId, doctorId, roomToken], client
    );
    const session = { ...sessRows[0], room_id: sessRows[0].room_token };

    await auditLog(createdBy, 'CREATE', 'telemedicine_sessions', session.id, null,
      { patientId, doctorId, appointmentId }, ip, userAgent);

    const scheduledDate = new Date(appt.scheduled_at);
    const formattedTime = scheduledDate.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

    setImmediate(async () => {
      try {
        await createNotification(doctorId, NotificationType.TELEMEDICINE_REMINDER,
          'Telemedicine session ready',
          'Session with ' + patient.first_name + ' ' + patient.last_name + ' at ' + formattedTime,
          { entityType: 'TELEMEDICINE', entityId: session.id, priority: 'MEDIUM' }, io);

        await createNotification(patient.user_id, NotificationType.TELEMEDICINE_REMINDER,
          'Telemedicine session ready',
          'Your video consultation with Dr. ' + doctor.first_name + ' ' + doctor.last_name + ' at ' + formattedTime,
          { entityType: 'TELEMEDICINE', entityId: session.id, priority: 'MEDIUM' }, io);

        const reminderDelay = scheduledDate.getTime() - Date.now() - 15 * 60 * 1000;
        if (reminderDelay > 0) {
          await teleQueue.add('reminder',
            { sessionId: session.id, doctorId, patientUserId: patient.user_id },
            { delay: reminderDelay, jobId: 'reminder:' + session.id });
        }
      } catch (err) {
        console.error('[tele] Post-create notifications failed:', err.message);
      }
    });

    return session;
  });
}

export async function getSessionById(id) {
  const { rows } = await query(
    'SELECT ts.*, ts.room_token AS room_id, a.scheduled_at, a.duration_minutes, ' +
    'pu.first_name AS patient_first, pu.last_name AS patient_last, ' +
    'du.first_name AS doctor_first, du.last_name AS doctor_last ' +
    'FROM telemedicine_sessions ts ' +
    'JOIN appointments a ON a.id = ts.appointment_id ' +
    'JOIN patients p ON p.id = ts.patient_id ' +
    'JOIN users pu ON pu.id = p.user_id ' +
    'JOIN users du ON du.id = ts.doctor_id ' +
    'WHERE ts.id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function listMySessions(userId, roles, { page, limit, status }) {
  const offset = (page - 1) * limit;
  const isPatient = roles.includes('PATIENT');
  const params = [userId, limit, offset];
  const extra = status ? (params.push(status), 'AND ts.status = $' + params.length) : '';

  const selectCols =
    'SELECT ts.*, ts.room_token AS room_id, a.scheduled_at, a.duration_minutes, ' +
    'pu.first_name AS patient_first, pu.last_name AS patient_last, ' +
    'du.first_name AS doctor_first, du.last_name AS doctor_last, ' +
    'COUNT(*) OVER() AS total_count ' +
    'FROM telemedicine_sessions ts ' +
    'JOIN appointments a ON a.id = ts.appointment_id ';

  const sql = isPatient
    ? selectCols +
      'JOIN patients pt ON pt.id = ts.patient_id AND pt.user_id = $1 ' +
      'JOIN users pu ON pu.id = pt.user_id ' +
      'JOIN users du ON du.id = ts.doctor_id ' +
      'WHERE 1=1 ' + extra + ' ORDER BY a.scheduled_at DESC LIMIT $2 OFFSET $3'
    : selectCols +
      'JOIN patients pt ON pt.id = ts.patient_id ' +
      'JOIN users pu ON pu.id = pt.user_id ' +
      'JOIN users du ON du.id = ts.doctor_id ' +
      'WHERE ts.doctor_id = $1 ' + extra + ' ORDER BY a.scheduled_at DESC LIMIT $2 OFFSET $3';

  const { rows } = await query(sql, params);
  const total = rows[0]?.total_count ?? 0;
  return {
    sessions: rows.map(({ total_count, ...r }) => r),
    total: parseInt(total, 10),
    page, limit,
  };
}

export async function getRoomToken(sessionId, userId, roles) {
  const { rows } = await query(
    'SELECT ts.*, ts.room_token AS room_id, a.scheduled_at, a.duration_minutes, ' +
    'pt.user_id AS patient_user_id ' +
    'FROM telemedicine_sessions ts ' +
    'JOIN appointments a ON a.id = ts.appointment_id ' +
    'JOIN patients pt ON pt.id = ts.patient_id ' +
    'WHERE ts.id = $1',
    [sessionId]
  );
  const session = rows[0];
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  const isDoctor = session.doctor_id === userId;
  const isPatient = session.patient_user_id === userId;
  const isAdmin = roles.some(r => ['ADMIN', 'SUPER_ADMIN'].includes(r));
  if (!isDoctor && !isPatient && !isAdmin) {
    throw Object.assign(new Error('Not a participant in this session'), { status: 403 });
  }

  const now = Date.now();
  const start = new Date(session.scheduled_at).getTime();
  const duration = session.duration_minutes ?? 30;
  const expiry = start + (duration + 30) * 60000;
  const earlyEntry = start - 5 * 60000;

  if (now < earlyEntry) {
    throw Object.assign(
      new Error('Session starts at ' + new Date(session.scheduled_at).toISOString()),
      { status: 403, code: 'TOO_EARLY' }
    );
  }
  if (now > expiry && session.status !== 'ACTIVE') {
    throw Object.assign(new Error('Session has expired'), { status: 403, code: 'EXPIRED' });
  }

  if (session.status === 'WAITING') {
    await query(
      "UPDATE telemedicine_sessions SET status = 'ACTIVE', started_at = NOW(), updated_at = NOW() WHERE id = $1",
      [sessionId]
    );
  }

  return {
    roomId: session.room_id,
    sessionId: session.id,
    role: isDoctor ? 'doctor' : 'patient',
    scheduledAt: session.scheduled_at,
    expiresAt: new Date(expiry).toISOString(),
    doctorId: session.doctor_id,
    patientId: session.patient_id,
  };
}

export async function endSession(sessionId, userId, { consultationNote }, ip, userAgent) {
  const { rows } = await query(
    'SELECT ts.*, pt.user_id AS patient_user_id ' +
    'FROM telemedicine_sessions ts ' +
    'JOIN patients pt ON pt.id = ts.patient_id ' +
    'WHERE ts.id = $1',
    [sessionId]
  );
  const session = rows[0];
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.doctor_id !== userId) {
    throw Object.assign(new Error('Only the doctor can end the session'), { status: 403 });
  }

  await query(
    "UPDATE telemedicine_sessions SET status = 'COMPLETED', ended_at = NOW(), updated_at = NOW() WHERE id = $1",
    [sessionId]
  );

  if (consultationNote && consultationNote.trim()) {
    await query(
      "INSERT INTO medical_records (id, patient_id, doctor_id, record_type, notes, created_at) VALUES (gen_random_uuid(), $1, $2, 'TELEMEDICINE_NOTE', $3, NOW())",
      [session.patient_id, userId, consultationNote.trim()]
    );
  }

  await auditLog(userId, 'END_SESSION', 'telemedicine_sessions', sessionId,
    { status: session.status }, { status: 'COMPLETED', hasNote: !!consultationNote }, ip, userAgent);

  try {
    const job = await teleQueue.getJob('reminder:' + sessionId);
    if (job) await job.remove();
  } catch (_) { /* ignore */ }

  return { ok: true };
}
