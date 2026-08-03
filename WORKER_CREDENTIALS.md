# Background Worker Credentials & Access Scope

The server runs three BullMQ background workers — email, notification, and
report — to keep slow work (SMTP, web push, SMS, analytics/PDF) off the request
thread. This document is the authoritative record of **exactly** what each
worker is allowed to access, and confirms that none of them have more access
than they need.

The authoritative machine-readable manifest lives in
`server/src/shared/jobs/workerConfig.js` and is printed as a startup report by
`validateWorkerConfig()` when the queue module loads.

## 1. Architecture context

- All three workers are **in-process**: `server/src/shared/jobs/queue.js`
  instantiates `emailWorker`, `notificationWorker`, and `reportWorker` in the
  same Node process as the API. They share one BullMQ Redis connection
  (`REDIS_QUEUE_DB`, default **DB 1**), separate from the session/rate-limit
  store (`REDIS_DB`, default **DB 0**).
- Because they share the process, workers share the OS environment. They are
  intentionally kept on the **least-privilege surface**:
  - **Database**: every worker goes through the shared pool, which connects as
    the DML-only role `hms_api` — `SELECT`/`INSERT`/`UPDATE`/`DELETE` only, no
    DDL, no superuser. The worker code paths contain **no** `CREATE`/`ALTER`/
    `DROP`/`GRANT`/`TRUNCATE` statements (verified by grep across the worker
    reachable modules).
  - **Redis**: queue traffic is isolated to the BullMQ database (DB 1).
  - The handlers live in `server/src/shared/jobs/worker-handlers.js`, isolated
    from the BullMQ infrastructure so each can be unit-tested directly
    (`tests/workers.test.js`).
- Job handlers are invoked lazily; the only static import in the handler module
  is the logger.

## 2. Worker access matrix

### `emailWorker` — queue `email`

| Resource | Access | Env vars consumed |
|---|---|---|
| SMTP server | send mail (temp passwords, OTPs, notifications) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| — | — | `EMAIL_WORKER_CONCURRENCY` |

No database and no Redis beyond the BullMQ connection. **Required**: `SMTP_USER`
and `SMTP_PASS` (the worker cannot send mail without them). On startup the
validator logs `Missing REQUIRED credentials` if they are absent.

### `notificationWorker` — queue `notification`

| Resource | Access | Env vars consumed |
|---|---|---|
| Postgres (via `hms_api`, DML only) | `SELECT` on `user_roles` and `push_subscriptions` (read recipients); `DELETE` on `push_subscriptions` for expired (410) subscriptions | — |
| Web Push (VAPID) | send push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` |
| Twilio (SMS) | send SMS via REST API (native `fetch`, no SDK) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| — | — | `NOTIFICATION_WORKER_CONCURRENCY` |

Both channels are **optional**: push runs only if VAPID keys are set; SMS runs
only if all three `TWILIO_*` vars are set (otherwise the job logs a warning and
is skipped). The worker performs **reads only** on the database — it never
writes notification rows (those are written synchronously by the request path).

### `reportWorker` — queue `report`

| Resource | Access | Env vars consumed |
|---|---|---|
| Postgres (via `hms_api`, DML only) | `SELECT` across ~20 analytics tables (patients, bills, payments, appointments, users, prescriptions, lab orders, inventory, ...) via `analytics.service.js`; `UPDATE report_jobs` to record completion | — |
| Redis (queue DB, DB 1) | `report:job:*` status keys and `report:file:*` download payloads | — |
| Filesystem | writes generated PDFs under `tmp/reports` | — |
| Chrome (puppeteer) | PDF rendering | — |
| — | — | `REPORT_WORKER_CONCURRENCY` |

The DB history update (`UPDATE report_jobs ...`) is best-effort — failures are
swallowed because the authoritative status is written to Redis first.

## 3. Why workers do not have more access

- **No DDL anywhere**: the analytics/report/notification reachable code is
  entirely `SELECT`/`INSERT`/`UPDATE`/`DELETE`, all permitted by the
  least-privilege `hms_api` role. There is no `CREATE`, `ALTER`, `DROP`,
  `GRANT`, `REVOKE`, or `TRUNCATE` in any worker-reachable module.
- **No session-store access**: workers use `REDIS_QUEUE_DB` (DB 1) only; they
  never touch the session/rate-limit Redis DB (DB 0) or user auth data.
- **No other secrets**: the only secrets a worker can consume are SMTP, VAPID,
  and Twilio — exactly the outbound channels background jobs need.

## 4. Migrations are NOT reachable from any worker

`server/src/db/migrate.js` connects with its **own explicit** credentials
(`DB_MIGRATOR_*`) and does **not** fall back to the app password
(`DB_PASSWORD`). The running API and its workers use `hms_api` (DML only), so a
compromised worker cannot execute DDL or run migrations. The `hms_migrator`
role is only ever used by the `npm run migrate` command, which requires
`DB_MIGRATOR_PASSWORD` to be set explicitly.

## 5. Verifying the workers

Automated handler tests (no Redis needed): `npx vitest run tests/workers.test.js`.

Live end-to-end verification (needs Redis up, and an SMTP sink such as MailHog
for a clean email send):

```bash
cd server && npm run verify:workers   # → scripts/verify-workers.mjs
```

The script enqueues an email, a push notification, and a patient CSV report
through the real BullMQ queues, waits for completion, and asserts the
`report_jobs` history row reaches `completed`. Manual equivalent:

1. **Email**: trigger `sendTempPassword`/`sendOTP`/`sendNotification` from
   `server/src/shared/services/email.service.js`; watch for the
   `[emailWorker] Job ... completed` log and a mail in the configured SMTP sink
   (e.g. Mailhog).
2. **Notification**: enqueue a `push` job (specific `userId` or `targetRole`)
   or an `sms` job; watch `[notificationWorker]` completion logs.
3. **Report**: call `enqueueReport` from
   `server/src/modules/analytics/report.service.js`; poll `getReportStatus`
   until `status: 'completed'` and confirm `report:file:*` resolves to a
   downloadable payload. Note `report_jobs.format` is constrained to
   `'pdf' | 'csv'`; the JSON format is generated but not persisted to history.
