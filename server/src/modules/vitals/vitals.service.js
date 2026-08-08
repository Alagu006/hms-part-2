import { query }        from '../../shared/db/pool.js';
import { auditLog }     from '../../shared/middleware/audit.js';
import { notificationQueue } from '../../shared/jobs/queue.js';
import { logger }       from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Alert thresholds
// ---------------------------------------------------------------------------
const THRESHOLDS = [
  {
    field  : 'spo2',
    check  : (v) => v < 94,
    message: (v) => `Critical SpO2: ${v}% (below 94%). Immediate attention required.`,
  },
  {
    field  : 'temperature',
    check  : (v) => v > 38.5,
    message: (v) => `High temperature: ${v}°C (above 38.5°C).`,
  },
  {
    field  : 'pulseBpm',
    check  : (v) => v > 130 || v < 40,
    message: (v) => `Abnormal pulse: ${v} bpm.`,
  },
  {
    field  : 'bpSystolic',
    check  : (v) => v > 180 || v < 80,
    message: (v) => `Abnormal systolic BP: ${v} mmHg.`,
  },
  {
    field  : 'bloodGlucose',
    check  : (v) => v > 20 || v < 2.8,
    message: (v) => `Abnormal blood glucose: ${v} mmol/L.`,
  },
];

async function triggerAlerts(vitals, patientId, patientName, recordedBy) {
  const alerts = THRESHOLDS.filter(
    (t) => vitals[t.field] !== undefined && t.check(vitals[t.field])
  );
  if (!alerts.length) return;

  // Find assigned doctor(s) for this patient via latest medical record
  // NOTE: with SELECT DISTINCT, ORDER BY must reference a select-list column.
  // DISTINCT ON (u.id) returns one row per doctor (their most recent visit),
  // which is what this alert path needs.
  const { rows: doctors } = await query(
    `SELECT DISTINCT ON (u.id) u.id, u.first_name, u.last_name
     FROM medical_records mr
     JOIN users u ON u.id = mr.attending_doctor_id
     WHERE mr.patient_id = $1 AND mr.deleted_at IS NULL
     ORDER BY u.id, mr.visit_date DESC
     LIMIT 3`,
    [patientId]
  );

  const alertBody = alerts.map((a) => a.message(vitals[a.field])).join(' | ');

  for (const doctor of doctors) {
    await notificationQueue.add('push', {
      userId  : doctor.id,
      type    : 'ALERT',
      title   : `⚠ CRITICAL VITALS — ${patientName}`,
      body    : alertBody,
      entityId: patientId,
    });
  }

  // Also broadcast to all nurses on duty (role-level)
  await notificationQueue.add('push', {
    targetRole: 'NURSE',
    type      : 'ALERT',
    title     : `⚠ Critical vitals recorded for ${patientName}`,
    body      : alertBody,
    entityId  : patientId,
  });
}

// ---------------------------------------------------------------------------
// Record vitals
// ---------------------------------------------------------------------------
export async function recordVitals(data, recordedBy, ip, userAgent) {
  const {
    patientId, medicalRecordId,
    temperature, pulseBpm, bpSystolic, bpDiastolic,
    spo2, weightKg, bloodGlucose, respiratoryRate, notes,
  } = data;

  // Verify patient exists
  const { rows: patRows } = await query(
    `SELECT id, first_name, last_name FROM patients WHERE id = $1 AND deleted_at IS NULL`,
    [patientId]
  );
  if (!patRows[0]) throw Object.assign(new Error('Patient not found'), { status: 404 });
  const patient = patRows[0];

  // Resolve medical record — use provided or latest
  let resolvedRecordId = medicalRecordId ?? null;
  if (!resolvedRecordId) {
    const { rows: mrRows } = await query(
      `SELECT id FROM medical_records WHERE patient_id = $1 AND deleted_at IS NULL
       ORDER BY visit_date DESC LIMIT 1`,
      [patientId]
    );
    resolvedRecordId = mrRows[0]?.id ?? null;
  }

  // Calculate BMI if both weight and height available
  let bmi = null;
  if (weightKg) {
    const { rows: prevRows } = await query(
      `SELECT height_cm FROM vitals WHERE patient_id = $1 AND height_cm IS NOT NULL
       ORDER BY recorded_at DESC LIMIT 1`,
      [patientId]
    );
    const heightCm = prevRows[0]?.height_cm;
    if (heightCm) {
      const hm = heightCm / 100;
      bmi = parseFloat((weightKg / (hm * hm)).toFixed(1));
    }
  }

  const { rows } = await query(
    `INSERT INTO vitals
       (id, medical_record_id, patient_id, recorded_by,
        temperature_c, pulse_bpm, bp_systolic, bp_diastolic,
        spo2_pct, weight_kg, respiratory_rate, bmi, blood_glucose_mmol, notes, recorded_at, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
     RETURNING *`,
    [
      resolvedRecordId, patientId, recordedBy,
      temperature ?? null, pulseBpm ?? null,
      bpSystolic ?? null, bpDiastolic ?? null,
      spo2 ?? null, weightKg ?? null,
      respiratoryRate ?? null, bmi,
      bloodGlucose ?? null, notes ?? null,
    ]
  );

  const vital = rows[0];

  await auditLog({
    userId  : recordedBy,
    action  : 'CREATE',
    entity  : 'vitals',
    entityId: vital.id,
    nextData: { patientId, ...data },
    ip,
    userAgent,
  });

  // Fire-and-forget alert check. This is patient-safety critical: a failure to
  // alert must be LOUD, not silently swallowed — log full context (stack, code,
  // constraint, patientId) so operators can see that an alert did not fire.
  const patientName = `${patient.first_name} ${patient.last_name}`;
  triggerAlerts(data, patientId, patientName, recordedBy).catch((err) =>
    logger.error('[vitals] CRITICAL alert failed to fire — patient safety check', {
      message  : err.message,
      code     : err.code,
      constraint: err.constraint,
      stack    : err.stack,
      patientId,
    })
  );

  return vital;
}

// ---------------------------------------------------------------------------
// Count vitals recorded today
// ---------------------------------------------------------------------------
export async function countVitalsToday({ nurseId, date }) {
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const params = [];

  let where = `DATE(v.recorded_at) = $1`;
  params.push(targetDate);

  if (nurseId) {
    params.push(nurseId);
    where += ` AND v.recorded_by = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT COUNT(DISTINCT v.id) AS count FROM vitals v WHERE ${where}`,
    params
  );
  return parseInt(rows[0]?.count ?? 0, 10);
}
// ---------------------------------------------------------------------------
export async function getVitalsHistory(patientId, requestingUser, { days, page, limit }) {
  // PATIENT can only see their own
  if (requestingUser.roles.includes('PATIENT')) {
    const { rows } = await query(
      `SELECT id FROM patients WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requestingUser.id, patientId]
    );
    if (!rows[0]) return 'FORBIDDEN';
  }

  const p      = parseInt(page, 10)  || 1;
  const l      = parseInt(limit, 10) || 50;
  const d      = parseInt(days, 10)  || 7;
  const offset = (p - 1) * l;

  const { rows } = await query(
    `SELECT
       v.*,
       u.first_name || ' ' || u.last_name AS recorded_by_name,
       COUNT(*) OVER() AS total_count
     FROM vitals v
     JOIN users u ON u.id = v.recorded_by
     WHERE v.patient_id = $1
       AND v.recorded_at >= NOW() - ($2 || ' days')::interval
     ORDER BY v.recorded_at DESC
     LIMIT $3 OFFSET $4`,
    [patientId, d, l, offset]
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    vitals: rows.map(({ total_count, ...r }) => r),
    total : parseInt(total, 10),
    page  : p,
    limit : l,
    days  : d,
  };
}
