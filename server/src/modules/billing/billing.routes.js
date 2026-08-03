import { Router } from 'express';
import { authenticate }   from '../../shared/middleware/auth.js';
import { authorize }      from '../../shared/middleware/rbac.js';
import { validate }       from '../../shared/middleware/validate.js';
import { apiRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import { checkOwnership } from '../../shared/middleware/ownership.js';
import * as ctrl from './billing.controller.js';
import {
  createBillSchema,
  billsQuerySchema,
  payBillSchema,
  refundBillSchema,
  insuranceClaimSchema,
  createInsuranceSchema,
  updateInsuranceSchema,
  discountApprovalSchema,
  billPdfSchema,
  createRazorpayOrderSchema,
  verifyRazorpayPaymentSchema,
} from './billing.schema.js';

const router = Router();
router.use(authenticate, apiRateLimiter, auditMiddleware);

const billing = authorize('RECEPTIONIST', 'BILLING', 'ADMIN', 'SUPER_ADMIN');
const admin   = authorize('ADMIN', 'SUPER_ADMIN');

// ── Bills ────────────────────────────────────────────────────────────────────
router.get('/:id/pdf',
  authorize('BILLING', 'PATIENT', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'),
  validate(billPdfSchema),
  checkOwnership('bill'),
  ctrl.downloadBillPdf
);
router.post('/:id/create-order',
  authorize('PATIENT', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST', 'BILLING'),
  validate(createRazorpayOrderSchema),
  checkOwnership('bill'),
  ctrl.createRazorpayOrderHandler
);
router.post('/:id/verify-payment',
  authorize('PATIENT', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST', 'BILLING'),
  validate(verifyRazorpayPaymentSchema),
  checkOwnership('bill'),
  ctrl.verifyRazorpayPaymentHandler
);
router.get('/pending-services/:patientId', billing, ctrl.getPendingServicesHandler);
router.post('/',                           billing, validate(createBillSchema),    ctrl.createBillHandler);
router.get('/',                            admin,                                   ctrl.listAllBillsHandler);
router.get('/patient/:patientId',
  authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  checkOwnership('patient', 'patientId'),
  ctrl.getBillsByPatientHandler
);
router.get('/:id',
  authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  checkOwnership('bill'),
  ctrl.getBillHandler
);
router.patch('/:id/pay',
  authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  validate(payBillSchema),
  checkOwnership('bill'),
  ctrl.payBillHandler
);
router.post('/:id/refund',                 billing, validate(refundBillSchema),    ctrl.refundBillHandler);
router.patch('/:id/insurance-claim',       billing, validate(insuranceClaimSchema), ctrl.insuranceClaimHandler);
router.patch('/:id/discount-approval',     admin,   validate(discountApprovalSchema), ctrl.approveDiscountHandler);

// ── Insurance ────────────────────────────────────────────────────────────────
router.post('/insurance',                  billing, validate(createInsuranceSchema), ctrl.createInsuranceHandler);
router.get('/insurance/patient/:patientId',
  authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
  checkOwnership('patient', 'patientId'),
  ctrl.getInsuranceHandler
);
router.patch('/insurance/:id',             billing, validate(updateInsuranceSchema), ctrl.updateInsuranceHandler);
router.delete('/insurance/:id',            billing,                                  ctrl.deleteInsuranceHandler);

// ── Admin financial summary ──────────────────────────────────────────────────
router.get('/summary/financial',           admin, ctrl.financialSummaryHandler);

export default router;
