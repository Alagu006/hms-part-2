import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { validate }       from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { listDoctorsSchema } from './doctors.schema.js';
import { listDoctors } from './doctors.controller.js';

const router = Router();

router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get(
  '/',
  validate(listDoctorsSchema),
  listDoctors
);

export default router;
