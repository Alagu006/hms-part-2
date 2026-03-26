import { Router }          from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { createIncidentSchema, incidentQuerySchema } from './incident.schema.js';
import * as ctrl from './incident.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

// Any authenticated staff can report
router.post('/', authorize('*'), validate(createIncidentSchema), ctrl.createIncident);

// Only ADMIN, HR, SECURITY_OFC can view all
router.get('/', authorize('ADMIN','SUPER_ADMIN','HR','SECURITY_OFC'), validate(incidentQuerySchema), ctrl.getIncidents);

export default router;
