import { Worker }  from 'bullmq';
import { query }   from '../../shared/db/pool.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { logger }  from '../../shared/logger.js';

const redisConnection = {
  host    : process.env.REDIS_HOST || '127.0.0.1',
  port    : parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db      : parseInt(process.env.REDIS_QUEUE_DB || '1', 10),
  maxRetriesPerRequest: null,
};

export function startTelemedicineWorker(io) {
  const worker = new Worker(
    'telemedicine',
    async (job) => {
      if (job.name !== 'reminder') return;

      const { sessionId, doctorId, patientUserId } = job.data;

      // Verify session still scheduled
      const { rows } = await query(
        `SELECT status, scheduled_at FROM telemedicine_sessions WHERE id = $1`,
        [sessionId]
      );
      const session = rows[0];
      if (!session || session.status !== 'SCHEDULED') return;

      const timeStr = new Date(session.scheduled_at).toLocaleString('en-GB', {
        timeStyle: 'short',
      });

      await Promise.allSettled([
        createNotification(
          doctorId,
          NotificationType.TELEMEDICINE_REMINDER,
          'Telemedicine session in 15 minutes',
          `Your video consultation starts at ${timeStr}`,
          { entityType: 'TELEMEDICINE', entityId: sessionId, priority: 'HIGH' },
          io
        ),
        patientUserId && createNotification(
          patientUserId,
          NotificationType.TELEMEDICINE_REMINDER,
          'Video consultation in 15 minutes',
          `Your appointment starts at ${timeStr}. Click to join.`,
          { entityType: 'TELEMEDICINE', entityId: sessionId, priority: 'HIGH' },
          io
        ),
      ]);

      logger.info('[tele-worker] Sent 15-min reminders', { sessionId });
    },
    { connection: redisConnection, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    logger.error('[tele-worker] Job failed', { jobId: job?.id, message: err.message });
  });

  return worker;
}
