import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createBroadcastSchema,
  listBroadcastsSchema,
  receiptsSchema,
} from './broadcast.schema.js';
import {
  createBroadcast,
  listBroadcasts,
  getBroadcast,
  getReadReceipts,
  getStaffCount,
} from './broadcast.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

// Staff count for confirmation modal — before POST
router.get(
  '/staff-count',
  authorize('ADMIN', 'SUPER_ADMIN'),
  getStaffCount
);

router.post(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(createBroadcastSchema),
  createBroadcast
);

router.get(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(listBroadcastsSchema),
  listBroadcasts
);

router.get(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  getBroadcast
);

router.get(
  '/:id/read-receipts',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(receiptsSchema),
  getReadReceipts
);

export default router;
