import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { getMyAssignmentsSchema } from './nurse-assignments.schema.js';
import { getMyAssignments } from './nurse-assignments.controller.js';

const router = Router();

router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(
  '/',
  authorize('NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(getMyAssignmentsSchema),
  getMyAssignments
);

export default router;
