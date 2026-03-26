import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createPrescriptionSchema,
  getPrescriptionSchema,
  patientHistorySchema,
  dispenseSchema,
  medicineSearchSchema,
  prescriptionCountSchema,
  listPrescriptionsSchema,
} from './prescription.schema.js';
import {
  searchMedicines,
  createPrescription,
  getPrescription,
  getPatientPrescriptions,
  dispensePrescription,
  getPrescriptionCount,
  listPrescriptions,
} from './prescription.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

// Medicine search — must be before /:id routes
router.get(
  '/medicines/search',
  authorize('DOCTOR', 'PHARMACIST', 'NURSE', 'ADMIN', 'SUPER_ADMIN'),
  validate(medicineSearchSchema),
  searchMedicines
);

router.post(
  '/',
  authorize('DOCTOR'),
  validate(createPrescriptionSchema),
  createPrescription
);

router.get(
  '/count',
  authorize('DOCTOR', 'PHARMACIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(prescriptionCountSchema),
  getPrescriptionCount
);

// Pharmacist queue — list prescriptions (before /:id to avoid collision)
router.get(
  '/',
  authorize('PHARMACIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(listPrescriptionsSchema),
  listPrescriptions
);

// Patient history — before /:id to avoid collision
router.get(
  '/patient/:patientId',
  authorize('DOCTOR', 'PHARMACIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(patientHistorySchema),
  getPatientPrescriptions
);

router.get(
  '/:id',
  authorize('DOCTOR', 'PHARMACIST', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getPrescriptionSchema),
  getPrescription
);

router.patch(
  '/:id/dispense',
  authorize('PHARMACIST'),
  validate(dispenseSchema),
  dispensePrescription
);

export default router;
