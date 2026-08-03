import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Worker job handlers.
//
// Extracted from queue.js so each handler can be unit-tested in isolation.
// Dependencies are lazy-imported inside each handler — importing this module
// never opens a Redis/DB/SMTP connection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Email worker — SMTP dispatch
// ---------------------------------------------------------------------------
export async function processEmailJob(job) {
  const { to, subject, html } = job.data;

  if (!to || !subject || !html) {
    throw new Error(`Invalid email job payload: ${JSON.stringify(job.data)}`);
  }

  logger.info(`[emailWorker] Processing job ${job.id} (${job.name}) → ${to}`);
  const { sendMail } = await import('../services/mailer.js');
  await sendMail({ to, subject, html });
  logger.info(`[emailWorker] Sent job ${job.id} → ${to}`);
}

// ---------------------------------------------------------------------------
// Notification worker — Web Push + SMS dispatch
// ---------------------------------------------------------------------------
export async function processNotificationJob(job) {
  switch (job.name) {
    case 'push': {
      const { userId, targetRole, type, title, body, entityId } = job.data;

      const { sendPushNotification } = await import('../services/webpush.service.js');
      const { pool: dbPool }         = await import('../db/pool.js');

      if (userId) {
        // Push to a specific user
        await sendPushNotification(userId, { title, body, data: { type, entityId } });
        logger.info(`[notificationWorker] Push sent to user ${userId}`);
      } else if (targetRole) {
        // Broadcast to all users with a given role
        const { rows } = await dbPool.query(
          `SELECT DISTINCT ur.user_id
           FROM user_roles ur
           WHERE ur.role = $1 AND ur.revoked_at IS NULL`,
          [targetRole]
        );
        await Promise.allSettled(
          rows.map((r) =>
            sendPushNotification(r.user_id, { title, body, data: { type, entityId } })
          )
        );
        logger.info(`[notificationWorker] Push broadcast to ${rows.length} users with role ${targetRole}`);
      }
      break;
    }

    case 'sms': {
      const { phone, message } = job.data;
      if (!phone || !message) {
        logger.warn('[notificationWorker] SMS job missing phone or message');
        break;
      }

      // SMS provider integration — configure TWILIO_* env vars to enable
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken  = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_FROM_NUMBER;

      if (!accountSid || !authToken || !fromNumber) {
        logger.warn('[notificationWorker] SMS skipped — TWILIO_* env vars not configured');
        break;
      }

      // Use native fetch to call Twilio REST API (no SDK dependency needed)
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const body = new URLSearchParams({
        To  : phone,
        From: fromNumber,
        Body: message,
      });

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method : 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type' : 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Twilio error ${res.status}: ${err.message ?? 'Unknown'}`);
      }

      const result = await res.json();
      logger.info(`[notificationWorker] SMS sent to ${phone}, SID: ${result.sid}`);
      break;
    }

    default:
      logger.warn(`[notificationWorker] Unknown job type: ${job.name}`);
  }
}

// ---------------------------------------------------------------------------
// Report worker — analytics aggregation + PDF/CSV/JSON generation
// ---------------------------------------------------------------------------
export async function processReportJob(job) {
  const { generateReport, reportJobKey } = await import('../../modules/analytics/report.service.js');
  const { redis: redisClient }           = await import('../services/redis.service.js');
  const { pool: dbPool }                 = await import('../db/pool.js');

  logger.info('[reportWorker] Generating report job', { jobId: job.id, data: job.data });

  try {
    const result = await generateReport(job.data);

    // Update status in Redis
    await redisClient.setex(
      reportJobKey(job.id),
      60 * 60,
      JSON.stringify({
        status     : 'completed',
        ...job.data,
        filename   : result.filename,
        downloadKey: result.downloadKey,
        mimeType   : result.mimeType,
        completedAt: new Date().toISOString(),
      })
    );

    // Best-effort DB history row — the authoritative job status was already
    // written to Redis above; a DB failure here must not fail the job.
    await dbPool.query(
      `UPDATE report_jobs SET status = 'completed', download_key = $1, completed_at = NOW()
       WHERE job_id = $2`,
      [result.downloadKey, job.id]
    ).catch(() => {});

    logger.info('[reportWorker] Job completed', { jobId: job.id, filename: result.filename });
  } catch (err) {
    const { redis: redisClient2 } = await import('../services/redis.service.js');
    const { reportJobKey: rjk }   = await import('../../modules/analytics/report.service.js');
    // Best-effort: record the failure in Redis; the original error still
    // propagates so BullMQ can retry/flag the job regardless.
    await redisClient2.setex(
      rjk(job.id), 60 * 60,
      JSON.stringify({ status: 'failed', error: err.message, ...job.data })
    ).catch(() => {});
    throw err;
  }
}
