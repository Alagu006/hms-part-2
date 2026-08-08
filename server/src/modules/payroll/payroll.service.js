/**
 * Payroll Service
 *
 * Handles salary structures, monthly payroll runs, and payslip generation.
 * Each run calculates gross/net pay for every active employee based on their
 * salary structure and leave records for that month.
 */

import { query, withTransaction } from '../../shared/db/pool.js';
import { auditLog }               from '../../shared/middleware/audit.js';
import { logger }                 from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Salary structure CRUD
// ---------------------------------------------------------------------------

/**
 * Upsert a salary structure for a user.
 * Creates a new record if none exists for the given effective_from date,
 * otherwise updates the existing one.
 */
export async function upsertSalaryStructure(userId, data, actorId) {
  const {
    basicSalary,
    hraPct        = 0,
    transportAllow = 0,
    medicalAllow  = 0,
    otherAllow    = 0,
    taxPct        = 0,
    pfPct         = 12,
    effectiveFrom,
    notes,
  } = data;

  const effectiveDate = effectiveFrom ?? new Date().toISOString().slice(0, 10);

  // Check user exists and is not a patient
  const { rows: userRows } = await query(
    `SELECT u.id, u.first_name, u.last_name
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE u.id = $1 AND u.deleted_at IS NULL AND ur.role != 'PATIENT'
     LIMIT 1`,
    [userId]
  );
  if (!userRows[0]) {
    const err = new Error('User not found or is a patient');
    err.status = 404;
    throw err;
  }

  const { rows: existing } = await query(
    `SELECT id FROM salary_structures
     WHERE user_id = $1 AND effective_from = $2 AND deleted_at IS NULL`,
    [userId, effectiveDate]
  );

  let result;
  if (existing[0]) {
    const { rows } = await query(
      `UPDATE salary_structures
       SET basic_salary = $1, hra_pct = $2, transport_allow = $3,
           medical_allow = $4, other_allow = $5, tax_pct = $6,
           pf_pct = $7, notes = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [basicSalary, hraPct, transportAllow, medicalAllow, otherAllow,
       taxPct, pfPct, notes ?? null, existing[0].id]
    );
    result = rows[0];
  } else {
    const { rows } = await query(
      `INSERT INTO salary_structures
         (user_id, basic_salary, hra_pct, transport_allow, medical_allow,
          other_allow, tax_pct, pf_pct, effective_from, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [userId, basicSalary, hraPct, transportAllow, medicalAllow,
       otherAllow, taxPct, pfPct, effectiveDate, notes ?? null, actorId]
    );
    result = rows[0];
  }

  await auditLog(actorId, 'UPSERT', 'salary_structures', result.id, null, result);
  return result;
}

/**
 * Get the active salary structure for a user (most recent effective_from <= today).
 */
export async function getSalaryStructure(userId) {
  const { rows } = await query(
    `SELECT * FROM salary_structures
     WHERE user_id = $1 AND deleted_at IS NULL
       AND effective_from <= CURRENT_DATE
     ORDER BY effective_from DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Get full salary history for a user.
 */
export async function getSalaryHistory(userId) {
  const { rows } = await query(
    `SELECT ss.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM salary_structures ss
     LEFT JOIN users u ON u.id = ss.created_by
     WHERE ss.user_id = $1 AND ss.deleted_at IS NULL
     ORDER BY ss.effective_from DESC`,
    [userId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

/**
 * Create a new payroll run for a given month.
 * Only one run per month is allowed (enforced by DB unique constraint).
 */
export async function createPayrollRun({ periodYear, periodMonth, notes }, actorId) {
  // Check for existing run
  const { rows: existing } = await query(
    `SELECT id, status FROM payroll_runs
     WHERE period_year = $1 AND period_month = $2`,
    [periodYear, periodMonth]
  );
  if (existing[0]) {
    const err = new Error(`Payroll run for ${periodYear}-${String(periodMonth).padStart(2, '0')} already exists (status: ${existing[0].status})`);
    err.status = 409;
    throw err;
  }

  const { rows } = await query(
    `INSERT INTO payroll_runs
       (period_year, period_month, status, notes, created_by)
     VALUES ($1, $2, 'DRAFT', $3, $4)
     RETURNING *`,
    [periodYear, periodMonth, notes ?? null, actorId]
  );
  const run = rows[0];
  await auditLog(actorId, 'CREATE', 'payroll_runs', run.id, null, run);
  return run;
}

/**
 * List payroll runs with optional year/month filter.
 */
export async function listPayrollRuns({ year, month, page = 1, limit = 24 }) {
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (year)  { conditions.push(`period_year = $${p++}`);  params.push(year); }
  if (month) { conditions.push(`period_month = $${p++}`); params.push(month); }

  const offset = (page - 1) * limit;
  const limitIdx  = p++;
  const offsetIdx = p++;
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT pr.*,
            u.first_name || ' ' || u.last_name AS processed_by_name,
            COUNT(*) OVER() AS total_count
     FROM payroll_runs pr
     LEFT JOIN users u ON u.id = pr.processed_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY pr.period_year DESC, pr.period_month DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    runs : rows.map(({ total_count, ...r }) => r),
    total: parseInt(total, 10),
    page,
    limit,
  };
}

/**
 * Process a payroll run — calculate payslips for all active employees.
 *
 * Algorithm per employee:
 *   1. Find their active salary structure (most recent effective_from <= run month end)
 *   2. Count working days in the month (Mon–Fri, excluding public holidays — simplified)
 *   3. Count approved leave days in the month
 *   4. Calculate present_days = working_days - leave_days - absent_days
 *   5. Pro-rate gross salary: gross = (present_days / working_days) * full_gross
 *   6. Deduct tax and PF
 */
export async function processPayrollRun(runId, actorId) {
  const { rows: runRows } = await query(
    `SELECT * FROM payroll_runs WHERE id = $1`,
    [runId]
  );
  if (!runRows[0]) {
    const err = new Error('Payroll run not found');
    err.status = 404;
    throw err;
  }
  const run = runRows[0];
  if (run.status === 'PROCESSED') {
    const err = new Error('Payroll run already processed');
    err.status = 409;
    throw err;
  }
  if (run.status === 'PROCESSING') {
    const err = new Error('Payroll run is already being processed');
    err.status = 409;
    throw err;
  }

  // Atomically claim the run (previous status -> PROCESSING). Two concurrent
  // requests could both pass the checks above; only the first claim succeeds,
  // the second affects 0 rows and is rejected.
  const { rows: claimed } = await query(
    `UPDATE payroll_runs SET status = 'PROCESSING', updated_at = NOW()
     WHERE id = $1 AND status = $2
     RETURNING id`,
    [runId, run.status]
  );
  if (!claimed[0]) {
    const err = new Error('Payroll run is already being processed');
    err.status = 409;
    throw err;
  }

  const { period_year: year, period_month: month } = run;

  // Working days in the month (Mon–Fri count)
  const workingDays = countWorkingDays(year, month);

  // Fetch all active non-patient employees
  const { rows: employees } = await query(
    `SELECT DISTINCT u.id AS user_id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE u.is_active = TRUE AND u.deleted_at IS NULL AND ur.role != 'PATIENT'`
  );

  // Month date range for leave lookup
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay    = new Date(year, month, 0).getDate();
  const monthEnd   = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  let totalGross       = 0;
  let totalDeductions  = 0;
  let totalNet         = 0;
  let errorCount       = 0;

  try {
    await withTransaction(async (client) => {
    // Delete any existing details for this run (re-process support)
    await client.query(
      `DELETE FROM payroll_details WHERE run_id = $1`,
      [runId]
    );

    for (const emp of employees) {
      try {
        // Get salary structure effective for this month
        const { rows: ssRows } = await client.query(
          `SELECT * FROM salary_structures
           WHERE user_id = $1 AND deleted_at IS NULL
             AND effective_from <= $2
           ORDER BY effective_from DESC
           LIMIT 1`,
          [emp.user_id, monthEnd]
        );

        if (!ssRows[0]) {
          // No salary structure — record as error
          await client.query(
            `INSERT INTO payroll_details
               (run_id, user_id, working_days, present_days, leave_days, absent_days,
                basic_salary, hra, transport_allow, medical_allow, other_allow,
                gross_salary, tax_deduction, pf_deduction, other_deductions, net_salary,
                has_error, error_reason)
             VALUES ($1,$2,$3,0,0,0,0,0,0,0,0,0,0,0,0,0,TRUE,$4)`,
            [runId, emp.user_id, workingDays, 'No salary structure found']
          );
          errorCount++;
          continue;
        }

        const ss = ssRows[0];

        // Count approved leave days that actually fall in THIS month. Leaves
        // spanning two months must not have their full days_count attributed to
        // both months (that double-counted them), so each leave contributes only
        // the business days of its overlap with the run's month.
        const { rows: leaveRows } = await client.query(
          `SELECT start_date, end_date
           FROM leaves
           WHERE user_id = $1
             AND status = 'APPROVED'
             AND deleted_at IS NULL
             AND start_date <= $2
             AND end_date >= $3`,
          [emp.user_id, monthEnd, monthStart]
        );
        const leaveDays = leaveRows.reduce(
          (sum, lv) => sum + countBusinessDaysOverlap(lv.start_date, lv.end_date, year, month),
          0
        );

        // Simplified: no absent tracking — present = working - leave
        const presentDays = Math.max(0, workingDays - leaveDays);
        const ratio       = workingDays > 0 ? presentDays / workingDays : 0;

        // Calculate components (pro-rated)
        const basic     = round2(ss.basic_salary * ratio);
        const hra       = round2(basic * (ss.hra_pct / 100));
        const transport = round2(ss.transport_allow * ratio);
        const medical   = round2(ss.medical_allow * ratio);
        const other     = round2(ss.other_allow * ratio);
        const gross     = round2(basic + hra + transport + medical + other);

        // Deductions
        const taxDed = round2(gross * (ss.tax_pct / 100));
        const pfDed  = round2(basic * (ss.pf_pct / 100));
        const net    = round2(gross - taxDed - pfDed);

        await client.query(
          `INSERT INTO payroll_details
             (run_id, user_id, salary_structure_id, working_days, present_days,
              leave_days, absent_days, basic_salary, hra, transport_allow,
              medical_allow, other_allow, gross_salary, tax_deduction,
              pf_deduction, other_deductions, net_salary, has_error)
           VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14,0,$15,FALSE)`,
          [runId, emp.user_id, ss.id, workingDays, presentDays,
           leaveDays, basic, hra, transport, medical, other,
           gross, taxDed, pfDed, net]
        );

        totalGross      += gross;
        totalDeductions += taxDed + pfDed;
        totalNet        += net;
      } catch (err) {
        logger.error('[payroll] Error processing employee', { userId: emp.user_id, message: err.message });
        await client.query(
          `INSERT INTO payroll_details
             (run_id, user_id, working_days, present_days, leave_days, absent_days,
              basic_salary, hra, transport_allow, medical_allow, other_allow,
              gross_salary, tax_deduction, pf_deduction, other_deductions, net_salary,
              has_error, error_reason)
           VALUES ($1,$2,$3,0,0,0,0,0,0,0,0,0,0,0,0,0,TRUE,$4)`,
          [runId, emp.user_id, workingDays, err.message]
        ).catch(() => {}); // best-effort error record — must not mask the payroll error itself
        errorCount++;
      }
    }

    // Update run totals
    await client.query(
      `UPDATE payroll_runs
       SET status = $1, processed_by = $2, processed_at = NOW(),
           total_gross = $3, total_deductions = $4, total_net = $5,
           error_count = $6, updated_at = NOW()
       WHERE id = $7`,
      [
        errorCount > 0 && employees.length === errorCount ? 'ERROR' : 'PROCESSED',
        actorId,
        round2(totalGross),
        round2(totalDeductions),
        round2(totalNet),
        errorCount,
        runId,
      ]
    );
  });  // withTransaction

    await auditLog(actorId, 'PROCESS', 'payroll_runs', runId, { status: run.status }, { status: 'PROCESSED' });
  } catch (err) {
    // The PROCESSING marker was set before the transaction; if anything above
    // fails the transaction rolls back and the marker would linger forever,
    // leaving the run stuck in PROCESSING with no recovery path. Reset it to
    // the pre-run status so the run can be retried.
    await query(
      `UPDATE payroll_runs SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'PROCESSING'`,
      [run.status, runId]
    ).catch(() => {});
    throw err;
  }

  const { rows: updated } = await query(
    `SELECT * FROM payroll_runs WHERE id = $1`,
    [runId]
  );
  return updated[0];
}

/**
 * Get details (payslips) for a payroll run.
 */
export async function getRunDetails(runId, { hasError, search, page = 1, limit = 50 }) {
  const conditions = ['pd.run_id = $1'];
  const params     = [runId];
  let p = 2;

  if (hasError === 'true')  { conditions.push('pd.has_error = TRUE'); }
  if (hasError === 'false') { conditions.push('pd.has_error = FALSE'); }
  if (search) {
    conditions.push(`(u.first_name || ' ' || u.last_name) ILIKE $${p++}`);
    params.push(`%${search}%`);
  }

  const offset = (page - 1) * limit;
  const limitIdx  = p++;
  const offsetIdx = p++;
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT pd.*,
            u.first_name, u.last_name, u.employee_id,
            d.name AS department_name,
            COUNT(*) OVER() AS total_count
     FROM payroll_details pd
     JOIN users u ON u.id = pd.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.first_name, u.last_name
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    details: rows.map(({ total_count, ...r }) => r),
    total  : parseInt(total, 10),
    page,
    limit,
  };
}

/**
 * Get payslip history for a specific user.
 */
export async function getUserPayslips(userId, { page = 1, limit = 24 } = {}) {
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT pd.*,
            pr.period_year, pr.period_month, pr.status AS run_status,
            COUNT(*) OVER() AS total_count
     FROM payroll_details pd
     JOIN payroll_runs pr ON pr.id = pd.run_id
     WHERE pd.user_id = $1 AND pr.status = 'PROCESSED'
     ORDER BY pr.period_year DESC, pr.period_month DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    payslips: rows.map(({ total_count, ...r }) => r),
    total   : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimal places. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Count Mon–Fri working days in a given month.
 * Does not account for public holidays (would require a holiday table).
 */
function countWorkingDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Business days (Mon–Fri) a leave overlaps the given calendar month. */
function countBusinessDaysOverlap(leaveStart, leaveEnd, year, month) {
  // Construct month bounds with the LOCAL calendar so comparisons and getDay()
  // stay consistent with pg's DATE->Date parsing (local midnight).
  const monthFrom = new Date(year, month - 1, 1);
  const monthTo   = new Date(year, month, 0);
  const start     = new Date(leaveStart) > monthFrom ? new Date(leaveStart) : monthFrom;
  const end       = new Date(leaveEnd) < monthTo ? new Date(leaveEnd) : monthTo;
  return countBusinessDays(start, end);
}

/** Count Mon–Fri days between two dates (inclusive). */
function countBusinessDays(start, end) {
  let count = 0;
  const cur = new Date(start);
  while (cur <= new Date(end)) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
