import { Router }    from 'express';
import multer        from 'multer';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  uploadFile, updateIv, downloadFile, deleteFile,
} from './file.controller.js';

// Memory storage — we handle disk write ourselves after validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits : {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_BYTES || String(20 * 1024 * 1024), 10), // 20 MB
    files   : 1,
  },
});

const router = Router();

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

router.post(
  '/upload',
  authorize('NURSE', 'LAB_TECH', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  upload.single('file'),
  uploadFile
);

// Client sends IV after encrypting — separate PATCH to avoid race condition
router.patch(
  '/:id/iv',
  authorize('NURSE', 'LAB_TECH', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  updateIv
);

router.get(
  '/:id/download',
  authorize('DOCTOR', 'NURSE', 'LAB_TECH', 'PATIENT', 'ADMIN', 'SUPER_ADMIN'),
  downloadFile
);

router.delete(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  deleteFile
);

export default router;
