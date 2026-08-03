// Live end-to-end verification for the BullMQ background workers.
//
// Requires a running Redis (REDIS_HOST:REDIS_PORT) and, for a clean email
// send, an SMTP sink on SMTP_HOST:SMTP_PORT (e.g. MailHog). The report job
// uses CSV format to avoid needing Chrome (and because report_jobs.format is
// constrained to 'pdf' | 'csv').
//
// Usage: node scripts/verify-workers.mjs

import 'dotenv/config';
import { emailQueue, notificationQueue, reportQueue, closeQueues, emailWorker, notificationWorker, reportWorker } from '../src/shared/jobs/queue.js';
import { enqueueReport, getReportStatus } from '../src/modules/analytics/report.service.js';
import { pool } from '../src/shared/db/pool.js';
import { logger } from '../src/shared/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntilFinished(queue, jobId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job  = await queue.getJob(jobId);
    const state = job ? await job.getState() : 'waiting';
    if (state === 'completed') return;
    if (state === 'failed') throw new Error(`Job ${jobId} failed`);
    await sleep(500);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for job ${jobId}`);
}

async function main() {
  logger.info('[verify-workers] Workers started — credential scope printed above');

  // Allow workers + queue connections to establish.
  await sleep(1500);

  // 1) Email worker — sent through the configured SMTP sink (MailHog).
  const emailJob = await emailQueue.add('notification', {
    to     : 'verify@hospital.local',
    subject: 'HMS worker verification',
    html   : '<p>This email confirms the emailWorker processed a live job.</p>',
  });
  await waitUntilFinished(emailQueue, emailJob.id);
  console.log(`PASS emailWorker  — job ${emailJob.id} completed`);

  // 2) Notification worker — push job (VAPID unset in .env → no-op success).
  const notifJob = await notificationQueue.add('push', {
    targetRole: 'DOCTOR',
    type      : 'SYSTEM',
    title     : 'Worker verify',
    body      : 'Background notification worker processed a live job.',
    entityId  : null,
  });
  await waitUntilFinished(notificationQueue, notifJob.id);
  console.log(`PASS notificationWorker — job ${notifJob.id} completed`);

  // 3) Report worker — real analytics aggregation + Redis status + DB history row.
  const { rows } = await pool.query('SELECT id FROM users ORDER BY created_at LIMIT 1');
  if (!rows[0]) throw new Error('No user row available to attach the report job to');
  const userId = rows[0].id;

  const { jobId } = await enqueueReport({ type: 'patient', format: 'csv', period: '2026-01-01' }, userId);

  let status = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    status = await getReportStatus(jobId);
    if (status?.status === 'completed') break;
    if (status?.status === 'failed') throw new Error(`Report job failed: ${status.error}`);
  }
  if (status?.status !== 'completed') throw new Error(`Report job did not complete — last status: ${status?.status ?? 'unknown'}`);
  console.log(`PASS reportWorker  — job ${jobId} completed (${status.mimeType}, key ${status.downloadKey})`);

  // Confirm the DB history row was updated (report_jobs.status = completed).
  const dbRow = await pool.query('SELECT status FROM report_jobs WHERE job_id = $1', [jobId]);
  if (dbRow.rows[0]?.status !== 'completed') {
    throw new Error(`report_jobs.status for ${jobId} is '${dbRow.rows[0]?.status ?? 'missing'}' (expected 'completed')`);
  }
  console.log(`PASS reportWorker  — report_jobs DB history row updated to 'completed'`);

  console.log('\nALL WORKER VERIFICATIONS PASSED');
}

try {
  await main();
  process.exitCode = 0;
} catch (err) {
  console.error(`\nWORKER VERIFICATION FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closeQueues().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(process.exitCode ?? 0);
}
