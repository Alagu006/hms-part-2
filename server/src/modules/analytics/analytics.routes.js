import { Router }          from 'express';
import { z }               from 'zod';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter, rateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  patientStatsSchema,
  financialSchema,
  staffPerformanceSchema,
  operationalSchema,
  generateReportSchema,
  reportHistorySchema,
  reportStatusSchema,
  downloadKeySchema,
} from './analytics.schema.js';
import * as ctrl from './analytics.controller.js';

const router = Router();

// Tighter limiter for report generation: 10 per 10 minutes per user
const reportGenerateLimiter = rateLimiter({
  windowSecs: 10 * 60,
  max       : 10,
  keyFn     : (req) => `report:gen:${req.user?.id ?? req.ip}`,
});

router.use(apiRateLimiter, authenticate);

const adminOrDoctor = authorize('ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'HR');

// ── Analytics (read-only — no auditMiddleware needed) ──────────────────────
router.get('/patient-stats',
  adminOrDoctor,
  validate(patientStatsSchema),
  ctrl.patientStats
);

router.get('/financial',
  authorize('ADMIN', 'SUPER_ADMIN', 'BILLING'),
  validate(financialSchema),
  ctrl.financialStats
);

router.get('/staff-performance',
  authorize('ADMIN', 'SUPER_ADMIN', 'HR'),
  validate(staffPerformanceSchema),
  ctrl.staffPerformance
);

router.get('/operational',
  adminOrDoctor,
  validate(operationalSchema),
  ctrl.operationalStats
);

// ── Reports (writes — apply auditMiddleware) ───────────────────────────────
router.get('/reports/generate',
  authorize('ADMIN', 'SUPER_ADMIN'),
  reportGenerateLimiter,
  auditMiddleware,
  validate(generateReportSchema),
  ctrl.generateReport
);

router.get('/reports/history',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(reportHistorySchema),
  ctrl.reportHistory
);

router.get('/reports/status/:jobId',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(reportStatusSchema),
  ctrl.reportStatus
);

router.get('/reports/download/:key',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(downloadKeySchema),
  ctrl.downloadReport
);

export default router;
