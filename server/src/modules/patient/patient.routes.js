import { Router } from 'express';
import { authenticate }     from '../../shared/middleware/auth.js';
import { authorize }        from '../../shared/middleware/rbac.js';
import { validate }         from '../../shared/middleware/validate.js';
import { auditMiddleware }  from '../../shared/middleware/audit.js';
import { apiRateLimiter }   from '../../shared/middleware/rateLimiter.js';
import { checkOwnership }   from '../../shared/middleware/ownership.js';
import {
  lookupPatientByMrnSchema,
  createPatientSchema,
  updatePatientSchema,
  getPatientSchema,
  listPatientsSchema,
  timelineSchema,
  getMedicalRecordSchema,
  createAllergySchema,
  updateAllergySchema,
  allergyParamsSchema,
} from './patient.schema.js';
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
  getPatientTimeline,
  getMyRecords,
  getMedicalRecord,
  lookupPatientByMrn,
  listAllergies,
  createAllergy,
  updateAllergy,
  deleteAllergy,
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

// GET /patients/lookup?mrn=MRN-XXXXXX — for security check-in
router.get(
  '/lookup',
  authorize('SECURITY_OFC', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(lookupPatientByMrnSchema),
  lookupPatientByMrn
);

router.post(
  '/',
  authorize('RECEPTIONIST'),
  validate(createPatientSchema),
  createPatient
);

router.get(
  '/',
  authorize('RECEPTIONIST', 'NURSE', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN', 'PHARMACIST',
            'SOCIAL_WORKER', 'DIETITIAN', 'BILLING'),
  validate(listPatientsSchema),
  listPatients
);

router.get(
  '/:id',
  authorize('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(getPatientSchema),
  checkOwnership('patient'),
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
  checkOwnership('patient'),
  getPatientTimeline
);

// GET /patients/medical-records/:id — must be before /:id to avoid param collision
router.get(
  '/medical-records/:id',
  authorize('DOCTOR', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getMedicalRecordSchema),
  checkOwnership('medical_record'),
  getMedicalRecord
);

// ── Allergy routes ────────────────────────────────────────────────────────────
// Roles that can read allergies
const ALLERGY_READERS = ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'];
// Roles that can write allergies
const ALLERGY_WRITERS = ['DOCTOR', 'NURSE', 'ADMIN', 'SUPER_ADMIN'];

router.get(
  '/:id/allergies',
  authorize(...ALLERGY_READERS),
  validate(getPatientSchema),
  listAllergies
);

router.post(
  '/:id/allergies',
  authorize(...ALLERGY_WRITERS),
  validate(createAllergySchema),
  createAllergy
);

router.patch(
  '/:id/allergies/:allergyId',
  authorize(...ALLERGY_WRITERS),
  validate(updateAllergySchema),
  updateAllergy
);

router.delete(
  '/:id/allergies/:allergyId',
  authorize(...ALLERGY_WRITERS),
  validate(allergyParamsSchema),
  deleteAllergy
);

export default router;
