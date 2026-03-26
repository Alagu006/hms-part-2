import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  listShiftsSchema,
  createShiftSchema,
  deleteShiftSchema,
} from './shifts.schema.js';
import {
  listShifts,
  createShift,
  deleteShift,
} from './shifts.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.get(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN', 'HR'),
  validate(listShiftsSchema),
  listShifts
);

router.post(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN', 'HR'),
  validate(createShiftSchema),
  createShift
);

router.delete(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN', 'HR'),
  validate(deleteShiftSchema),
  deleteShift
);

export default router;
