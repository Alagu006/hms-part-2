import { Queue, Worker, QueueEvents } from 'bullmq';
import { processEmailJob, processNotificationJob, processReportJob } from './worker-handlers.js';
import { validateWorkerConfig } from './workerConfig.js';
import { logger } from '../logger.js';

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
// Workers — handlers live in worker-handlers.js (unit-testable in isolation)
// ---------------------------------------------------------------------------
export const emailWorker = new Worker(
  'email',
  processEmailJob,
  {
    connection  : redisConnection,
    concurrency : parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '3', 10),
  }
);

emailWorker.on('completed', (job) => {
  logger.info(`[emailWorker] Job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  logger.error(`[emailWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
});

emailWorker.on('error', (err) => {
  logger.error('[emailWorker] Worker error:', { message: err.message });
});

export const notificationWorker = new Worker(
  'notification',
  processNotificationJob,
  {
    connection : redisConnection,
    concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '5', 10),
  }
);

notificationWorker.on('failed', (job, err) => {
  logger.error(`[notificationWorker] Job ${job?.id} failed: ${err.message}`);
});

export const reportWorker = new Worker(
  'report',
  processReportJob,
  {
    connection : redisConnection,
    concurrency: parseInt(process.env.REPORT_WORKER_CONCURRENCY || '2', 10),
  }
);

reportWorker.on('failed', (job, err) => {
  logger.error('[reportWorker] Job failed', { jobId: job?.id, message: err.message });
});

// ---------------------------------------------------------------------------
// Startup report — confirm the resolved credential scope for every worker
// ---------------------------------------------------------------------------
validateWorkerConfig();

// ---------------------------------------------------------------------------
// Queue Events (optional monitoring)
// ---------------------------------------------------------------------------
export const emailQueueEvents = new QueueEvents('email', { connection: redisConnection });

emailQueueEvents.on('waiting',   ({ jobId })         => logger.debug('[emailQueue] Job waiting',  { jobId }));
emailQueueEvents.on('active',    ({ jobId })         => logger.debug('[emailQueue] Job active',   { jobId }));
emailQueueEvents.on('stalled',   ({ jobId })         => logger.warn('[emailQueue] Job stalled',   { jobId }));
emailQueueEvents.on('delayed',   ({ jobId, delay })  => logger.debug('[emailQueue] Job delayed',  { jobId, delay }));

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
  logger.info('[queue] All queues and workers closed');
}
