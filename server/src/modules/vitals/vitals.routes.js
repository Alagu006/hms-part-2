import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { recordVitalsSchema, vitalsHistorySchema, vitalsCountSchema } from './vitals.schema.js';
import { recordVitals, getVitalsHistory, getVitalsCount }          from './vitals.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.post(
  '/',
  authorize('NURSE', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  validate(recordVitalsSchema),
  recordVitals
);

router.get(
  '/count',
  authorize('NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(vitalsCountSchema),
  getVitalsCount
);

router.get(
  '/patient/:patientId',
  authorize('DOCTOR', 'NURSE', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(vitalsHistorySchema),
  getVitalsHistory
);

export default router;
