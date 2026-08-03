import { Router } from 'express';
import { z }               from 'zod';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  getInsights,
  acknowledgeAlert,
  dismissAlert,
} from './cds.service.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

const acknowledgeSchema = z.object({
  params: z.object({ alertId: z.string().uuid() }),
  body  : z.object({ reason: z.string().max(500).optional() }),
});

const dismissSchema = z.object({
  params: z.object({ alertId: z.string().uuid() }),
  body  : z.object({ reason: z.string().max(500).optional() }),
});

// GET /cds/insights/:patientId — get CDS alerts for a patient
router.get(
  '/insights/:patientId',
  authorize('DOCTOR', 'NURSE', 'ADMIN', 'SUPER_ADMIN'),
  async (req, res) => {
    try {
      const insights = await getInsights(req.params.patientId, req.user.id);
      res.json({ data: insights });
    } catch (err) {
      console.error('CDS Insights Error:', err);
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
);

// POST /cds/alerts/:alertId/acknowledge
router.post(
  '/alerts/:alertId/acknowledge',
  authorize('DOCTOR', 'NURSE'),
  validate(acknowledgeSchema),
  async (req, res) => {
    try {
      await acknowledgeAlert(req.params.alertId, req.user.id, req.body.reason);
      res.json({ success: true });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
);

// POST /cds/alerts/:alertId/dismiss
router.post(
  '/alerts/:alertId/dismiss',
  authorize('DOCTOR', 'NURSE'),
  validate(dismissSchema),
  async (req, res) => {
    try {
      await dismissAlert(req.params.alertId, req.user.id, req.body.reason);
      res.json({ success: true });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
);

export default router;
