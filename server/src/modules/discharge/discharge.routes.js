import { Router }           from 'express';
import { authenticate }     from '../../shared/middleware/auth.js';
import { authorize }        from '../../shared/middleware/rbac.js';
import { validate }         from '../../shared/middleware/validate.js';
import { auditMiddleware }  from '../../shared/middleware/audit.js';
import { apiRateLimiter }   from '../../shared/middleware/rateLimiter.js';
import { createDischargeSummarySchema, getPatientDischargeSummariesSchema } from './discharge.schema.js';
import * as ctrl from './discharge.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

router.post(
  '/',
  authorize('DOCTOR'),
  validate(createDischargeSummarySchema),
  ctrl.createDischargeSummary
);

router.get(
  '/:patientId',
  authorize('DOCTOR', 'NURSE', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getPatientDischargeSummariesSchema),
  ctrl.getPatientDischargeSummaries
);

export default router;
