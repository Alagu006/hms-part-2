// Coverage for the payroll module: salary structure upsert/read/history,
// payroll run creation/listing, payslip processing (pro-rated calculation with
// errors), run details and per-user payslip history.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, clientQuery, withTx,
  auditMock, loggerError, loggerWarn, loggerInfo,
} = vi.hoisted(() => ({
  q: vi.fn(),
  clientQuery: vi.fn(),
  withTx: vi.fn(),
  auditMock: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTx,
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: loggerWarn, info: loggerInfo },
}));

import * as payroll from '../src/modules/payroll/payroll.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  withTx.mockImplementation(async (fn) => fn({ query: clientQuery }));
});

// ---------------------------------------------------------------------------
// upsertSalaryStructure
// ---------------------------------------------------------------------------
describe('payroll.service — upsertSalaryStructure', () => {
  it('throws 404 when the user does not exist or is a patient', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(payroll.upsertSalaryStructure('u1', { basicSalary: 5000 }, 'a'))
      .rejects.toMatchObject({ status: 404, message: 'User not found or is a patient' });
  });

  it('updates an existing structure and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ss1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ss1', basic_salary: 9000 }] });

    const res = await payroll.upsertSalaryStructure('u1', {
      basicSalary: 9000, hraPct: 10, taxPct: 5, pfPct: 12, notes: 'raise',
    }, 'actor1');

    expect(q).toHaveBeenCalledTimes(3);
    const [sql, params] = q.mock.calls[2];
    expect(sql).toContain('UPDATE salary_structures');
    expect(params).toEqual([9000, 10, 0, 0, 0, 5, 12, 'raise', 'ss1']);
    expect(auditMock).toHaveBeenCalledWith('actor1', 'UPSERT', 'salary_structures', 'ss1', null, expect.objectContaining({ basic_salary: 9000 }));
    expect(res).toEqual({ id: 'ss1', basic_salary: 9000 });
  });

  it('inserts a new structure with defaults when none exists', async () => {
    const today = new Date().toISOString().slice(0, 10);
    q.mockResolvedValueOnce({ rows: [{ id: 'u1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ss2', basic_salary: 7000 }] });

    const res = await payroll.upsertSalaryStructure('u1', { basicSalary: 7000 }, 'actor1');

    const [sql, params] = q.mock.calls[2];
    expect(sql).toContain('INSERT INTO salary_structures');
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe(7000);
    expect(params[2]).toBe(0);   // hraPct default
    expect(params[7]).toBe(12);  // pfPct default
    expect(params[8]).toBe(today);
    expect(params[10]).toBe('actor1');
    expect(auditMock).toHaveBeenCalledWith('actor1', 'UPSERT', 'salary_structures', 'ss2', null, res);
  });
});

// ---------------------------------------------------------------------------
// getSalaryStructure / getSalaryHistory
// ---------------------------------------------------------------------------
describe('payroll.service — getSalaryStructure', () => {
  it('returns the latest structure or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'ss1' }] });
    expect(await payroll.getSalaryStructure('u1')).toEqual({ id: 'ss1' });

    q.mockResolvedValueOnce({ rows: [] });
    expect(await payroll.getSalaryStructure('u1')).toBeNull();
  });
});

describe('payroll.service — getSalaryHistory', () => {
  it('returns all structures with creator name', async () => {
    q.mockResolvedValue({ rows: [{ id: 'ss1', created_by_name: 'Ann A' }] });
    const res = await payroll.getSalaryHistory('u1');
    expect(res).toEqual([{ id: 'ss1', created_by_name: 'Ann A' }]);
    expect(q.mock.calls[0][1]).toEqual(['u1']);
  });
});

// ---------------------------------------------------------------------------
// createPayrollRun
// ---------------------------------------------------------------------------
describe('payroll.service — createPayrollRun', () => {
  it('throws 409 when a run already exists for the month', async () => {
    q.mockResolvedValue({ rows: [{ id: 'r1', status: 'DRAFT' }] });
    await expect(payroll.createPayrollRun({ periodYear: 2025, periodMonth: 3 }, 'a'))
      .rejects.toMatchObject({
        status: 409,
        message: 'Payroll run for 2025-03 already exists (status: DRAFT)',
      });
  });

  it('creates a DRAFT run and audits', async () => {
    q.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'DRAFT' }] });

    const res = await payroll.createPayrollRun({ periodYear: 2025, periodMonth: 3, notes: 'March' }, 'a');

    expect(q.mock.calls[1][1]).toEqual([2025, 3, 'March', 'a']);
    expect(res.status).toBe('DRAFT');
    expect(auditMock).toHaveBeenCalledWith('a', 'CREATE', 'payroll_runs', 'r1', null, res);
  });
});

// ---------------------------------------------------------------------------
// listPayrollRuns
// ---------------------------------------------------------------------------
describe('payroll.service — listPayrollRuns', () => {
  it('paginates with default params and strips total_count', async () => {
    q.mockResolvedValue({
      rows: [{ id: 'r1', processed_by_name: 'Ann', total_count: '1' }],
    });
    const res = await payroll.listPayrollRuns({});
    expect(q.mock.calls[0][1]).toEqual([24, 0]);
    expect(res).toEqual({
      runs : [{ id: 'r1', processed_by_name: 'Ann' }],
      total: 1, page: 1, limit: 24,
    });
  });

  it('filters by year/month and paginates', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await payroll.listPayrollRuns({ year: 2025, month: 3, page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('period_year = $1');
    expect(sql).toContain('period_month = $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual([2025, 3, 10, 10]);
    expect(res.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// processPayrollRun
// ---------------------------------------------------------------------------
const RUN = { id: 'r1', status: 'DRAFT', period_year: 2025, period_month: 3 };
const SS  = { id: 'ss1', basic_salary: 10000, hra_pct: 10, transport_allow: 1000, medical_allow: 500, other_allow: 200, tax_pct: 10, pf_pct: 12 };

function mockRunLookup(run = RUN) {
  return q
    .mockResolvedValueOnce({ rows: [run] })       // initial run lookup
    .mockResolvedValueOnce({ rows: [{ id: 'r1' }] }) // claim: DRAFT -> PROCESSING
    .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] }); // employees
}

describe('payroll.service — processPayrollRun', () => {
  it('throws 404 when the run is missing', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(payroll.processPayrollRun('nope', 'a')).rejects.toMatchObject({
      status: 404, message: 'Payroll run not found',
    });
  });

  it('throws 409 when already processed', async () => {
    q.mockResolvedValue({ rows: [{ ...RUN, status: 'PROCESSED' }] });
    await expect(payroll.processPayrollRun('r1', 'a')).rejects.toMatchObject({
      status: 409, message: 'Payroll run already processed',
    });
  });

  it('throws 409 when processing is in progress', async () => {
    q.mockResolvedValue({ rows: [{ ...RUN, status: 'PROCESSING' }] });
    await expect(payroll.processPayrollRun('r1', 'a')).rejects.toMatchObject({
      status: 409, message: 'Payroll run is already being processed',
    });
  });

  it('computes pro-rated payslips and updates run totals', async () => {
    mockRunLookup();
    clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM payroll_details')) return {};
      if (sql.includes('FROM salary_structures')) return { rows: [SS] };
      if (sql.includes('FROM leaves')) return { rows: [] };
      if (sql.includes('INSERT INTO payroll_details')) return {};
      if (sql.includes('UPDATE payroll_runs')) return {};
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ ...RUN, status: 'PROCESSED', total_gross: 12700 }] });

    const res = await payroll.processPayrollRun('r1', 'a');

    // March 2025 has 21 weekdays
    const insert = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO payroll_details'));
    expect(insert[1]).toEqual(['r1', 'u1', 'ss1', 21, 21, 0, 10000, 1000, 1000, 500, 200, 12700, 1270, 1200, 10230]);

    const update = clientQuery.mock.calls.find((c) => c[0].includes('UPDATE payroll_runs'));
    expect(update[1]).toEqual([
      'PROCESSED', 'a', 12700, 2470, 10230, 0, 'r1',
    ]);

    expect(auditMock).toHaveBeenCalledWith('a', 'PROCESS', 'payroll_runs', 'r1', { status: 'DRAFT' }, { status: 'PROCESSED' });
    expect(res.status).toBe('PROCESSED');
    expect(res.total_gross).toBe(12700);
  });

  it('records an error detail when an employee has no salary structure', async () => {
    mockRunLookup();
    clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM payroll_details')) return {};
      if (sql.includes('FROM salary_structures')) return { rows: [] };
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ ...RUN, status: 'PROCESSED' }] });

    await payroll.processPayrollRun('r1', 'a');

    const errorInsert = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO payroll_details'));
    expect(errorInsert[1]).toEqual(['r1', 'u1', 21, 'No salary structure found']);
  });

  it('marks the run ERROR when every employee fails', async () => {
    q.mockResolvedValueOnce({ rows: [RUN] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });
    clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM payroll_details')) return {};
      if (sql.includes('FROM salary_structures')) return { rows: [] };
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ ...RUN, status: 'ERROR', error_count: 1 }] });

    const res = await payroll.processPayrollRun('r1', 'a');
    const update = clientQuery.mock.calls.find((c) => c[0].includes('UPDATE payroll_runs'));
    expect(update[1][0]).toBe('ERROR');
    expect(update[1][5]).toBe(1);
    expect(res.status).toBe('ERROR');
  });

  it('catches per-employee exceptions and logs them', async () => {
    mockRunLookup();
    clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM payroll_details')) return {};
      if (sql.includes('FROM salary_structures')) throw new Error('boom');
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ ...RUN, status: 'PROCESSED', error_count: 1 }] });

    await payroll.processPayrollRun('r1', 'a');

    expect(loggerError).toHaveBeenCalledWith('[payroll] Error processing employee', { userId: 'u1', message: 'boom' });
    const errorInsert = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO payroll_details'));
    expect(errorInsert[1][3]).toBe('boom');
  });

  it('rejects a concurrent claim when the run is no longer DRAFT', async () => {
    q.mockResolvedValueOnce({ rows: [RUN] })  // initial lookup sees DRAFT
      .mockResolvedValueOnce({ rows: [] });    // claim UPDATE affects 0 rows
    await expect(payroll.processPayrollRun('r1', 'a')).rejects.toMatchObject({
      status: 409, message: 'Payroll run is already being processed',
    });
  });

  it('resets a run to its prior status when processing fails', async () => {
    mockRunLookup().mockResolvedValueOnce({ rows: [] }); // reset-on-failure UPDATE
    withTx.mockImplementationOnce(async () => { throw new Error('txn boom'); });
    await expect(payroll.processPayrollRun('r1', 'a')).rejects.toThrow('txn boom');
    const reset = q.mock.calls[q.mock.calls.length - 1];
    expect(reset[0]).toContain("SET status = $1");
    expect(reset[0]).toContain("status = 'PROCESSING'");
    expect(reset[1]).toEqual(['DRAFT', 'r1']);
  });

  it('attributes a cross-month leave only to the days inside the month', async () => {
    mockRunLookup();
    // Leave Fri 2025-03-28 -> Tue 2025-04-01: business days inside March are
    // Fri 28 and Mon 31 = 2 (Apr 1 belongs to the April run, not March).
    clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('DELETE FROM payroll_details')) return {};
      if (sql.includes('FROM salary_structures')) return { rows: [SS] };
      if (sql.includes('FROM leaves')) {
        return { rows: [{ start_date: new Date(2025, 2, 28), end_date: new Date(2025, 3, 1) }] };
      }
      if (sql.includes('INSERT INTO payroll_details')) return {};
      if (sql.includes('UPDATE payroll_runs')) return {};
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ ...RUN, status: 'PROCESSED' }] });

    await payroll.processPayrollRun('r1', 'a');
    const insert = clientQuery.mock.calls.find((c) => c[0].includes('INSERT INTO payroll_details'));
    expect(insert[1][5]).toBe(2);   // leave_days: only the March business days
    expect(insert[1][4]).toBe(19);  // present_days = 21 working days - 2
  });
});

// ---------------------------------------------------------------------------
// getRunDetails
// ---------------------------------------------------------------------------
describe('payroll.service — getRunDetails', () => {
  it('filters by run, hasError and search with pagination', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1', user_id: 'u1', total_count: '1' }] });
    const res = await payroll.getRunDetails('r1', { hasError: 'true', search: 'jo', page: 1, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('pd.run_id = $1');
    expect(sql).toContain('pd.has_error = TRUE');
    expect(sql).toContain('(u.first_name || \' \' || u.last_name) ILIKE $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['r1', '%jo%', 10, 0]);
    expect(res).toEqual({
      details: [{ id: 'd1', user_id: 'u1' }],
      total: 1, page: 1, limit: 10,
    });
  });

  it('handles hasError=false and empty rows', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await payroll.getRunDetails('r1', { hasError: 'false' });
    expect(q.mock.calls[0][0]).toContain('pd.has_error = FALSE');
    expect(res.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getUserPayslips
// ---------------------------------------------------------------------------
describe('payroll.service — getUserPayslips', () => {
  it('returns processed payslips for a user', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1', run_status: 'PROCESSED', total_count: '2' }] });
    const res = await payroll.getUserPayslips('u1', { page: 1, limit: 5 });
    expect(q.mock.calls[0][1]).toEqual(['u1', 5, 0]);
    expect(q.mock.calls[0][0]).toContain("pr.status = 'PROCESSED'");
    expect(res).toEqual({
      payslips: [{ id: 'd1', run_status: 'PROCESSED' }],
      total: 2, page: 1, limit: 5,
    });
  });

  it('defaults pagination options', async () => {
    q.mockResolvedValue({ rows: [] });
    await payroll.getUserPayslips('u1');
    expect(q.mock.calls[0][1]).toEqual(['u1', 24, 0]);
  });
});
