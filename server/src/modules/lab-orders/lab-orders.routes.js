import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  listLabOrdersSchema,
  updateLabOrderSchema,
  createLabResultSchema,
} from './lab-orders.schema.js';
import {
  listLabOrders,
  updateLabOrder,
  createLabResult,
} from './lab-orders.controller.js';

const router = Router();

router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(
  '/',
  authorize('LAB_TECH', 'DOCTOR', 'NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(listLabOrdersSchema),
  listLabOrders
);

router.patch(
  '/:id',
  authorize('LAB_TECH', 'ADMIN', 'SUPER_ADMIN'),
  validate(updateLabOrderSchema),
  updateLabOrder
);

router.post(
  '/results',
  authorize('LAB_TECH', 'ADMIN', 'SUPER_ADMIN'),
  validate(createLabResultSchema),
  createLabResult
);

export default router;
