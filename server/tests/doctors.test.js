// Coverage for the doctors module: listing active doctors with optional
// department and search filters.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

import * as doctors from '../src/modules/doctors/doctors.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('doctors.service — listDoctors', () => {
  it('paginates with base active-doctor conditions', async () => {
    q.mockResolvedValue({ rows: [] });
    await doctors.listDoctors({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("u.is_active = TRUE");
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("ur.role = 'DOCTOR'");
    expect(params).toEqual([20, 0]);
  });

  it('adds department and search filters', async () => {
    q.mockResolvedValue({ rows: [{ id: 'doc1', total_count: '1' }] });
    const res = await doctors.listDoctors({ departmentId: 'dep1', search: 'bo', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('u.department_id = $1');
    expect(sql).toContain('(u.first_name ILIKE $2 OR u.last_name ILIKE $2)');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['dep1', '%bo%', 10, 10]);
    expect(res).toEqual({ doctors: [{ id: 'doc1' }], total: 1, page: 2, limit: 10 });
  });

  it('returns zero total on empty rows', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await doctors.listDoctors({ page: 1, limit: 20 });
    expect(res.total).toBe(0);
  });
});
