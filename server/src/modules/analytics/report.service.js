import { reportQueue }               from '../../shared/jobs/queue.js';
import { pool }                      from '../../shared/db/pool.js';
import { redis }                     from '../../shared/db/redis.js';
import { auditLog }                  from '../../shared/middleware/audit.js';
import { uuidv7 }                    from '../../shared/utils/uuid.js';
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
  await pool.query(
    `INSERT INTO report_jobs (id, job_id, user_id, type, format, period, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
     ON CONFLICT DO NOTHING`,
    [uuidv7(), job.id, userId, type, format, period]
  ).catch(() => {});

  await auditLog({
    userId,
    action  : 'GENERATE_REPORT',
    entity  : 'report_jobs',
    entityId: job.id,
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
  try { return JSON.parse(raw); } catch { return null; }
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
// Actual generation (called by the BullMQ worker)
// ---------------------------------------------------------------------------
export async function generateReport({ type, format, period, userId }) {
  let data;
  switch (type) {
    case 'patient':   data = await analytics.getPatientStats(period);    break;
    case 'financial': data = await analytics.getFinancialStats(period);  break;
    case 'staff':     data = await analytics.getStaffPerformance(period); break;
    default: throw new Error(`Unknown report type: ${type}`);
  }

  let content, mimeType, ext;

  if (format === 'csv') {
    content  = buildCsv(type, data);
    mimeType = 'text/csv';
    ext      = 'csv';
  } else {
    // PDF: return structured JSON that the client can render/print
    // In production wire to puppeteer or pdfkit
    content  = JSON.stringify(data, null, 2);
    mimeType = 'application/json';
    ext      = 'json';
  }

  // Store in Redis as base64 for download
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
