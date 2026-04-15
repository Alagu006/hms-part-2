import * as svc from './prescription.service.js';
import { generatePdf } from '../../shared/utils/pdf.service.js';
import { pgDecrypt } from '../../shared/db/pgcrypto.js';
import { query } from '../../shared/db/pool.js';

export async function searchMedicines(req, res, next) {
  try {
    const results = await svc.searchMedicines((req.parsedQuery ?? req.query).q);
    return res.status(200).json({ data: results });
  } catch (err) { next(err); }
}

export async function importOpenFdaMedicines(req, res, next) {
  try {
    const result = await svc.importOpenFdaMedicines(req.body.query);
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function createPrescription(req, res, next) {
  try {
    const result = await svc.createPrescription(
      req.body, req.user.id, req.ip, req.headers['user-agent']
    );
    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPrescription(req, res, next) {
  try {
    const result = await svc.getPrescriptionById(req.params.id, req.user);
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    if (!result)                return res.status(404).json({ error: 'Prescription not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPatientPrescriptions(req, res, next) {
  try {
    const result = await svc.getPatientPrescriptions(req.params.patientId, (req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function getMyPrescriptions(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id FROM patients WHERE user_id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No patient record found' });
    const result = await svc.getPatientPrescriptions(rows[0].id, (req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function dispensePrescription(req, res, next) {
  try {
    const result = await svc.dispensePrescription(
      req.params.id, req.body, req.user.id, req.ip, req.headers['user-agent']
    );
    if (!result) return res.status(404).json({ error: 'Prescription not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function getPrescriptionCount(req, res, next) {
  try {
    const count = await svc.countPrescriptions((req.parsedQuery ?? req.query), req.user.id);
    return res.status(200).json({ count });
  } catch (err) { next(err); }
}

export async function listPrescriptions(req, res, next) {
  try {
    const result = await svc.listPrescriptions((req.parsedQuery ?? req.query));
    return res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function downloadPrescriptionPdf(req, res, next) {
  try {
    const presc = await svc.getPrescriptionById(req.params.id, req.user);
    if (presc === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    if (!presc) return res.status(404).json({ error: 'Prescription not found' });

    // Decrypt item instructions
    const items = await Promise.all(
      (presc.items ?? []).map(async (item) => {
        if (item.instructions) {
          try { item.instructions = await pgDecrypt(item.instructions); }
          catch { item.instructions = item.instructions; }
        }
        return item;
      })
    );

    const prescDate = new Date(presc.created_at).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const itemsRows = items.length
      ? items.map(item => `
        <tr>
          <td>${item.medicine_name ?? '—'}</td>
          <td>${item.dosage ?? '—'}</td>
          <td>${item.frequency ?? '—'}</td>
          <td>${item.duration_days ?? '—'}</td>
          <td>${item.instructions ?? '—'}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#999;">No items</td></tr>';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Prescription</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:13px;color:#111;">
<div style="max-width:800px;margin:0 auto;padding:20px 30px;">

  <!-- Header -->
  <div style="border-bottom:3px solid #1a56db;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <h1 style="margin:0;font-size:22px;color:#1a56db;">${process.env.HMS_NAME || 'Hospital Management System'}</h1>
      <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">${process.env.HMS_ADDRESS || ''}</p>
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:12px;color:#374151;"><strong>PRESCRIPTION</strong></p>
      <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Date: ${prescDate}</p>
    </div>
  </div>

  <!-- Patient & Doctor Info -->
  <table style="width:100%;margin-bottom:20px;border-collapse:collapse;">
    <tr>
      <td style="width:50%;vertical-align:top;padding-right:20px;">
        <div style="background:#f3f8ff;border-radius:6px;padding:12px;">
          <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Patient</p>
          <p style="margin:0;font-size:14px;font-weight:600;">${presc.patient_first} ${presc.patient_last}</p>
        </div>
      </td>
      <td style="width:50%;vertical-align:top;">
        <div style="background:#f0fdf4;border-radius:6px;padding:12px;">
          <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Prescribing Doctor</p>
          <p style="margin:0;font-size:14px;font-weight:600;">Dr. ${presc.doctor_first} ${presc.doctor_last}</p>
        </div>
      </td>
    </tr>
  </table>

  ${presc.notes?.diagnosisCodes ? `
  <div style="background:#fffbeb;border-radius:6px;padding:10px 14px;margin-bottom:20px;border-left:4px solid #f59e0b;">
    <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#92400e;letter-spacing:0.05em;">Diagnosis</p>
    <p style="margin:0;font-size:13px;color:#78350f;">${presc.notes.diagnosisCodes.join(', ')}</p>
  </div>` : ''}

  <!-- Medicines Table -->
  <div style="margin-bottom:24px;">
    <h2 style="margin:0 0 10px;font-size:14px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:6px;">Medicines</h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Medicine</th>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Dosage</th>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Frequency</th>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Duration</th>
          <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Instructions</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
  </div>

  ${presc.notes?.freeNotes ? `
  <div style="background:#f9fafb;border-radius:6px;padding:12px;margin-bottom:20px;">
    <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Doctor's Notes</p>
    <p style="margin:0;font-size:13px;color:#374151;white-space:pre-wrap;">${presc.notes.freeNotes}</p>
  </div>` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid #e5e7eb;padding-top:12px;margin-top:20px;text-align:center;">
    <p style="margin:0;font-size:10px;color:#9ca3af;font-style:italic;">This is a computer-generated prescription. No signature required.</p>
  </div>
</div>
</body>
</html>`;

    const buffer = await generatePdf(html);
    const filename = `prescription_${req.params.id}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) { next(err); }
}
