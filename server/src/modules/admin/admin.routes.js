import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.js';
import { adminOnly, authorize } from '../../shared/middleware/rbac.js';
import { validate } from '../../shared/middleware/validate.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import * as ctrl from './admin.controller.js';
import {
  auditLogsQuerySchema,
  usersQuerySchema,
  setStatusSchema,
  sessionDeleteSchema,
} from './admin.schema.js';

const router = Router();

router.use(authenticate, adminOnly, apiRateLimiter, auditMiddleware);

router.get('/stats',              ctrl.getStats);
router.get('/audit-logs',         validate(auditLogsQuerySchema), ctrl.getAuditLogs);
router.get('/audit-logs/verify',  ctrl.verifyAuditChain);
router.get('/users',              validate(usersQuerySchema), ctrl.getUsers);
router.patch(
  '/users/:id/status',
  authorize('SUPER_ADMIN'),
  validate(setStatusSchema),
  ctrl.setUserStatus
);
router.get('/sessions',           ctrl.getSessions);
router.delete(
  '/sessions/:id',
  validate(sessionDeleteSchema),
  ctrl.deleteSession
);

export default router;
