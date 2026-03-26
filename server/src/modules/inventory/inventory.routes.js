import { Router }          from 'express';
import multer              from 'multer';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { apiRateLimiter }  from '../../shared/middleware/rateLimiter.js';
import {
  createItemSchema, updateItemSchema, itemIdSchema,
  listItemsSchema, updateBedSchema, generateQrSchema,
  qrCodeSchema, adjustQuantitySchema,
} from './inventory.schema.js';
import {
  createItem, listItems, getItem, updateItem, deleteItem, adjustQuantity,
  getBeds, updateBed, generateQr, lookupQr, getAlerts, getStats, importCsv,
} from './inventory.controller.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

const INV_ROLES = ['INVENTORY', 'ADMIN', 'SUPER_ADMIN'];

router.use(apiRateLimiter);
router.use(authenticate);
router.use(auditMiddleware);

// Stats (read-only — broader access)
router.get('/stats',   authorize(...INV_ROLES, 'DOCTOR', 'NURSE'), getStats);
router.get('/alerts',  authorize(...INV_ROLES), getAlerts);

// Beds
router.get('/beds',         authorize(...INV_ROLES, 'NURSE', 'DOCTOR', 'RECEPTIONIST'), getBeds);
router.patch('/beds/:id',   authorize(...INV_ROLES, 'NURSE'), validate(updateBedSchema), updateBed);

// QR
router.post('/qr/generate', authorize(...INV_ROLES), validate(generateQrSchema), generateQr);
router.get('/qr/:code',     authorize(...INV_ROLES, 'NURSE', 'DOCTOR'), validate(qrCodeSchema), lookupQr);

// CSV import
router.post('/import', authorize(...INV_ROLES), upload.single('file'), importCsv);

// CRUD
router.get('/',     authorize(...INV_ROLES, 'DOCTOR', 'NURSE', 'PHARMACIST'), validate(listItemsSchema), listItems);
router.post('/',    authorize(...INV_ROLES), validate(createItemSchema), createItem);
router.get('/:id',  authorize(...INV_ROLES, 'DOCTOR', 'NURSE', 'PHARMACIST'), validate(itemIdSchema), getItem);
router.patch('/:id',        authorize(...INV_ROLES), validate(updateItemSchema), updateItem);
router.delete('/:id',       authorize(...INV_ROLES), validate(itemIdSchema), deleteItem);
router.patch('/:id/adjust', authorize(...INV_ROLES, 'NURSE'), validate(adjustQuantitySchema), adjustQuantity);

export default router;
