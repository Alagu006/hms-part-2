import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { listDietPlansSchema, createDietPlanSchema, updateDietPlanSchema } from './diet-plans.schema.js';
import * as ctrl from './diet-plans.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get('/',     authorize('DIETITIAN', 'DOCTOR', 'NURSE', 'ADMIN', 'SUPER_ADMIN'), validate(listDietPlansSchema), ctrl.listDietPlans);
router.post('/',    authorize('DIETITIAN', 'ADMIN', 'SUPER_ADMIN'), validate(createDietPlanSchema), ctrl.createDietPlan);
router.patch('/:id', authorize('DIETITIAN', 'ADMIN', 'SUPER_ADMIN'), validate(updateDietPlanSchema), ctrl.updateDietPlan);

export default router;
