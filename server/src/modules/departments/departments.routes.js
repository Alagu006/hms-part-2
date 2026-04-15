import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }      from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  listDepartmentsSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
} from './departments.schema.js';
import {
  listDepartments,
  createDepartment,
  updateDepartment,
} from './departments.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST',
            'LAB_TECH', 'PHARMACIST', 'INVENTORY', 'BILLING', 'HR',
            'RADIOLOGIST', 'DIETITIAN', 'PHYSIO', 'ANESTHETIST',
            'SOCIAL_WORKER', 'IT_ADMIN', 'SECURITY_OFC', 'ORDERLY', 'PATIENT'),
  validate(listDepartmentsSchema),
  listDepartments
);

router.post(
  '/',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(createDepartmentSchema),
  createDepartment
);

router.patch(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(updateDepartmentSchema),
  updateDepartment
);

export default router;
