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
  createUserSchema,
  updateUserSchema,
  flagAuditLogSchema,
  blockIpSchema,
  unblockIpSchema,
} from './admin.schema.js';

const router = Router();

router.use(authenticate, apiRateLimiter);

// Stats — admin + HR can view
router.get('/stats',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  ctrl.getStats
);

// Audit logs — admin + IT_ADMIN + INVENTORY can view
router.get('/audit-logs',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN', 'INVENTORY'),
  validate(auditLogsQuerySchema),
  ctrl.getAuditLogs
);
router.get('/audit-logs/verify',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  ctrl.verifyAuditChain
);

// Flag / unflag audit log entries
router.patch('/audit-logs/:id/flag',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  validate(flagAuditLogSchema),
  ctrl.flagAuditLog
);
router.patch('/audit-logs/:id/unflag',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  ctrl.unflagAuditLog
);

// Blocked IPs
router.get('/blocked-ips',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  ctrl.getBlockedIps
);
router.post('/blocked-ips',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  validate(blockIpSchema),
  ctrl.blockIp
);
router.delete('/blocked-ips/:id',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  validate(unblockIpSchema),
  ctrl.unblockIp
);

// User management — admin + HR can manage staff
router.get('/users',    authorize('SUPER_ADMIN', 'ADMIN', 'HR'), validate(usersQuerySchema), ctrl.getUsers);
router.post('/users',   authorize('SUPER_ADMIN', 'ADMIN', 'HR'), validate(createUserSchema), ctrl.createUser);
router.patch('/users/:id', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), validate(updateUserSchema), ctrl.updateUser);
router.patch(
  '/users/:id/status',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(setStatusSchema),
  ctrl.setUserStatus
);
router.delete(
  '/users/:id',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  ctrl.deleteUser
);

// Sessions — admin + IT_ADMIN can view/terminate
router.get('/sessions',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  ctrl.getSessions
);
router.delete(
  '/sessions/:id',
  authorize('SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'),
  validate(sessionDeleteSchema),
  ctrl.deleteSession
);

export default router;
