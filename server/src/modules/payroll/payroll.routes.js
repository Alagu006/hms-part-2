import { Router }          from 'express';
import { authenticate }    from '../../shared/middleware/auth.js';
import { authorize }       from '../../shared/middleware/rbac.js';
import { validate }        from '../../shared/middleware/validate.js';
import { auditMiddleware } from '../../shared/middleware/audit.js';
import {
  upsertSalaryStructureSchema,
  createRunSchema,
  processRunSchema,
  runsQuerySchema,
  runDetailsQuerySchema,
  salaryHistorySchema,
} from './payroll.schema.js';
import {
  handleUpsertSalaryStructure,
  handleGetSalaryStructure,
  handleGetSalaryHistory,
  handleCreateRun,
  handleListRuns,
  handleProcessRun,
  handleGetRunDetails,
  handleGetMyPayslips,
  handleGetUserPayslips,
} from './payroll.controller.js';

const router = Router();

router.use(authenticate);
router.use(auditMiddleware);

// ── Salary structures (HR / ADMIN only) ──────────────────────────────────────

/** Set or update a salary structure for an employee */
router.put(
  '/salary/:userId',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(upsertSalaryStructureSchema),
  handleUpsertSalaryStructure
);

/** Get current salary structure for an employee */
router.get(
  '/salary/:userId',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  handleGetSalaryStructure
);

/** Get full salary history for an employee */
router.get(
  '/salary/:userId/history',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(salaryHistorySchema),
  handleGetSalaryHistory
);

// ── Payroll runs (HR / ADMIN only) ────────────────────────────────────────────

/** Create a new payroll run (DRAFT) */
router.post(
  '/runs',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(createRunSchema),
  handleCreateRun
);

/** List payroll runs */
router.get(
  '/runs',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(runsQuerySchema),
  handleListRuns
);

/** Process a payroll run — calculates all payslips */
router.post(
  '/runs/:runId/process',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(processRunSchema),
  handleProcessRun
);

/** Get payslip details for a run */
router.get(
  '/runs/:runId/details',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  validate(runDetailsQuerySchema),
  handleGetRunDetails
);

// ── Employee self-service ─────────────────────────────────────────────────────

/** Get my own payslips */
router.get(
  '/my-payslips',
  authorize('*'),
  handleGetMyPayslips
);

/** Get payslips for a specific employee (HR/Admin only) */
router.get(
  '/payslips/:userId',
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  handleGetUserPayslips
);

export default router;
