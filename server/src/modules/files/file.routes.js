import { Router }    from 'express';
import multer        from 'multer';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  uploadFile, updateIv, updateEntity, downloadFile, deleteFile,
} from './file.controller.js';
import {
  uploadProfileImage,
  downloadProfileImage,
  updateFileIv as updateFileIvSvc,
} from './file.service.js';

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

// Profile image — any authenticated user can upload their own; admin can upload for others
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 5 * 1024 * 1024, files: 1 }, // 5 MB
});

router.post(
  '/profile-image/:userId',
  profileUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const { userId } = req.params;
      // Only the user themselves or admin/super_admin can upload
      const isAdmin = req.user.roles.some(r => ['ADMIN','SUPER_ADMIN'].includes(r));
      if (!isAdmin && req.user.id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const result = await uploadProfileImage(
        {
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          userId,
          clientEncrypted: req.headers['x-client-encrypted'] === 'true',
          declaredMime: req.headers['x-original-mime'] ?? null,
        },
        req.user.id, req.ip, req.headers['user-agent']
      );
      return res.status(201).json({ data: result });
    } catch (err) { next(err); }
  }
);

router.get(
  '/profile-image/:fileId',
  async (req, res, next) => {
    try {
      const result = await downloadProfileImage(req.params.fileId, req.user);
      if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
      if (!result)                return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      // Return encryption metadata so client can decrypt
      if (result.encryptionIv && result.encryptionIv !== 'none') {
        res.setHeader('X-Encryption-IV', result.encryptionIv);
        res.setHeader('X-Encrypted', 'true');
      }
      return res.send(result.buffer);
    } catch (err) { next(err); }
  }
);

// Patch IV for profile image after encrypted upload
router.patch(
  '/profile-image/:fileId/iv',
  async (req, res, next) => {
    try {
      const { iv } = req.body;
      if (!iv) return res.status(422).json({ error: 'iv is required' });
      const result = await updateFileIvSvc(req.params.fileId, iv, req.user.id);
      if (!result) return res.status(404).json({ error: 'File not found' });
      return res.status(200).json({ data: result });
    } catch (err) { next(err); }
  }
);

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

// Re-link a file to its actual entity after creation (e.g. lab result uploaded before result ID exists)
router.patch(
  '/:id/entity',
  authorize('NURSE', 'LAB_TECH', 'DOCTOR', 'ADMIN', 'SUPER_ADMIN'),
  updateEntity
);

router.get(
  '/:id/download',
  // Service-level grants gate access per entity type + role (see file.service.js).
  authorize('*'),
  downloadFile
);

router.delete(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  deleteFile
);

export default router;
