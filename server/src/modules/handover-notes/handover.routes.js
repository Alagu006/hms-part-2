import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  listHandoverSchema,
  createHandoverSchema,
  markReadSchema,
} from './handover.schema.js';
import {
  listHandover,
  createHandover,
  markHandoverRead,
} from './handover.controller.js';

const router = Router();

router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(
  '/',
  authorize('NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(listHandoverSchema),
  listHandover
);

router.post(
  '/',
  authorize('NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(createHandoverSchema),
  createHandover
);

router.patch(
  '/:id/read',
  authorize('NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(markReadSchema),
  markHandoverRead
);

export default router;
