// Coverage for the diet-plans module: listing, creating, and updating plans.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  pool : { query: q, connect: vi.fn() },
  query: q,
  withTransaction: vi.fn(),
}));

import * as dietPlans from '../src/modules/diet-plans/diet-plans.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('diet-plans.service — listDietPlans', () => {
  it('lists plans with defaults', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1' }] });
    const res = await dietPlans.listDietPlans({});
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE dp.deleted_at IS NULL');
    expect(params).toEqual([50, 0]);
    expect(res).toEqual([{ id: 'd1' }]);
  });

  it('filters by patient', async () => {
    q.mockResolvedValue({ rows: [] });
    await dietPlans.listDietPlans({ patientId: 'p1', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('dp.patient_id = $1');
    expect(params).toEqual(['p1', 10, 10]);
  });
});

describe('diet-plans.service — createDietPlan', () => {
  it('inserts with nulls for missing fields', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1' }] });
    const res = await dietPlans.createDietPlan({ patientId: 'p1', planName: 'Cardiac' }, 'u1');
    expect(q.mock.calls[0][1]).toEqual(['p1', 'Cardiac', null, null, null, null, null, null, null, null, 'u1']);
    expect(res.id).toBe('d1');
  });
});

describe('diet-plans.service — updateDietPlan', () => {
  it('throws 400 when there is nothing to update', async () => {
    await expect(dietPlans.updateDietPlan('d1', {})).rejects.toMatchObject({
      status: 400, message: 'Nothing to update',
    });
  });

  it('throws 404 when the plan does not exist', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(dietPlans.updateDietPlan('nope', { calories: 100 })).rejects.toMatchObject({
      status: 404, message: 'Diet plan not found',
    });
  });

  it('maps camelCase fields to columns', async () => {
    q.mockResolvedValue({ rows: [{ id: 'd1' }] });
    await dietPlans.updateDietPlan('d1', { planName: 'Low carb', calories: 1200, isActive: false });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('SET plan_name = $1, calories = $2, is_active = $3, updated_at = NOW()');
    expect(sql).toContain('WHERE id = $4');
    expect(params).toEqual(['Low carb', 1200, false, 'd1']);
  });
});
