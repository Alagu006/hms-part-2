import { reportQueue }               from '../../shared/jobs/queue.js';
import { pool }                      from '../../shared/db/pool.js';
import { redis }                     from '../../shared/services/redis.service.js';
import { auditLog }                  from '../../shared/middleware/audit.js';
import { uuidv7 }                    from '../../shared/utils/uuid.js';
import { generatePdfToFile, escapeHtml } from '../../shared/utils/pdf.service.js';
import { join }                       from 'path';
import * as analytics                from './analytics.service.js';

const REPORT_TTL = 60 * 60; // 1 hour download window

// ---------------------------------------------------------------------------
// Enqueue a report generation job
// ---------------------------------------------------------------------------
export async function enqueueReport({ type, format, period }, userId) {
  const job = await reportQueue.add(
    'generate',
    { type, format, period, userId },
    { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } }
  );

  // Store pending status
  await redis.setex(
    reportJobKey(job.id),
    REPORT_TTL,
    JSON.stringify({ status: 'pending', type, format, period, userId, createdAt: new Date().toISOString() })
  );

  // Persist to DB for history — use UUID v7 for time-ordered IDs
  const reportJobId = uuidv7();
  await pool.query(
    `INSERT INTO report_jobs (id, job_id, user_id, type, format, period, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
     ON CONFLICT DO NOTHING`,
    [reportJobId, job.id, userId, type, format, period]
  ).catch(() => {}); // best-effort history row — the job is already queued in Redis

  await auditLog({
    userId,
    action  : 'GENERATE_REPORT',
    entity  : 'report_jobs',
    entityId: reportJobId,
    nextData: { type, format, period },
  });

  return { jobId: job.id };
}

// ---------------------------------------------------------------------------
// Poll job status
// ---------------------------------------------------------------------------
export async function getReportStatus(jobId) {
  const raw = await redis.get(reportJobKey(jobId));
  if (!raw) {
    // Fall back to DB
    const { rows } = await pool.query(
      `SELECT * FROM report_jobs WHERE job_id = $1`,
      [jobId]
    ).catch(() => ({ rows: [] }));
    return rows[0] ?? null;
  }
  // redis.get() already auto-parses JSON — parsing again here would turn the
  // object into "[object Object]" and throw, making every status poll return
  // null (→ 404). Return it as-is.
  return raw;
}

// ---------------------------------------------------------------------------
// Report history for a user
// ---------------------------------------------------------------------------
export async function getReportHistory(userId, { page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const { rows } = await pool.query(
    `SELECT * FROM report_jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  ).catch(() => ({ rows: [] }));
  return rows;
}

// ---------------------------------------------------------------------------
// HTML builders for PDF reports
// ---------------------------------------------------------------------------
function hospitalHeaderHtml(title) {
  return `<div style="border-bottom:3px solid #1a56db;padding-bottom:14px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <h1 style="margin:0;font-size:20px;color:#1a56db;">${process.env.HMS_NAME || 'Hospital Management System'}</h1>
      <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">${process.env.HMS_ADDRESS || ''}</p>
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:12px;color:#374151;font-weight:600;">${title}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#6b7280;">Period: ${new Date().toLocaleDateString()}</p>
    </div>
  </div>`;
}

function buildPatientReportHtml(data) {
  const rows = (data.admissions ?? []).map(r => `
    <tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${r.date ?? '—'}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${r.count ?? 0}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">${r.running_total ?? 0}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Patient Statistics Report</title></head>
<body style="margin:0;padding:20px 30px;font-family:Arial,sans-serif;font-size:13px;color:#111;">
<div style="max-width:800px;margin:0 auto;">
${hospitalHeaderHtml('Patient Statistics Report')}
${data.summary ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
  <div style="background:#eff6ff;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#1e40af;">Total Admissions</p><p style="margin:0;font-size:24px;font-weight:700;color:#1e40af;">${data.summary.total_admissions ?? 0}</p></div>
  <div style="background:#f0fdf4;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#065f46;">Discharges</p><p style="margin:0;font-size:24px;font-weight:700;color:#065f46;">${data.summary.total_discharges ?? 0}</p></div>
  <div style="background:#fef3c7;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#92400e;">Avg LOS (days)</p><p style="margin:0;font-size:24px;font-weight:700;color:#92400e;">${data.summary.avg_los ?? 0}</p></div>
</div>` : ''}
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead><tr style="background:#f9fafb;"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Date</th><th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:center;">Admissions</th><th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7288;text-align:right;">Running Total</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3" style="padding:20px;text-align:center;color:#9ca3af;">No data available</td></tr>'}</tbody>
</table>
<div style="margin-top:24px;text-align:center;"><p style="margin:0;font-size:10px;color:#9ca3af;font-style:italic;">Generated on ${new Date().toLocaleString()}</p></div>
</div></body></html>`;
}

function buildFinancialReportHtml(data) {
  const rows = (data.dailyRevenue ?? []).map(r => `
    <tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${r.date ?? '—'}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">₹${(+r.revenue ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">₹${(+r.cumulative ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Financial Report</title></head>
<body style="margin:0;padding:20px 30px;font-family:Arial,sans-serif;font-size:13px;color:#111;">
<div style="max-width:800px;margin:0 auto;">
${hospitalHeaderHtml('Financial Report')}
${data.summary ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
  <div style="background:#d1fae5;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#065f46;">Total Revenue</p><p style="margin:0;font-size:24px;font-weight:700;color:#065f46;">₹${(+data.summary.total_revenue ?? 0).toLocaleString('en-IN')}</p></div>
  <div style="background:#fee2e2;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#991b1b;">Outstanding</p><p style="margin:0;font-size:24px;font-weight:700;color:#991b1b;">₹${(+data.summary.outstanding ?? 0).toLocaleString('en-IN')}</p></div>
  <div style="background:#fef3c7;padding:14px;border-radius:8px;text-align:center;"><p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;color:#92400e;">Collection Rate</p><p style="margin:0;font-size:24px;font-weight:700;color:#92400e;">${data.summary.collection_rate ?? 0}%</p></div>
</div>` : ''}
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead><tr style="background:#f9fafb;"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Date</th><th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:right;">Daily Revenue</th><th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:right;">Cumulative</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="3" style="padding:20px;text-align:center;color:#9ca3af;">No data available</td></tr>'}</tbody>
</table>
<div style="margin-top:24px;text-align:center;"><p style="margin:0;font-size:10px;color:#9ca3af;font-style:italic;">Generated on ${new Date().toLocaleString()}</p></div>
</div></body></html>`;
}

function buildStaffReportHtml(data) {
  const rows = (data.doctors ?? []).map(d => `
    <tr><td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escapeHtml(d.first_name ?? '')} ${escapeHtml(d.last_name ?? '')}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${d.patients_seen ?? 0}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${d.prescriptions_count ?? 0}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${d.completed_appointments ?? 0}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Staff Performance Report</title></head>
<body style="margin:0;padding:20px 30px;font-family:Arial,sans-serif;font-size:13px;color:#111;">
<div style="max-width:800px;margin:0 auto;">
${hospitalHeaderHtml('Staff Performance Report')}
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead><tr style="background:#f9fafb;">
    <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;">Staff Member</th>
    <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:center;">Patients Seen</th>
    <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:center;">Prescriptions</th>
    <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;text-align:center;">Appointments</th>
  </tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="padding:20px;text-align:center;color:#9ca3af;">No data available</td></tr>'}</tbody>
</table>
<div style="margin-top:24px;text-align:center;"><p style="margin:0;font-size:10px;color:#9ca3af;font-style:italic;">Generated on ${new Date().toLocaleString()}</p></div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Actual generation (called by the BullMQ worker)
// ---------------------------------------------------------------------------
export async function generateReport({ type, format, period, userId }) {
  let data;
  switch (type) {
    case 'patient':   data = await analytics.getPatientStats(period);    break;
    case 'financial': data = await analytics.getFinancialStats(period);  break;
    case 'staff':    data = await analytics.getStaffPerformance(period); break;
    default: throw new Error(`Unknown report type: ${type}`);
  }

  let content, mimeType, ext;

  if (format === 'csv') {
    content  = buildCsv(type, data);
    mimeType = 'text/csv';
    ext      = 'csv';
  } else if (format === 'pdf') {
    let html;
    switch (type) {
      case 'patient':   html = buildPatientReportHtml(data); break;
      case 'financial':  html = buildFinancialReportHtml(data); break;
      case 'staff':     html = buildStaffReportHtml(data); break;
    }

    const filename = `report_${type}_${period}_${Date.now()}.pdf`;
    const reportsDir = join(process.cwd(), 'tmp', 'reports');

    let filePath;
    try {
      filePath = await generatePdfToFile(html, join(reportsDir, filename));
    } catch (err) {
      // Preserve the clear message from pdf.service; the report worker records
      // this as a failed job instead of crashing.
      if (err?.code !== 'PDF_UNAVAILABLE' && err?.code !== 'PDF_GENERATION_FAILED') {
        const wrapped = new Error(`Report generation failed: ${err?.message ?? String(err)}`);
        wrapped.code   = 'PDF_GENERATION_FAILED';
        wrapped.status = 500;
        wrapped.cause  = err;
        throw wrapped;
      }
      throw err;
    }

    // Store file path in Redis for download
    const downloadKey = `report:file:${filename}`;
    await redis.setex(downloadKey, REPORT_TTL, filePath);

    return { filename, downloadKey, mimeType: 'application/pdf', filePath };
  } else {
    content  = JSON.stringify(data, null, 2);
    mimeType = 'application/json';
    ext      = 'json';
  }

  // For CSV/JSON, store as base64 in Redis
  const filename = `report_${type}_${period}_${Date.now()}.${ext}`;
  const encoded  = Buffer.from(content).toString('base64');
  const downloadKey = `report:file:${filename}`;

  await redis.setex(downloadKey, REPORT_TTL, encoded);

  return { filename, downloadKey, mimeType };
}

// ---------------------------------------------------------------------------
// CSV builder
// ---------------------------------------------------------------------------
function buildCsv(type, data) {
  switch (type) {
    case 'patient': {
      const rows = data.admissions.map(r => ({
        date : r.date,
        count: r.count,
        running_total: r.running_total,
      }));
      return toCsv(['date','count','running_total'], rows);
    }
    case 'financial': {
      const rows = data.dailyRevenue.map(r => ({
        date      : r.date,
        revenue   : r.revenue,
        cumulative: r.cumulative,
      }));
      return toCsv(['date','revenue','cumulative'], rows);
    }
    case 'staff': {
      const rows = data.doctors.map(d => ({
        name                  : `${d.first_name} ${d.last_name}`,
        patients_seen         : d.patients_seen,
        prescriptions_count   : d.prescriptions_count,
        completed_appointments: d.completed_appointments,
      }));
      return toCsv(['name','patients_seen','prescriptions_count','completed_appointments'], rows);
    }
    default: return '';
  }
}

function toCsv(headers, rows) {
  const header = headers.join(',');
  const lines  = rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
  return [header, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------
export function reportJobKey(jobId) {
  return `report:job:${jobId}`;
}
