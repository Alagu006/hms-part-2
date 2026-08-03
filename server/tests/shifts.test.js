// Coverage for the shifts module: listing shift schedules with filters,
// creating shifts (with conflict-skip), and soft-deleting shifts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

import * as shifts from '../src/modules/shifts/shifts.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('shifts.service — listShifts', () => {
  it('paginates with defaults when no filters given', async () => {
    q.mockResolvedValue({ rows: [] });
    await shifts.listShifts({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE s.deleted_at IS NULL');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([20, 0]);
  });

  it('builds filters in order and returns stripped rows', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1', total_count: '1' }] });
    const res = await shifts.listShifts({ userId: 'u1', departmentId: 'dep1', shiftDate: '2026-03-03', shiftType: 'MORNING', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('s.user_id = $1');
    expect(sql).toContain('s.department_id = $2');
    expect(sql).toContain('s.shift_date = $3');
    expect(sql).toContain('s.shift_type = $4');
    expect(sql).toContain('LIMIT $5 OFFSET $6');
    expect(params).toEqual(['u1', 'dep1', '2026-03-03', 'MORNING', 10, 10]);
    expect(res).toEqual({ shifts: [{ id: 's1' }], total: 1, page: 2, limit: 10 });
  });

  it('returns zero total on empty rows', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await shifts.listShifts({ page: 1, limit: 20 });
    expect(res.total).toBe(0);
  });
});

describe('shifts.service — createShift', () => {
  it('inserts with defaults and returns the created row', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1', shift_type: 'MORNING' }] });
    const res = await shifts.createShift(
      { userId: 'u1', shiftType: 'MORNING', shiftDate: '2026-03-03', startTime: '08:00', endTime: '16:00' },
      'actor1'
    );
    expect(q.mock.calls[0][0]).toContain('ON CONFLICT (user_id, shift_date, shift_type) DO NOTHING');
    expect(q.mock.calls[0][1]).toEqual(['u1', null, 'MORNING', '2026-03-03', '08:00', '16:00', null, 'actor1']);
    expect(res.id).toBe('s1');
  });

  it('returns null when the insert conflicts', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await shifts.createShift(
      { userId: 'u1', shiftType: 'MORNING', shiftDate: '2026-03-03', startTime: '08:00', endTime: '16:00' },
      'actor1'
    );
    expect(res).toBeNull();
  });
});

describe('shifts.service — deleteShift', () => {
  it('soft-deletes and returns the row', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1' }] });
    const res = await shifts.deleteShift('s1');
    expect(q.mock.calls[0][0]).toContain('SET deleted_at = NOW()');
    expect(q.mock.calls[0][1]).toEqual(['s1']);
    expect(res).toEqual({ id: 's1' });
  });

  it('returns null when already deleted', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await shifts.deleteShift('nope');
    expect(res).toBeNull();
  });
});
