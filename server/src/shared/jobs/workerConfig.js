import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Worker credential manifest
//
// Single source of truth for the environment variables a BullMQ worker is
// permitted to consume. A background job must never reach beyond this list;
// anything it needs has to be declared here first so the scope stays auditable.
//
// Every worker runs in-process with the API, so the OS-level env is shared.
// These workers are deliberately kept on the least-privilege surface:
//   - DB access flows through the shared pool, which connects as the
//     DML-only role hms_api (no DDL, no superuser).
//   - Redis jobs live in the queue DB (REDIS_QUEUE_DB, default 1), separate
//     from the session/rate-limit store (REDIS_DB, default 0).
// ---------------------------------------------------------------------------
export const WORKER_SCOPES = Object.freeze({
  email: {
    label: 'emailWorker',
    env   : [
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
      'EMAIL_WORKER_CONCURRENCY',
    ],
    required: ['SMTP_USER', 'SMTP_PASS'],
    note    : 'Sends outbound mail (temporary passwords, OTPs, notifications) over SMTP.',
  },

  notification: {
    label: 'notificationWorker',
    env   : [
      'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_CONTACT_EMAIL',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
      'NOTIFICATION_WORKER_CONCURRENCY',
    ],
    required: [],
    note    : 'Web Push (VAPID) + SMS (Twilio). Both channels are optional; the worker runs with whichever are configured.',
  },

  report: {
    label: 'reportWorker',
    env   : [
      'REPORT_WORKER_CONCURRENCY',
    ],
    required: [],
    note    : 'DB reads/writes use the shared least-privilege pool (hms_api, DML only); Redis status writes use the queue DB; PDFs are written under tmp/reports via Chrome.',
  },
});

export function workerScope(name) {
  return WORKER_SCOPES[name] ?? null;
}

// ---------------------------------------------------------------------------
// Startup validation — surface the resolved credential scope so nothing runs
// silently in a degraded or misconfigured state.
// ---------------------------------------------------------------------------
export function validateWorkerConfig() {
  for (const [name, scope] of Object.entries(WORKER_SCOPES)) {
    const present = [];
    const absent  = [];
    for (const key of scope.env) {
      (process.env[key] ? present : absent).push(key);
    }

    const missingRequired = scope.required.filter((key) => !process.env[key]);

    if (missingRequired.length) {
      logger.error(
        `[${scope.label}] Missing REQUIRED credentials: ${missingRequired.join(', ')} — this worker will not function as intended.`
      );
    } else if (present.length) {
      logger.info(
        `[${scope.label}] credential scope resolved (${present.length}/${scope.env.length}): ${present.join(', ')}`
      );
    } else {
      logger.info(`[${scope.label}] credential scope resolved — no ${name} env vars configured`);
    }
  }
}
