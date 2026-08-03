// Coverage for the departments module: listing with search/active filters,
// creating departments, and updating departments.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

import * as departments from '../src/modules/departments/departments.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('departments.service — listDepartments', () => {
  it('paginates without filters', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1', total_count: '1' }] });
    const res = await departments.listDepartments({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([20, 0]);
    expect(res).toEqual({ departments: [{ id: 'd1' }], total: 1, page: 1, limit: 20 });
  });

  it('filters by search and active status', async () => {
    q.mockResolvedValue({ rows: [] });
    await departments.listDepartments({ search: 'car', isActive: true, page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('(d.name ILIKE $1 OR d.code ILIKE $1)');
    expect(sql).toContain('d.is_active = $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['%car%', true, 10, 10]);
  });

  it('returns zero total on empty rows', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await departments.listDepartments({ page: 1, limit: 20 });
    expect(res.total).toBe(0);
  });
});

describe('departments.service — createDepartment', () => {
  it('inserts with defaults', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1', name: 'Cardiology' }] });
    const res = await departments.createDepartment({ name: 'Cardiology', code: 'CAR' }, 'u1');
    expect(q.mock.calls[0][0]).toContain('INSERT INTO departments');
    expect(q.mock.calls[0][1]).toEqual(['Cardiology', 'CAR', null, null]);
    expect(res.id).toBe('d1');
  });
});

describe('departments.service — updateDepartment', () => {
  it('builds set clauses only for provided fields', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1', name: 'Neuro' }] });
    const res = await departments.updateDepartment('d1', { name: 'Neuro', floor: 3 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('UPDATE departments SET name = $1, floor = $2, updated_at = NOW()');
    expect(sql).toContain('WHERE id = $3 AND deleted_at IS NULL');
    expect(params).toEqual(['Neuro', 3, 'd1']);
    expect(res).toEqual({ id: 'd1', name: 'Neuro' });
  });

  it('returns null when no fields are provided', async () => {
    const res = await departments.updateDepartment('d1', {});
    expect(res).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });

  it('returns null when the department does not exist', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await departments.updateDepartment('nope', { name: 'X' });
    expect(res).toBeNull();
  });
});
