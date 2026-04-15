import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { checkOwnership }  from '../../shared/middleware/ownership.js';
import {
  createPrescriptionSchema,
  getPrescriptionSchema,
  patientHistorySchema,
  myPrescriptionsSchema,
  dispenseSchema,
  medicineSearchSchema,
  prescriptionCountSchema,
  listPrescriptionsSchema,
  importOpenFdaSchema,
} from './prescription.schema.js';
import {
  searchMedicines,
  importOpenFdaMedicines,
  createPrescription,
  getPrescription,
  getPatientPrescriptions,
  getMyPrescriptions,
  dispensePrescription,
  getPrescriptionCount,
  listPrescriptions,
  downloadPrescriptionPdf,
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

// List all medicines (paginated)
router.get(
  '/medicines',
  authorize('DOCTOR', 'PHARMACIST', 'NURSE', 'ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const { query } = await import('../../shared/db/pool.js');
      const page   = Math.max(1, parseInt(req.query.page)  || 1);
      const limit  = Math.min(100, parseInt(req.query.limit) || 20);
      const offset = (page - 1) * limit;
      const search = req.query.search?.trim() || '';

      const params = [];
      const where  = ["deleted_at IS NULL", "is_active = TRUE"];
      if (search) {
        params.push(`%${search}%`);
        where.push(`(name ILIKE $${params.length} OR generic_name ILIKE $${params.length})`);
      }
      params.push(limit, offset);

      const { rows } = await query(
        `SELECT *, COUNT(*) OVER() AS total_count
         FROM medicines
         WHERE ${where.join(' AND ')}
         ORDER BY name ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      const total = parseInt(rows[0]?.total_count ?? 0, 10);
      return res.status(200).json({
        data: {
          items: rows.map(({ total_count, ...r }) => r),
          total,
          page,
          limit,
        },
      });
    } catch (err) { next(err); }
  }
);

// Add a new medicine to the database
router.post(
  '/medicines',
  authorize('DOCTOR', 'PHARMACIST', 'ADMIN', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const { name, genericName, form, strength, category } = req.body;
      if (!name) return res.status(422).json({ error: 'name is required' });
      const { query } = await import('../../shared/db/pool.js');
      const { rows: [existing] } = await query(
        `SELECT id FROM medicines WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]
      );
      if (existing) return res.status(200).json({ data: existing, existed: true });
      const { rows: [med] } = await query(
        `INSERT INTO medicines (name, generic_name, form, strength, category, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW()) RETURNING *`,
        [name, genericName ?? name, form ?? 'OTHER', strength ?? null, category ?? 'GENERAL']
      );
      return res.status(201).json({ data: med });
    } catch (err) { next(err); }
  }
);

router.post(
  '/medicines/import-openfda',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(importOpenFdaSchema),
  importOpenFdaMedicines
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

// Patient's own prescriptions
router.get(
  '/my',
  authorize('PATIENT'),
  validate(myPrescriptionsSchema),
  getMyPrescriptions
);

router.get(
  '/:id',
  authorize('DOCTOR', 'PHARMACIST', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getPrescriptionSchema),
  checkOwnership('prescription'),
  getPrescription
);

router.patch(
  '/:id/dispense',
  authorize('PHARMACIST'),
  validate(dispenseSchema),
  dispensePrescription
);

router.get(
  '/:id/pdf',
  authorize('DOCTOR', 'PHARMACIST', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  validate(getPrescriptionSchema),
  checkOwnership('prescription'),
  downloadPrescriptionPdf
);

export default router;
