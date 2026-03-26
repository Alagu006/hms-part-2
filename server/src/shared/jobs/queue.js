import { Queue, Worker, QueueEvents } from 'bullmq';
import { sendMail } from '../services/mailer.js';

// ---------------------------------------------------------------------------
// Shared Redis connection config for BullMQ
// maxRetriesPerRequest must be null for BullMQ
// ---------------------------------------------------------------------------
const redisConnection = {
  host    : process.env.REDIS_HOST || '127.0.0.1',
  port    : parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db      : parseInt(process.env.REDIS_QUEUE_DB || '1', 10), // separate DB from session store
  maxRetriesPerRequest: null,
};

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------
export const emailQueue = new Queue('email', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts          : 3,
    backoff           : { type: 'exponential', delay: 5_000 },
    removeOnComplete  : { count: 100 },
    removeOnFail      : { count: 500 },
  },
});

export const notificationQueue = new Queue('notification', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts          : 5,
    backoff           : { type: 'exponential', delay: 2_000 },
    removeOnComplete  : { count: 200 },
    removeOnFail      : { count: 500 },
  },
});

export const reportQueue = new Queue('report', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts          : 2,
    backoff           : { type: 'fixed', delay: 10_000 },
    removeOnComplete  : { count: 50 },
    removeOnFail      : { count: 100 },
    // Reports can take a while
    timeout           : 5 * 60 * 1000,
  },
});

// ---------------------------------------------------------------------------
// Email Worker
// ---------------------------------------------------------------------------
export const emailWorker = new Worker(
  'email',
  async (job) => {
    const { to, subject, html } = job.data;

    if (!to || !subject || !html) {
      throw new Error(`Invalid email job payload: ${JSON.stringify(job.data)}`);
    }

    console.log(`[emailWorker] Processing job ${job.id} (${job.name}) → ${to}`);
    await sendMail({ to, subject, html });
    console.log(`[emailWorker] Sent job ${job.id} → ${to}`);
  },
  {
    connection  : redisConnection,
    concurrency : parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '3', 10),
  }
);

emailWorker.on('completed', (job) => {
  console.log(`[emailWorker] Job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[emailWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

emailWorker.on('error', (err) => {
  console.error('[emailWorker] Worker error:', err.message);
});

// ---------------------------------------------------------------------------
// Notification Worker (stub — wire to your notification service)
// ---------------------------------------------------------------------------
export const notificationWorker = new Worker(
  'notification',
  async (job) => {
    // Dispatch based on job name
    switch (job.name) {
      case 'push': {
        // TODO: integrate with your WebSocket/push notification service
        console.log(`[notificationWorker] Push notification for user ${job.data.userId}`);
        break;
      }
      case 'sms': {
        // TODO: integrate with SMS provider (Twilio, etc.)
        console.log(`[notificationWorker] SMS to ${job.data.phone}`);
        break;
      }
      default:
        console.warn(`[notificationWorker] Unknown job type: ${job.name}`);
    }
  },
  {
    connection : redisConnection,
    concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '5', 10),
  }
);

notificationWorker.on('failed', (job, err) => {
  console.error(`[notificationWorker] Job ${job?.id} failed: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Report Worker
// ---------------------------------------------------------------------------
export const reportWorker = new Worker(
  'report',
  async (job) => {
    // Lazy import to avoid circular deps at startup
    const { generateReport, reportJobKey } = await import('../../modules/analytics/report.service.js');
    const { redis: redisClient }           = await import('../services/redis.service.js');

    console.log(`[reportWorker] Generating report job ${job.id}: ${JSON.stringify(job.data)}`);

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

      // Update DB row if it exists
      const { pool: dbPool } = await import('../db/pool.js');
      await dbPool.query(
        `UPDATE report_jobs SET status = 'completed', download_key = $1, completed_at = NOW()
         WHERE job_id = $2`,
        [result.downloadKey, job.id]
      ).catch(() => {});

      console.log(`[reportWorker] Job ${job.id} completed → ${result.filename}`);
    } catch (err) {
      const { redis: redisClient2 } = await import('../services/redis.service.js');
      const { reportJobKey: rjk }   = await import('../../modules/analytics/report.service.js');
      await redisClient2.setex(
        rjk(job.id), 60 * 60,
        JSON.stringify({ status: 'failed', error: err.message, ...job.data })
      ).catch(() => {});
      throw err;
    }
  },
  {
    connection : redisConnection,
    concurrency: parseInt(process.env.REPORT_WORKER_CONCURRENCY || '2', 10),
  }
);

reportWorker.on('failed', (job, err) => {
  console.error(`[reportWorker] Job ${job?.id} failed: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Queue Events (optional monitoring)
// ---------------------------------------------------------------------------
export const emailQueueEvents = new QueueEvents('email', { connection: redisConnection });

emailQueueEvents.on('waiting',   ({ jobId })         => console.debug(`[emailQueue] Job ${jobId} waiting`));
emailQueueEvents.on('active',    ({ jobId })         => console.debug(`[emailQueue] Job ${jobId} active`));
emailQueueEvents.on('stalled',   ({ jobId })         => console.warn(`[emailQueue] Job ${jobId} stalled`));
emailQueueEvents.on('delayed',   ({ jobId, delay })  => console.debug(`[emailQueue] Job ${jobId} delayed ${delay}ms`));

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
export async function closeQueues() {
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    reportWorker.close(),
    emailQueue.close(),
    notificationQueue.close(),
    reportQueue.close(),
    emailQueueEvents.close(),
  ]);
  console.log('[queue] All queues and workers closed');
}
