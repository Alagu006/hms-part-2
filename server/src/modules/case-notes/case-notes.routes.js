import { Router } from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import { listCaseNotesSchema, createCaseNoteSchema, updateCaseNoteSchema } from './case-notes.schema.js';
import * as ctrl from './case-notes.controller.js';

const router = Router();
router.use(apiRateLimiter, authenticate, auditMiddleware);

router.get('/',      authorize('SOCIAL_WORKER', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'), validate(listCaseNotesSchema), ctrl.listCaseNotes);
router.post('/',     authorize('SOCIAL_WORKER', 'ADMIN', 'SUPER_ADMIN'), validate(createCaseNoteSchema), ctrl.createCaseNote);
router.patch('/:id', authorize('SOCIAL_WORKER', 'ADMIN', 'SUPER_ADMIN'), validate(updateCaseNoteSchema), ctrl.updateCaseNote);

export default router;
