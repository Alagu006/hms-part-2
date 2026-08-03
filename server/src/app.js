import 'dotenv/config';
import express        from 'express';
import crypto        from 'crypto';
import cookieParser  from 'cookie-parser';
import cors          from 'cors';
import helmet        from 'helmet';
import { createServer } from 'http';
import { doubleCsrf } from 'csrf-csrf';
import { logger }    from './shared/logger.js';
import { corsOriginCheck } from './shared/utils/corsOriginCheck.js';

// ── Middleware ────────────────────────────────────────────────────────────────
import { apiRateLimiter } from './shared/middleware/rateLimiter.js';
import { auditMiddleware } from './shared/middleware/audit.js';
import { ipBlockMiddleware } from './shared/middleware/ipBlock.js';

// ── Route modules ─────────────────────────────────────────────────────────────
import authRoutes         from './modules/auth/auth.routes.js';
import adminRoutes        from './modules/admin/admin.routes.js';
import analyticsRoutes    from './modules/analytics/analytics.routes.js';
import billingRoutes      from './modules/billing/billing.routes.js';
import bloodBankRoutes    from './modules/blood-bank/blood-bank.routes.js';
import broadcastRoutes    from './modules/broadcast/broadcast.routes.js';
import chatbotRoutes      from './modules/chatbot/chatbot.routes.js';
import dischargeRoutes    from './modules/discharge/discharge.routes.js';
import fileRoutes         from './modules/files/file.routes.js';
import incidentRoutes     from './modules/incidents/incident.routes.js';
import inventoryRoutes    from './modules/inventory/inventory.routes.js';
import leavesRoutes       from './modules/leaves/leave.routes.js';
import messagingRoutes    from './modules/messaging/messaging.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import otRoutes           from './modules/ot-scheduling/ot.routes.js';
import patientRoutes      from './modules/patient/patient.routes.js';
import prescriptionRoutes from './modules/prescription/prescription.routes.js';
import telemedicineRoutes from './modules/telemedicine/telemedicine.routes.js';
import vitalsRoutes       from './modules/vitals/vitals.routes.js';
import appointmentsRoutes from './modules/appointments/appointments.routes.js';
import departmentsRoutes  from './modules/departments/departments.routes.js';
import doctorsRoutes      from './modules/doctors/doctors.routes.js';
import shiftsRoutes       from './modules/shifts/shifts.routes.js';
import nurseAssignmentsRoutes from './modules/nurse-assignments/nurse-assignments.routes.js';
import handoverNotesRoutes   from './modules/handover-notes/handover.routes.js';
import labOrdersRoutes    from './modules/lab-orders/lab-orders.routes.js';
import visitorsRoutes    from './modules/visitors/visitors.routes.js';
import dietPlansRoutes   from './modules/diet-plans/diet-plans.routes.js';
import caseNotesRoutes   from './modules/case-notes/case-notes.routes.js';
import contactRoutes     from './modules/contact/contact.routes.js';
import cdsRoutes         from './modules/cds/cds.routes.js';
import payrollRoutes     from './modules/payroll/payroll.routes.js';

// ── Socket bootstrap ──────────────────────────────────────────────────────────
import { initSocket } from './socket.js';

// ---------------------------------------------------------------------------
// Startup environment validation — fail fast if required secrets are missing
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  'JWT_PRIVATE_KEY_PATH', 'JWT_PUBLIC_KEY_PATH',
  'PG_CRYPTO_KEY', 'DB_ENCRYPTION_KEY',
  'CSRF_SECRET',
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`[startup] FATAL — missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const app = express();

// ── Trust proxy — restrict to loopback only in dev, configurable in prod ──────
// Setting to 'true' blindly trusts any X-Forwarded-For header which can be
// spoofed. Use the number of trusted proxy hops instead.
const TRUST_PROXY = process.env.TRUST_PROXY_HOPS
  ? parseInt(process.env.TRUST_PROXY_HOPS, 10)
  : process.env.NODE_ENV === 'production' ? 1 : 'loopback';
app.set('trust proxy', TRUST_PROXY);

// ── 1. Request ID (FIRST middleware) ─────────────────────────────────────────
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// ── 2. Security headers ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc : ["'self'"],
      scriptSrc : ["'self'"],
      // Nonce-based inline styles would be ideal but require SSR support.
      // For now we allow unsafe-inline only in development; production should
      // migrate to CSS-in-JS or external stylesheets and remove this.
      styleSrc  : process.env.NODE_ENV === 'production'
        ? ["'self'"]
        : ["'self'", "'unsafe-inline'"],
      imgSrc    : ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:'],
    },
  },
  // HSTS — only in production to avoid breaking local HTTP dev
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    features: {
      camera      : [],
      microphone  : [],
      geolocation : [],
      payment     : [],
    },
  },
  crossOriginOpenerPolicy : { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// ── 2. CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin: corsOriginCheck,
  credentials: true,
}));

// ── 3. Global rate limiter ────────────────────────────────────────────────────
app.use('/api', apiRateLimiter);

// ── 3b. IP block check ────────────────────────────────────────────────────────
// FAIL-CLOSED: see ipBlock.js — an unreachable block list rejects with 503
// instead of letting requests through unchecked.
app.use('/api', ipBlockMiddleware);

// ── 4. Audit middleware (all /api routes) ─────────────────────────────────────
app.use('/api', auditMiddleware);

// ── 4. Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── 5. CSRF protection ────────────────────────────────────────────────────────
const CSRF_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-psifi.x-csrf-token' : 'x-csrf-token';

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  getSessionIdentifier: (req) => req.ip ?? 'anonymous',
  cookieName: CSRF_COOKIE,
  cookieOptions: { secure: process.env.NODE_ENV === 'production', sameSite: 'strict', httpOnly: true },
  size: 64,
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  return doubleCsrfProtection(req, res, next);
});

// ── 5b. Input sanitization — strip null bytes and control characters ──────────
function sanitizeValue(value) {
  if (typeof value === 'string') {
    return value.replace(/\0/g, '').replace(/[\x00-\x1F\x7F]/g, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitizeValue(v);
    }
    return result;
  }
  return value;
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
});

// ── 6. Routes ─────────────────────────────────────────────────────────────────
app.get('/api/auth/csrf-token', (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});
app.use('/api/auth',               authRoutes);
app.use('/api/admin',              adminRoutes);
app.use('/api/analytics',          analyticsRoutes);
app.use('/api/bills',              billingRoutes);
app.use('/api/blood-bank',         bloodBankRoutes);
app.use('/api/broadcasts',         broadcastRoutes);
app.use('/api/chatbot',            chatbotRoutes);
app.use('/api/discharge-summaries', dischargeRoutes);
app.use('/api/files',              fileRoutes);
app.use('/api/incidents',          incidentRoutes);
app.use('/api/inventory',          inventoryRoutes);
app.use('/api/leaves',             leavesRoutes);
app.use('/api/messaging',          messagingRoutes);
app.use('/api/notifications',      notificationRoutes);
app.use('/api/ot-schedules',       otRoutes);
app.use('/api/patients',           patientRoutes);
app.use('/api/prescriptions',      prescriptionRoutes);
app.use('/api/telemedicine',       telemedicineRoutes);
app.use('/api/vitals',             vitalsRoutes);
app.use('/api/appointments',        appointmentsRoutes);
app.use('/api/departments',         departmentsRoutes);
app.use('/api/doctors',            doctorsRoutes);
app.use('/api/shifts',             shiftsRoutes);
app.use('/api/visitors',           visitorsRoutes);
app.use('/api/nurse/assignments',  nurseAssignmentsRoutes);
app.use('/api/handover-notes',     handoverNotesRoutes);
app.use('/api/lab-orders',         labOrdersRoutes);
app.use('/api/diet-plans',         dietPlansRoutes);
app.use('/api/case-notes',         caseNotesRoutes);
app.use('/api/contact',            contactRoutes);
app.use('/api/cds',                cdsRoutes);
app.use('/api/payroll',            payrollRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 6. Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) {
    logger.error(err.message ?? 'Internal server error', {
      requestId : req.requestId,
      method    : req.method,
      path      : req.path,
      statusCode: status,
      stack     : err.stack,
    });
  }
  res.status(status).json({ error: err.message ?? 'Internal server error' });
});

// ── HTTP server + Socket.io ───────────────────────────────────────────────────
const httpServer = createServer(app);
const io = initSocket(httpServer);

// Make io accessible in route handlers via req.app.get('io')
app.set('io', io);

const PORT = parseInt(process.env.PORT || '5000', 10);
httpServer.listen(PORT, () => {
  logger.info('Server started', { NODE_ENV: process.env.NODE_ENV, PORT });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`[shutdown] Received ${signal} — shutting down gracefully`);

  // Stop accepting new connections
  httpServer.close(async () => {
    logger.info('[shutdown] HTTP server closed');

    try {
      // Close BullMQ queues and workers
      const { closeQueues } = await import('./shared/jobs/queue.js');
      await closeQueues();
      logger.info('[shutdown] BullMQ queues closed');
    } catch (e) {
      logger.warn('[shutdown] Queue close error:', { message: e.message });
    }

    try {
      // Close DB pool
      const { pool } = await import('./shared/db/pool.js');
      await pool.end();
      logger.info('[shutdown] DB pool closed');
    } catch (e) {
      logger.warn('[shutdown] DB pool close error:', { message: e.message });
    }

    try {
      // Close Redis
      const { redis } = await import('./shared/services/redis.service.js');
      await redis.quit();
      logger.info('[shutdown] Redis closed');
    } catch (e) {
      logger.warn('[shutdown] Redis close error:', { message: e.message });
    }

    logger.info('[shutdown] Clean exit');
    process.exit(0);
  });

  // Force exit after 15 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Process-level resilience guards ──────────────────────────────────────────
// A Redis/DB outage must never crash the process — the fail-closed middleware
// (503s) only helps if the server stays up to serve them. Log and continue.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.message : reason });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — continuing', { message: err.message, stack: err.stack });
});

export { app, httpServer, io };
