import { Router }          from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createOTScheduleSchema, updateOTScheduleSchema,
  otParamSchema, otQuerySchema,
} from './ot.schema.js';
import * as ctrl from './ot.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(  '/',    authorize('DOCTOR','NURSE','RECEPTIONIST','ADMIN','SUPER_ADMIN','ANESTHETIST'), validate(otQuerySchema), ctrl.getOTSchedules);
router.post( '/',    authorize('DOCTOR'), validate(createOTScheduleSchema), ctrl.createOTSchedule);
router.get(  '/:id', authorize('DOCTOR','NURSE','RECEPTIONIST','ADMIN','SUPER_ADMIN','ANESTHETIST'), validate(otParamSchema), ctrl.getOTSchedule);
router.patch('/:id', authorize('DOCTOR','ADMIN','SUPER_ADMIN'), validate(updateOTScheduleSchema), ctrl.updateOTSchedule);
router.delete('/:id',authorize('DOCTOR','ADMIN','SUPER_ADMIN'), validate(otParamSchema), ctrl.deleteOTSchedule);

export default router;
