import { Router }          from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createBloodUnitSchema, updateBloodUnitSchema,
  bloodUnitParamSchema, requestBloodSchema,
} from './blood-bank.schema.js';
import * as ctrl from './blood-bank.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

// Availability — any authenticated clinical staff
router.get('/availability', authorize('*'), ctrl.getAvailability);

// Blood request — DOCTOR only
router.post('/request', authorize('DOCTOR'), validate(requestBloodSchema), ctrl.requestBlood);

// CRUD — ADMIN, LAB_TECH
router.get(  '/',    authorize('ADMIN','SUPER_ADMIN','LAB_TECH','DOCTOR','NURSE','INVENTORY'), ctrl.getBloodUnits);
router.post( '/',    authorize('ADMIN','SUPER_ADMIN','LAB_TECH'), validate(createBloodUnitSchema), ctrl.createBloodUnit);
router.get(  '/:id', authorize('ADMIN','SUPER_ADMIN','LAB_TECH','DOCTOR','NURSE','INVENTORY'), validate(bloodUnitParamSchema), ctrl.getBloodUnit);
router.patch('/:id', authorize('ADMIN','SUPER_ADMIN','LAB_TECH'), validate(updateBloodUnitSchema), ctrl.updateBloodUnit);
router.delete('/:id',authorize('ADMIN','SUPER_ADMIN'), validate(bloodUnitParamSchema), ctrl.deleteBloodUnit);

export default router;
