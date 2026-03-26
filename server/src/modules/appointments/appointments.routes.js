import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import {
  listAppointmentsSchema,
  getAppointmentSchema,
  updateAppointmentStatusSchema,
  createAppointmentSchema,
} from './appointments.schema.js';
import {
  listAppointments,
  getAppointment,
  updateAppointmentStatus,
  createAppointment,
} from './appointments.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.get(
  '/',
  authorize('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(listAppointmentsSchema),
  listAppointments
);

router.get(
  '/:id',
  authorize('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(getAppointmentSchema),
  getAppointment
);

router.patch(
  '/:id',
  authorize('DOCTOR', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(updateAppointmentStatusSchema),
  updateAppointmentStatus
);

router.post(
  '/',
  authorize('RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN', 'PATIENT'),
  validate(createAppointmentSchema),
  createAppointment
);

export default router;
