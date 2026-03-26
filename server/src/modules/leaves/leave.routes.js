import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.js';
import { authorize } from '../../shared/middleware/rbac.js';
import { validate } from '../../shared/middleware/validate.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import * as ctrl from './leave.controller.js';
import {
  applyLeaveSchema,
  reviewLeaveSchema,
  allLeavesQuerySchema,
  calendarQuerySchema,
  balancesParamsSchema,
} from './leave.schema.js';

const router = Router();

// All routes require authentication
router.use(authenticate, apiRateLimiter, auditMiddleware);

// Any non-patient staff can apply
router.post(
  '/',
  authorize('SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','PHARMACIST',
            'LAB_TECH','RADIOLOGIST','ANESTHETIST','BILLING','HR','INVENTORY',
            'DIETITIAN','PHYSIO','SOCIAL_WORKER','IT_ADMIN','SECURITY_OFC','ORDERLY'),
  validate(applyLeaveSchema),
  ctrl.applyLeave
);

// Own history + balances
router.get('/my', authorize('*'), ctrl.getMyLeaves);

// Calendar — any authenticated user
router.get('/calendar', validate(calendarQuerySchema), authorize('*'), ctrl.getLeaveCalendar);

// All leaves — HR/ADMIN only
router.get(
  '/',
  authorize('SUPER_ADMIN','ADMIN','HR'),
  validate(allLeavesQuerySchema),
  ctrl.getAllLeaves
);

// Balances for a specific user
router.get(
  '/balances/:userId',
  validate(balancesParamsSchema),
  ctrl.getBalances
);

// Approve / Reject — HR or ADMIN
router.patch(
  '/:id/approve',
  authorize('SUPER_ADMIN','ADMIN','HR'),
  validate(reviewLeaveSchema),
  ctrl.approveLeave
);

router.patch(
  '/:id/reject',
  authorize('SUPER_ADMIN','ADMIN','HR'),
  validate(reviewLeaveSchema),
  ctrl.rejectLeave
);

export default router;
