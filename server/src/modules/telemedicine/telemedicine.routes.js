import { Router }          from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createSessionSchema,
  sessionIdSchema,
  endSessionSchema,
  listSessionsSchema,
} from './telemedicine.schema.js';
import {
  createSession,
  listMySessions,
  getRoomToken,
  endSession,
} from './telemedicine.controller.js';

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

// Schedule a session
router.post(
  '/sessions',
  authorize('DOCTOR', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(createSessionSchema),
  createSession
);

// List my sessions
router.get(
  '/sessions/my',
  authorize('*'),
  validate(listSessionsSchema),
  listMySessions
);

// Get room access token
router.get(
  '/sessions/:id/token',
  authorize('*'),
  validate(sessionIdSchema),
  getRoomToken
);

// End session + optional consultation note
router.patch(
  '/sessions/:id/end',
  authorize('DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  validate(endSessionSchema),
  endSession
);

export default router;
