import crypto                from 'crypto';
import { query, withTransaction } from '../../shared/db/pool.js';
import { auditLog }               from '../../shared/middleware/audit.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { sendNotification }       from '../../shared/services/email.service.js';
import { emailQueue }             from '../../shared/jobs/queue.js';
import { Queue }                  from 'bullmq';

// ---------------------------------------------------------------------------
// BullMQ queue for delayed reminder jobs
// ---------------------------------------------------------------------------
const redisConnection = {
  host    : process.env.REDIS_HOST || '127.0.0.1',
  port    : parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db      : parseInt(process.env.REDIS_QUEUE_DB || '1', 10),
  maxRetriesPerRequest: null,
};

export const teleQueue = new Queue('telemedicine', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff : { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail    : { count: 200 },
  },
});

// ---------------------------------------------------------------------------
// Room ID helpers
// ---------------------------------------------------------------------------

/**
 * Generate a signed, opaque room ID.
 * Format: base64url(uuid + HMAC-SHA256 signature)
 */
function generateRoomId(sessionId) {
  const secret = process.env.TELE_ROOM_SECRET || 'change-me-in-env';
  const sig    = crypto
    .createHmac('sha256', secret)
    .update(sessionId)
    .digest('hex')
    .slice(0, 16);
  return `${sessionId.replace(/-/g, '')}-${sig}`;
}

/**
 * Verify a roomId belongs to a session.
 */
export function verifyRoomId(sessionId, roomId) {
  const expected = generateRoomId(sessionId);
  return crypto.timingSafeEqual(Buffer.from(roomId), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Create session
// ---------------------------------------------------------------------------
export async function createSession(data, createdBy, ip, userAgent, io) {
  const { patientId, doctorId, scheduledAt, durationMinutes } = data;

  return withTransaction(async (client) => {
    // Validate patient exists
    const { rows: patRows } = await query(
      `SELECT p.id, u.first_name, u.last_name, u.email
       FROM patients p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [patientId], client
    );
    if (!patRows[0]) throw Object.assign(new Error('Patient not found'), { status: 404 });

    // Validate doctor exists
    const { rows: docRows } = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1 AND ur.role = 'DOCTOR' AND ur.revoked_at IS NULL AND u.deleted_at IS NULL`,
      [doctorId], client
    );
    if (!docRows[0]) throw Object.assign(new Error('Doctor not found'), { status: 404 });

    const patient = patRows[0];
    const doctor  = docRows[0];

    // Insert session
    const { rows: sessRows } = await query(
      `INSERT INTO telemedicine_sessions
         (id, patient_id, doctor_id, scheduled_at, duration_minutes,
          status, created_by, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, 'SCHEDULED', $5, NOW())
       RETURNING *`,
      [patientId, doctorId, scheduledAt, durationMinutes, createdBy],
      client
    );
    const session = sessRows[0];
    const roomId  = generateRoomId(session.id);

    // Store roomId
    await query(
      `UPDATE telemedicine_sessions SET room_id = $1 WHERE id = $2`,
      [roomId, session.id], client
    );
    session.room_id = roomId;

    // Audit
    await auditLog({
      userId   : createdBy,
      action   : 'CREATE',
      entity   : 'telemedicine_sessions',
      entityId : session.id,
      prevData : null,
      nextData : { patientId, doctorId, scheduledAt, durationMinutes },
      ip,
      userAgent,
    });

    const scheduledDate = new Date(scheduledAt);
    const formattedTime = scheduledDate.toLocaleString('en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    });

    // Notifications (fire-and-forget after transaction)
    setImmediate(async () => {
      try {
        // Notify doctor
        await createNotification(
          doctorId,
          NotificationType.TELEMEDICINE_REMINDER,
          'Telemedicine session scheduled',
          `Session with patient ${patient.first_name} ${patient.last_name} at ${formattedTime}`,
          { entityType: 'TELEMEDICINE', entityId: session.id, priority: 'MEDIUM' },
          io
        );

        // Notify patient (via their user_id)
        const { rows: pUserRows } = await query(
          `SELECT user_id FROM patients WHERE id = $1`, [patientId]
        );
        if (pUserRows[0]) {
          await createNotification(
            pUserRows[0].user_id,
            NotificationType.TELEMEDICINE_REMINDER,
            'Telemedicine session scheduled',
            `Your video consultation with Dr. ${doctor.first_name} ${doctor.last_name} is at ${formattedTime}`,
            { entityType: 'TELEMEDICINE', entityId: session.id, priority: 'MEDIUM' },
            io
          );
        }

        // Email doctor
        await emailQueue.add('telemedicine-invite', {
          to     : doctor.email,
          subject: `Telemedicine session — ${formattedTime}`,
          html   : teleEmailTemplate({
            recipientName: `Dr. ${doctor.first_name} ${doctor.last_name}`,
            otherParty   : `${patient.first_name} ${patient.last_name}`,
            role         : 'doctor',
            scheduledAt  : formattedTime,
            sessionId    : session.id,
          }),
        });

        // Email patient
        if (patient.email) {
          await emailQueue.add('telemedicine-invite', {
            to     : patient.email,
            subject: `Your video consultation — ${formattedTime}`,
            html   : teleEmailTemplate({
              recipientName: `${patient.first_name} ${patient.last_name}`,
              otherParty   : `Dr. ${doctor.first_name} ${doctor.last_name}`,
              role         : 'patient',
              scheduledAt  : formattedTime,
              sessionId    : session.id,
            }),
          });
        }

        // Schedule 15-min reminder job
        const reminderDelay = scheduledDate.getTime() - Date.now() - 15 * 60 * 1000;
        if (reminderDelay > 0) {
          await teleQueue.add(
            'reminder',
            { sessionId: session.id, doctorId, patientUserId: pUserRows[0]?.user_id },
            { delay: reminderDelay, jobId: `reminder:${session.id}` }
          );
        }
      } catch (err) {
        console.error('[tele] Post-create notifications failed:', err.message);
      }
    });

    return session;
  });
}

// ---------------------------------------------------------------------------
// Get session by ID (with participant info)
// ---------------------------------------------------------------------------
export async function getSessionById(id) {
  const { rows } = await query(
    `SELECT
       ts.*,
       pd.first_name  AS patient_first, pd.last_name AS patient_last,
       pu.email       AS patient_email,
       dd.first_name  AS doctor_first,  dd.last_name AS doctor_last,
       du.email       AS doctor_email
     FROM telemedicine_sessions ts
     JOIN patients p ON p.id = ts.patient_id
     JOIN users pu   ON pu.id = p.user_id
     JOIN users pd   ON pd.id = pu.id
     JOIN users du   ON du.id = ts.doctor_id
     LEFT JOIN users dd ON dd.id = ts.doctor_id
     WHERE ts.id = $1 AND ts.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// List sessions for logged-in user
// ---------------------------------------------------------------------------
export async function listMySessions(userId, roles, { page, limit, status }) {
  const offset = (page - 1) * limit;
  const params = [userId, limit, offset];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`ts.status = $${params.length}`);
  }

  const whereExtra = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  // Determine join condition based on role
  const isPatient = roles.includes('PATIENT');
  const joinCond  = isPatient
    ? `JOIN patients pt ON pt.id = ts.patient_id AND pt.user_id = $1`
    : `AND (ts.doctor_id = $1 OR ts.created_by = $1)`;

  const sql = isPatient
    ? `SELECT ts.*,
         pu.first_name AS patient_first, pu.last_name AS patient_last,
         du.first_name AS doctor_first,  du.last_name AS doctor_last,
         COUNT(*) OVER() AS total_count
       FROM telemedicine_sessions ts
       JOIN patients pt ON pt.id = ts.patient_id AND pt.user_id = $1
       JOIN users pu    ON pu.id = pt.user_id
       JOIN users du    ON du.id = ts.doctor_id
       WHERE ts.deleted_at IS NULL ${whereExtra}
       ORDER BY ts.scheduled_at DESC
       LIMIT $2 OFFSET $3`
    : `SELECT ts.*,
         pu.first_name AS patient_first, pu.last_name AS patient_last,
         du.first_name AS doctor_first,  du.last_name AS doctor_last,
         COUNT(*) OVER() AS total_count
       FROM telemedicine_sessions ts
       JOIN patients pt ON pt.id = ts.patient_id
       JOIN users pu    ON pu.id = pt.user_id
       JOIN users du    ON du.id = ts.doctor_id
       WHERE ts.deleted_at IS NULL
         AND (ts.doctor_id = $1 OR ts.created_by = $1)
         ${whereExtra}
       ORDER BY ts.scheduled_at DESC
       LIMIT $2 OFFSET $3`;

  const { rows } = await query(sql, params);
  const total = rows[0]?.total_count ?? 0;
  return {
    sessions: rows.map(({ total_count, ...r }) => r),
    total   : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Get room access token (validates participant)
// ---------------------------------------------------------------------------
export async function getRoomToken(sessionId, userId, roles) {
  const { rows } = await query(
    `SELECT ts.*, pt.user_id AS patient_user_id
     FROM telemedicine_sessions ts
     JOIN patients pt ON pt.id = ts.patient_id
     WHERE ts.id = $1 AND ts.deleted_at IS NULL`,
    [sessionId]
  );
  const session = rows[0];
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  const isDoctor  = session.doctor_id === userId;
  const isPatient = session.patient_user_id === userId;
  const isAdmin   = roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));

  if (!isDoctor && !isPatient && !isAdmin) {
    throw Object.assign(new Error('Not a participant in this session'), { status: 403 });
  }

  // Check session window: allow join from 5 min before to scheduledAt + durationMinutes + 30 min
  const now        = Date.now();
  const start      = new Date(session.scheduled_at).getTime();
  const expiry     = start + (session.duration_minutes + 30) * 60_000;
  const earlyEntry = start - 5 * 60_000;

  if (now < earlyEntry) {
    throw Object.assign(
      new Error(`Session starts at ${new Date(session.scheduled_at).toISOString()}`),
      { status: 403, code: 'TOO_EARLY' }
    );
  }
  if (now > expiry && session.status !== 'ACTIVE') {
    throw Object.assign(new Error('Session has expired'), { status: 403, code: 'EXPIRED' });
  }

  // Mark ACTIVE on first join
  if (session.status === 'SCHEDULED') {
    await query(
      `UPDATE telemedicine_sessions SET status = 'ACTIVE', started_at = NOW() WHERE id = $1`,
      [sessionId]
    );
  }

  return {
    roomId     : session.room_id,
    sessionId  : session.id,
    role       : isDoctor ? 'doctor' : 'patient',
    scheduledAt: session.scheduled_at,
    expiresAt  : new Date(expiry).toISOString(),
    doctorId   : session.doctor_id,
    patientId  : session.patient_id,
  };
}

// ---------------------------------------------------------------------------
// End session + optional consultation note
// ---------------------------------------------------------------------------
export async function endSession(sessionId, userId, { consultationNote }, ip, userAgent) {
  const { rows: sessRows } = await query(
    `SELECT ts.*, pt.user_id AS patient_user_id
     FROM telemedicine_sessions ts
     JOIN patients pt ON pt.id = ts.patient_id
     WHERE ts.id = $1 AND ts.deleted_at IS NULL`,
    [sessionId]
  );
  const session = sessRows[0];
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.doctor_id !== userId) {
    throw Object.assign(new Error('Only the doctor can end the session'), { status: 403 });
  }

  await query(
    `UPDATE telemedicine_sessions
     SET status = 'ENDED', ended_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );

  // Save consultation note to medical_records if provided
  if (consultationNote?.trim()) {
    await query(
      `INSERT INTO medical_records
         (id, patient_id, doctor_id, record_type, notes, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'TELEMEDICINE_NOTE', $3, NOW())`,
      [session.patient_id, userId, consultationNote.trim()]
    );
  }

  await auditLog({
    userId,
    action   : 'END_SESSION',
    entity   : 'telemedicine_sessions',
    entityId : sessionId,
    prevData : { status: session.status },
    nextData : { status: 'ENDED', hasNote: !!consultationNote },
    ip,
    userAgent,
  });

  // Cancel pending reminder if session ended early
  try {
    const job = await teleQueue.getJob(`reminder:${sessionId}`);
    if (job) await job.remove();
  } catch { /* ignore */ }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------
function teleEmailTemplate({ recipientName, otherParty, role, scheduledAt, sessionId }) {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const joinUrl = `${appUrl}/telemedicine/${sessionId}`;
  const label   = role === 'doctor' ? 'Patient' : 'Doctor';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Telemedicine Session</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#1a56db;padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:20px;font-weight:bold;">
            ${process.env.HOSPITAL_NAME || 'HMS'} — Telemedicine
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#111827;">Video Consultation Scheduled</h2>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            Dear ${recipientName},<br/><br/>
            Your telemedicine session with <strong>${otherParty}</strong> has been scheduled.
          </p>
          <div style="background:#f3f4f6;border-radius:6px;padding:16px 24px;margin:24px 0;">
            <p style="margin:0;color:#6b7280;font-size:13px;">Scheduled time</p>
            <p style="margin:8px 0 0;color:#111827;font-size:20px;font-weight:bold;">${scheduledAt}</p>
          </div>
          <a href="${joinUrl}"
             style="display:inline-block;background:#1a56db;color:#fff;padding:12px 28px;
                    border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">
            Join Session
          </a>
          <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
            The "Join" button becomes active 5 minutes before the scheduled time.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
