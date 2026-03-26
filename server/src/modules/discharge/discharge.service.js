import { pool }                from '../../shared/db/pool.js';
import { auditLog }            from '../../shared/middleware/audit.js';
import { createNotification }  from '../../shared/services/notification.service.js';
import { sendNotification } from '../../shared/services/email.service.js';

// ---------------------------------------------------------------------------
// Create discharge summary
// ---------------------------------------------------------------------------
export async function createDischargeSummary(
  { patientId, admissionDate, dischargeDate, diagnosis, treatmentSummary,
    dischargeMedications, followUpDate, instructions },
  doctorId, io, ip
) {
  // Fetch patient info (for notification + email)
  const { rows: patRows } = await pool.query(
    `SELECT p.id, p.first_name, p.last_name, p.user_id,
            pgp_sym_decrypt(p.email::bytea, $2) AS email
     FROM patients p
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [patientId, process.env.PGP_SYM_KEY]
  );
  const patient = patRows[0];
  if (!patient) {
    const err = new Error('Patient not found'); err.status = 404; throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO discharge_summaries
       (id, patient_id, discharged_by, discharge_date, final_diagnosis,
        treatment_summary, medications_on_discharge, follow_up_date,
        follow_up_notes, discharge_type, discharge_condition, medical_record_id, created_at, updated_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
        'REGULAR', 'STABLE',
        (SELECT id FROM medical_records WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1),
        NOW(), NOW())
     RETURNING *`,
    [
      patientId, doctorId, dischargeDate, diagnosis,
      treatmentSummary ?? null, dischargeMedications ?? null,
      followUpDate ?? null, instructions ?? null,
    ]
  );
  const summary = rows[0];

  await auditLog({ userId: doctorId, action: 'CREATE', entity: 'discharge_summaries', entityId: summary.id, nextData: summary, ip });

  // In-app notification to patient (if they have a portal account)
  if (patient.user_id) {
    await createNotification(
      patient.user_id,
      'SYSTEM',
      'Discharge Summary Ready',
      `Your discharge summary has been prepared by your doctor. Follow-up: ${followUpDate ?? 'TBD'}.`,
      { entityType: 'discharge_summaries', entityId: summary.id },
      io
    );
  }

  // Email notification
  if (patient.email) {
    const html = buildDischargeEmail(patient, summary, followUpDate, instructions);
    await sendNotification(
      patient.email,
      `Discharge Summary — ${process.env.HOSPITAL_NAME || 'HMS'}`,
      html
    );
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Get discharge summaries for a patient
// ---------------------------------------------------------------------------
export async function getPatientDischargeSummaries(patientId) {
  const { rows } = await pool.query(
    `SELECT ds.*,
            u.first_name AS doctor_first, u.last_name AS doctor_last
     FROM discharge_summaries ds
     JOIN users u ON u.id = ds.discharged_by
     WHERE ds.patient_id = $1
     ORDER BY ds.discharge_date DESC`,
    [patientId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------
function buildDischargeEmail(patient, summary, followUpDate, instructions) {
  const hospitalName = process.env.HOSPITAL_NAME || 'HMS';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Discharge Summary</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a56db;padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:20px;font-weight:bold;">${hospitalName}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#111827;">Discharge Summary</h2>
          <p style="color:#374151;">Dear ${patient.first_name} ${patient.last_name},</p>
          <p style="color:#374151;">Your discharge summary is now available. Please keep this for your records.</p>
          <table width="100%" style="border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;background:#f9fafb;font-weight:bold;color:#374151;width:40%;">Discharge Date</td>
                <td style="padding:8px;color:#374151;">${new Date(summary.discharge_date).toLocaleDateString()}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;color:#374151;">Diagnosis</td>
                <td style="padding:8px;color:#374151;">${summary.final_diagnosis}</td></tr>
            ${followUpDate ? `<tr><td style="padding:8px;background:#f9fafb;font-weight:bold;color:#374151;">Follow-up Date</td>
                <td style="padding:8px;color:#374151;">${new Date(followUpDate).toLocaleDateString()}</td></tr>` : ''}
            ${instructions ? `<tr><td style="padding:8px;font-weight:bold;color:#374151;">Instructions</td>
                <td style="padding:8px;color:#374151;">${instructions}</td></tr>` : ''}
          </table>
          <p style="color:#6b7280;font-size:13px;">Please contact us if you have any questions.</p>
        </td></tr>
        <tr><td style="background:#f4f6f9;padding:16px 32px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated message. Do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
