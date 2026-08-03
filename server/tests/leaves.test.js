// Coverage for the leave module: seeding balances, applying for leave (with
// balance locks, overlap checks, auto-seed), listing/approval/rejection flows,
// balances and the leave calendar.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, poolConnect, auditMock, createNotifMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  poolConnect: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  pool : { query: q, connect: poolConnect },
  query: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { LEAVE: 'LEAVE' },
}));

import * as leaves from '../src/modules/leaves/leave.service.js';

function mockClient() {
  const client = { query: vi.fn(), release: vi.fn() };
  poolConnect.mockResolvedValue(client);
  return client;
}

const BAL = { id: 'lb1', user_id: 'u1', leave_type: 'ANNUAL', year: 2026, total_days: '15', used_days: '0', pending_days: '0' };
const LEAVE = { id: 'lv1', user_id: 'u1', leave_type: 'ANNUAL', start_date: '2026-03-03', end_date: '2026-03-05', days_count: '3', status: 'PENDING' };

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  createNotifMock.mockImplementation(async () => ({}));
});

// ---------------------------------------------------------------------------
// seedLeaveBalances
// ---------------------------------------------------------------------------
describe('leave.service — seedLeaveBalances', () => {
  it('seeds all seven leave types via the pool by default', async () => {
    q.mockResolvedValue({});
    await leaves.seedLeaveBalances('u1');
    const [sql] = q.mock.calls[0];
    expect(sql).toContain('INSERT INTO leave_balances');
    expect(sql).toContain('ANNUAL');
    expect(sql).toContain('SICK');
    expect(sql).toContain('EMERGENCY');
    expect(sql).toContain('MATERNITY');
    expect(sql).toContain('PATERNITY');
    expect(sql).toContain('UNPAID');
    expect(sql).toContain('COMPENSATORY');
    expect(sql).toContain(String(new Date().getFullYear()));
  });

  it('uses the provided client when given one', async () => {
    const client = mockClient();
    client.query.mockResolvedValue({});
    await leaves.seedLeaveBalances('u1', client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(q).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyLeave
// ---------------------------------------------------------------------------
describe('leave.service — applyLeave', () => {
  it('rejects an invalid leave type', async () => {
    await expect(leaves.applyLeave({ userId: 'u1', leaveType: 'BOGUS', startDate: '2026-03-03', endDate: '2026-03-05' }, 'ip'))
      .rejects.toMatchObject({ status: 400, message: 'Invalid leave type: BOGUS' });
  });

  it('rejects when end date precedes start date', async () => {
    await expect(leaves.applyLeave({ userId: 'u1', leaveType: 'ANNUAL', startDate: '2026-03-05', endDate: '2026-03-03' }, 'ip'))
      .rejects.toMatchObject({ status: 400, message: 'end_date must be >= start_date' });
  });

  it('rejects a weekend-only range with no working days', async () => {
    await expect(leaves.applyLeave({ userId: 'u1', leaveType: 'ANNUAL', startDate: '2026-03-07', endDate: '2026-03-08' }, 'ip'))
      .rejects.toMatchObject({ status: 400, message: 'Leave must include at least one working day' });
  });

  it('throws 422 when the balance is insufficient', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [{ ...BAL, total_days: '3' }] };
      return { rows: [] };
    });

    await expect(leaves.applyLeave({ userId: 'u1', leaveType: 'ANNUAL', startDate: '2026-03-02', endDate: '2026-03-27' }, 'ip'))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining('Insufficient ANNUAL balance') });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('throws 409 on overlapping pending/approved leave', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [BAL] };
      if (sql.includes('SELECT id FROM leaves')) return { rows: [{ id: 'other' }] };
      return { rows: [] };
    });

    await expect(leaves.applyLeave({ userId: 'u1', leaveType: 'ANNUAL', startDate: '2026-03-03', endDate: '2026-03-05' }, 'ip'))
      .rejects.toMatchObject({ status: 409, message: 'You already have a leave request overlapping these dates' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('auto-seeds a missing balance and applies successfully', async () => {
    const client = mockClient();
    let locks = 0;
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SELECT * FROM leave_balances') && sql.includes('FOR UPDATE')) {
        locks++;
        return { rows: locks === 1 ? [] : [BAL] };
      }
      if (sql.includes('INSERT INTO leave_balances')) return {};
      if (sql.includes('SELECT id FROM leaves')) return { rows: [] };
      if (sql.includes('INSERT INTO leaves')) return { rows: [LEAVE] };
      if (sql.includes('UPDATE leave_balances')) return {};
      return { rows: [] };
    });

    const res = await leaves.applyLeave({ userId: 'u1', leaveType: 'ANNUAL', startDate: '2026-03-03', endDate: '2026-03-05', reason: 'vacation' }, 'ip');

    expect(locks).toBe(2);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', action: 'CREATE', entity: 'leaves', entityId: 'lv1', ip: 'ip',
    }));
    expect(res).toEqual(LEAVE);
  });

  it('applies UNPAID leave without a balance check', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [{ ...BAL, leave_type: 'UNPAID', total_days: '0' }] };
      if (sql.includes('SELECT id FROM leaves')) return { rows: [] };
      if (sql.includes('INSERT INTO leaves')) return { rows: [{ ...LEAVE, leave_type: 'UNPAID' }] };
      return { rows: [] };
    });

    const res = await leaves.applyLeave({ userId: 'u1', leaveType: 'UNPAID', startDate: '2026-03-03', endDate: '2026-03-05' }, 'ip');
    expect(res.leave_type).toBe('UNPAID');

    const update = client.query.mock.calls.find((c) => c[0].includes('UPDATE leave_balances'));
    expect(update[1]).toEqual([3, 'u1', 'UNPAID', 2026]);
  });
});

// ---------------------------------------------------------------------------
// getMyLeaves
// ---------------------------------------------------------------------------
describe('leave.service — getMyLeaves', () => {
  it('returns leaves and balances', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'lv1' }] })
      .mockResolvedValueOnce({ rows: [{ leave_type: 'ANNUAL', available_days: '12' }] });
    const res = await leaves.getMyLeaves('u1');
    expect(res).toEqual({
      leaves  : [{ id: 'lv1' }],
      balances: [{ leave_type: 'ANNUAL', available_days: '12' }],
    });
    expect(q.mock.calls[1][1]).toEqual(['u1', new Date().getFullYear()]);
  });
});

// ---------------------------------------------------------------------------
// getAllLeaves
// ---------------------------------------------------------------------------
describe('leave.service — getAllLeaves', () => {
  it('paginates with defaults when no filters given', async () => {
    q.mockResolvedValue({ rows: [] });
    await leaves.getAllLeaves({});
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE l.deleted_at IS NULL');
    expect(params).toEqual([50, 0]);
  });

  it('combines status/date/department/role filters', async () => {
    q.mockResolvedValue({ rows: [] });
    await leaves.getAllLeaves({ status: 'PENDING', dateFrom: '2026-01-01', dateTo: '2026-12-31', department: 'dep1', role: 'DOCTOR', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('l.status = $1');
    expect(sql).toContain('l.start_date >= $2');
    expect(sql).toContain('l.end_date <= $3');
    expect(sql).toContain('u.department_id = $4');
    expect(sql).toContain('AND ur.role = $5');
    expect(sql).toContain('LIMIT $6 OFFSET $7');
    expect(params).toEqual(['PENDING', '2026-01-01', '2026-12-31', 'dep1', 'DOCTOR', 10, 10]);
  });
});

// ---------------------------------------------------------------------------
// approveLeave
// ---------------------------------------------------------------------------
describe('leave.service — approveLeave', () => {
  function approveClient(mockFn) {
    const client = mockClient();
    client.query.mockImplementation(mockFn);
    return client;
  }

  it('throws 404 when the leave is missing', async () => {
    const client = approveClient(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [] };
      return { rows: [] };
    });
    await expect(leaves.approveLeave('lv1', 'rev', 'ip')).rejects.toMatchObject({
      status: 404, message: 'Leave not found',
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws 409 when the leave is not pending', async () => {
    approveClient(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [{ ...LEAVE, status: 'APPROVED' }] };
      return { rows: [] };
    });
    await expect(leaves.approveLeave('lv1', 'rev', 'ip')).rejects.toMatchObject({
      status: 409, message: 'Cannot approve a leave with status: APPROVED',
    });
  });

  it('throws 500 when the balance record is missing', async () => {
    approveClient(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [LEAVE] };
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [] };
      return { rows: [] };
    });
    await expect(leaves.approveLeave('lv1', 'rev', 'ip')).rejects.toMatchObject({
      status: 500, message: 'Balance record not found',
    });
  });

  it('throws 422 when balance is insufficient to approve', async () => {
    approveClient(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [LEAVE] };
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [{ ...BAL, total_days: '1' }] };
      return { rows: [] };
    });
    await expect(leaves.approveLeave('lv1', 'rev', 'ip')).rejects.toMatchObject({
      status: 422, message: 'Insufficient balance to approve this leave',
    });
  });

  it('approves, moves pending to used, notifies and audits', async () => {
    const client = approveClient(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [LEAVE] };
      if (sql.includes('SELECT * FROM leave_balances')) return { rows: [BAL] };
      if (sql.includes('UPDATE leaves')) return { rows: [{ ...LEAVE, status: 'APPROVED' }] };
      if (sql.includes('UPDATE leave_balances')) return {};
      return { rows: [] };
    });

    const res = await leaves.approveLeave('lv1', 'rev', 'ip');

    const updateBal = client.query.mock.calls.find((c) => c[0].includes('UPDATE leave_balances'));
    expect(updateBal[1]).toEqual(['3', 'u1', 'ANNUAL', 2026]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');

    expect(createNotifMock).toHaveBeenCalledWith(
      'u1', 'LEAVE', 'Leave Approved',
      'Your ANNUAL leave (2026-03-03 – 2026-03-05) has been approved.',
      { entityType: 'leaves', entityId: 'lv1' }
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'rev', action: 'APPROVE', entity: 'leaves', entityId: 'lv1', ip: 'ip',
    }));
    expect(res.status).toBe('APPROVED');
  });
});

// ---------------------------------------------------------------------------
// rejectLeave
// ---------------------------------------------------------------------------
describe('leave.service — rejectLeave', () => {
  it('throws 404 when the leave is missing', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [] };
      return { rows: [] };
    });
    await expect(leaves.rejectLeave('lv1', 'rev', 'note', 'ip')).rejects.toMatchObject({
      status: 404, message: 'Leave not found',
    });
  });

  it('throws 409 when not pending', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [{ ...LEAVE, status: 'REJECTED' }] };
      return { rows: [] };
    });
    await expect(leaves.rejectLeave('lv1', 'rev', 'note', 'ip')).rejects.toMatchObject({
      status: 409, message: 'Cannot reject a leave with status: REJECTED',
    });
  });

  it('rejects with a review note and releases pending days', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('SELECT * FROM leaves')) return { rows: [LEAVE] };
      if (sql.includes('UPDATE leaves')) return { rows: [{ ...LEAVE, status: 'REJECTED', review_note: 'note' }] };
      if (sql.includes('UPDATE leave_balances')) return {};
      return { rows: [] };
    });

    const res = await leaves.rejectLeave('lv1', 'rev', 'note', 'ip');

    const update = client.query.mock.calls.find((c) => c[0].includes('UPDATE leaves'));
    expect(update[1]).toEqual(['rev', 'note', 'lv1']);
    const release = client.query.mock.calls.find((c) => c[0].includes('UPDATE leave_balances'));
    expect(release[1]).toEqual(['3', 'u1', 'ANNUAL', 2026]);

    expect(createNotifMock).toHaveBeenCalledWith(
      'u1', 'LEAVE', 'Leave Rejected',
      'Your ANNUAL leave request was rejected. Reason: note',
      { entityType: 'leaves', entityId: 'lv1' }
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'rev', action: 'REJECT', entity: 'leaves', entityId: 'lv1', nextData: { status: 'REJECTED', reviewNote: 'note' },
    }));
    expect(res.status).toBe('REJECTED');
  });

  it('rejects without a note and omits the reason from the notification', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM leaves')) return { rows: [LEAVE] };
      if (sql.includes('UPDATE leaves')) return { rows: [{ ...LEAVE, status: 'REJECTED' }] };
      return { rows: [] };
    });

    await leaves.rejectLeave('lv1', 'rev', null, 'ip');
    expect(createNotifMock).toHaveBeenCalledWith(
      'u1', 'LEAVE', 'Leave Rejected',
      'Your ANNUAL leave request was rejected.',
      { entityType: 'leaves', entityId: 'lv1' }
    );
  });
});

// ---------------------------------------------------------------------------
// getBalances
// ---------------------------------------------------------------------------
describe('leave.service — getBalances', () => {
  it('returns balance rows for the current year', async () => {
    q.mockResolvedValue({ rows: [{ leave_type: 'ANNUAL' }] });
    const res = await leaves.getBalances('u1');
    expect(res).toEqual([{ leave_type: 'ANNUAL' }]);
    expect(q.mock.calls[0][1]).toEqual(['u1', new Date().getFullYear()]);
  });
});

// ---------------------------------------------------------------------------
// getLeaveCalendar
// ---------------------------------------------------------------------------
describe('leave.service — getLeaveCalendar', () => {
  it('queries without department filter', async () => {
    q.mockResolvedValue({ rows: [] });
    await leaves.getLeaveCalendar({ month: 3, year: 2026 });
    expect(q.mock.calls[0][1]).toEqual([2026, 3]);
    expect(q.mock.calls[0][0]).not.toContain('u.department_id = $3');
  });

  it('adds a department filter', async () => {
    q.mockResolvedValue({ rows: [] });
    await leaves.getLeaveCalendar({ month: 3, year: 2026, department: 'dep1' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('u.department_id = $3');
    expect(params).toEqual([2026, 3, 'dep1']);
  });
});
