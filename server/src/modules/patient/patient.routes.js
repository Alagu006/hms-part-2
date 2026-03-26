import { Router } from 'express';
import { authenticate }     from '../../shared/middleware/auth.js';
import { authorize }        from '../../shared/middleware/rbac.js';
import { validate }         from '../../shared/middleware/validate.js';
import { auditMiddleware }  from '../../shared/middleware/audit.js';
import { apiRateLimiter }   from '../../shared/middleware/rateLimiter.js';
import {
  createPatientSchema,
  updatePatientSchema,
  getPatientSchema,
  listPatientsSchema,
  timelineSchema,
} from './patient.schema.js';
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  getPatientTimeline,
  getMyRecords,
} from './patient.controller.js';

const router = Router();

// Every route: rate limit → auth → audit
router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

// GET /patients/my  — must be before /:id to avoid param collision
router.get(
  '/my',
  authorize('PATIENT'),
  getMyRecords
);

router.post(
  '/',
  authorize('RECEPTIONIST'),
  validate(createPatientSchema),
  createPatient
);

router.get(
  '/',
  authorize('RECEPTIONIST', 'NURSE', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  validate(listPatientsSchema),
  listPatients
);

router.get(
  '/:id',
  authorize('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(getPatientSchema),
  getPatient
);

router.patch(
  '/:id',
  authorize('RECEPTIONIST'),
  validate(updatePatientSchema),
  updatePatient
);

router.get(
  '/:id/timeline',
  authorize('DOCTOR', 'PATIENT'),
  validate(timelineSchema),
  getPatientTimeline
);

export default router;
