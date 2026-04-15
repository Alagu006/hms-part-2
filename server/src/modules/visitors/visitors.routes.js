import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }      from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  logVisitorSchema,
  visitorHistorySchema,
  checkoutVisitorSchema,
  listVisitorsSchema,
  searchVisitorsSchema,
} from './visitors.schema.js';
import {
  logVisitor,
  getVisitorHistory,
  listAllVisitors,
  checkoutVisitor,
  searchVisitors,
} from './visitors.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.post(
  '/',
  authorize('RECEPTIONIST', 'SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN'),
  validate(logVisitorSchema),
  logVisitor
);

router.get(
  '/',
  authorize('RECEPTIONIST', 'SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN'),
  validate(listVisitorsSchema),
  listAllVisitors
);

router.get(
  '/patient/:patientId',
  authorize('RECEPTIONIST', 'SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN'),
  validate(visitorHistorySchema),
  getVisitorHistory
);

router.patch(
  '/:id/checkout',
  authorize('RECEPTIONIST', 'SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN'),
  validate(checkoutVisitorSchema),
  checkoutVisitor
);

router.get(
  '/search',
  authorize('RECEPTIONIST', 'SECURITY_OFC', 'ADMIN', 'SUPER_ADMIN'),
  validate(searchVisitorsSchema),
  searchVisitors
);

export default router;
