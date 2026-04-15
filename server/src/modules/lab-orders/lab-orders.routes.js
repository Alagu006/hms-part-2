import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { checkOwnership }  from '../../shared/middleware/ownership.js';
import {
  listLabOrdersSchema,
  updateLabOrderSchema,
  createLabResultSchema,
  getLabResultSchema,
  createLabOrderSchema,
  getPatientLabResultsSchema,
} from './lab-orders.schema.js';
import {
  listLabOrders,
  createLabOrder,
  updateLabOrder,
  createLabResult,
  getLabResult,
  getPatientLabResults,
} from './lab-orders.controller.js';

const router = Router();

router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(
  '/',
  authorize('LAB_TECH', 'DOCTOR', 'NURSE', 'ADMIN', 'SUPER_ADMIN', 'RADIOLOGIST'),
  validate(listLabOrdersSchema),
  listLabOrders
);

router.post(
  '/',
  authorize('DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  validate(createLabOrderSchema),
  createLabOrder
);

router.patch(
  '/:id',
  authorize('LAB_TECH', 'ADMIN', 'SUPER_ADMIN', 'RADIOLOGIST'),
  validate(updateLabOrderSchema),
  updateLabOrder
);

// GET /lab-orders/results/:id — must be before /:id to avoid param collision
router.get(
  '/results/:id',
  authorize('LAB_TECH', 'DOCTOR', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getLabResultSchema),
  checkOwnership('lab_result'),
  getLabResult
);

router.post(
  '/results',
  authorize('LAB_TECH', 'ADMIN', 'SUPER_ADMIN'),
  validate(createLabResultSchema),
  createLabResult
);

// GET /lab-orders/patient/:patientId/results — doctor/patient views results
router.get(
  '/patient/:patientId/results',
  authorize('DOCTOR', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(getPatientLabResultsSchema),
  getPatientLabResults
);

export default router;
