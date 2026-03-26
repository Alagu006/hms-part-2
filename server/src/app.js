import express        from 'express';
import cookieParser  from 'cookie-parser';
import cors          from 'cors';
import helmet        from 'helmet';
import { createServer } from 'http';

// ── Middleware ────────────────────────────────────────────────────────────────
import { apiRateLimiter } from './shared/middleware/rateLimiter.js';

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

// ── Socket bootstrap ──────────────────────────────────────────────────────────
import { initSocket } from './socket.js';

const app = express();

// ── 1. Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ── 2. CORS ───────────────────────────────────────────────────────────────────
app.use(cors({
  origin     : process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
}));

// ── 3. Global rate limiter ────────────────────────────────────────────────────
app.use('/api', apiRateLimiter);

// ── 4. Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── 5. Routes ─────────────────────────────────────────────────────────────────
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 6. Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message ?? 'Internal server error' });
});

// ── HTTP server + Socket.io ───────────────────────────────────────────────────
const httpServer = createServer(app);
const io = initSocket(httpServer);

// Make io accessible in route handlers via req.app.get('io')
app.set('io', io);

export { app, httpServer, io };
