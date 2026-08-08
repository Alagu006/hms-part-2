// DB-backed integration test for R21 payroll fixes.
//
// 1. Cross-month leave double-count: processPayrollRun used SUM(days_count) for
//    every approved leave overlapping the month, so a leave spanning two months
//    had its FULL days counted in BOTH months. It now attributes only the
//    business days of the overlap. This test proves it against the real schema
//    (leave 2025-03-28..2025-04-01 must count 2 days in March, 1 in April).
// 2. A run stuck in PROCESSING is guarded (409), and a PROCESSED run cannot be
//    re-processed.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null) },
  subscriber: {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import {
  createPayrollRun,
  processPayrollRun,
} from '../../src/modules/payroll/payroll.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedEmployee() {
  const { rows: [u] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Payroll', 'Emp', $2, $3)
     RETURNING id`,
    [uniq('E-INT-PAY'), uniq('payroll') + '@example.com', 'x'.repeat(60)]
  );
  await run(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'DOCTOR')`, [u.id]);
  return u.id;
}

async function seedSalary(userId, effectiveFrom = '2025-01-01') {
  await run(
    `INSERT INTO salary_structures
       (user_id, basic_salary, hra_pct, transport_allow, medical_allow,
        other_allow, tax_pct, pf_pct, effective_from)
     VALUES ($1, 10000, 10, 1000, 500, 200, 10, 12, $2)`,
    [userId, effectiveFrom]
  );
}

async function seedApprovedLeave(userId, startDate, endDate, daysCount) {
  await run(
    `INSERT INTO leaves (user_id, leave_type, start_date, end_date, days_count, status)
     VALUES ($1, 'ANNUAL', $2, $3, $4, 'APPROVED')`,
    [userId, startDate, endDate, daysCount]
  );
}

describe('payroll — R21 (real DB)', () => {
  it('attributes a cross-month leave only to the days inside each run month', async () => {
    const empId = await seedEmployee();
    await seedSalary(empId);
    // Fri 2025-03-28 .. Tue 2025-04-01 = 3 business days total
    // (Fri 28, Mon 31, Tue 1): 2 belong to March, 1 to April.
    await seedApprovedLeave(empId, '2025-03-28', '2025-04-01', 3);

    const marchRun = await createPayrollRun({ periodYear: 2025, periodMonth: 3 }, empId);
    const aprilRun = await createPayrollRun({ periodYear: 2025, periodMonth: 4 }, empId);

    await processPayrollRun(marchRun.id, empId);
    await processPayrollRun(aprilRun.id, empId);

    const { rows: march } = await run(
      `SELECT working_days, present_days, leave_days FROM payroll_details WHERE run_id = $1`,
      [marchRun.id]
    );
    const { rows: april } = await run(
      `SELECT working_days, present_days, leave_days FROM payroll_details WHERE run_id = $1`,
      [aprilRun.id]
    );

    expect(march[0]).toMatchObject({ working_days: 21 });
    expect(Number(march[0].leave_days)).toBe(2);
    expect(Number(march[0].present_days)).toBe(19);
    expect(april[0]).toMatchObject({ working_days: 22 });
    expect(Number(april[0].leave_days)).toBe(1);
    expect(Number(april[0].present_days)).toBe(21);
  });

  it('rejects a run stuck in PROCESSING and never re-processes a PROCESSED run', async () => {
    const empId = await seedEmployee();

    // Stuck PROCESSING run (simulates a crashed run that was never finalised).
    const stuck = await createPayrollRun({ periodYear: 2024, periodMonth: 1 }, empId);
    await run(`UPDATE payroll_runs SET status = 'PROCESSING' WHERE id = $1`, [stuck.id]);
    await expect(processPayrollRun(stuck.id, empId)).rejects.toMatchObject({
      status: 409,
      message: 'Payroll run is already being processed',
    });

    // Normal run processes, then cannot be processed again.
    const done = await createPayrollRun({ periodYear: 2024, periodMonth: 2 }, empId);
    await seedSalary(empId, '2024-01-01');
    await processPayrollRun(done.id, empId);
    const { rows: [final] } = await run(
      `SELECT status FROM payroll_runs WHERE id = $1`, [done.id]
    );
    expect(final.status).toBe('PROCESSED');
    await expect(processPayrollRun(done.id, empId)).rejects.toMatchObject({
      status: 409,
      message: 'Payroll run already processed',
    });
  });
});
