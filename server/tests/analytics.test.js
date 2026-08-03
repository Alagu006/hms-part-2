// Coverage for the analytics module: patient/financial/staff/operational
// stats with 5-minute Redis caching and cache-hit short circuits.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, redisGet, redisSetex } = vi.hoisted(() => ({
  q: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: {
    get: redisGet, setex: redisSetex,
    incr: vi.fn(), expire: vi.fn(), del: vi.fn(),
  },
}));

import * as analytics from '../src/modules/analytics/analytics.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  redisGet.mockResolvedValue(null);
});

describe('analytics.service — getPatientStats', () => {
  it('returns cached data without hitting the database', async () => {
    const cached = { admissions: [], occupancyRate: 50 };
    redisGet.mockResolvedValue(JSON.stringify(cached));

    const res = await analytics.getPatientStats('7d');
    expect(res).toEqual(cached);
    expect(q).not.toHaveBeenCalled();
  });

  it('falls through to the DB when the cached value is not valid JSON', async () => {
    redisGet.mockResolvedValue('not-json');
    q.mockResolvedValueOnce({ rows: [{ date: '2026-08-01', count: 1, running_total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ occupied: 8, total: 10 }] })
      .mockResolvedValueOnce({ rows: [{ department: 'Cardiology', count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ avg_los: 4.5 }] });

    const res = await analytics.getPatientStats('7d');

    // admissions query receives the period-derived day count
    expect(q.mock.calls[0][0]).toContain('generate_series');
    expect(q.mock.calls[0][1]).toEqual([7]);

    expect(res).toEqual({
      admissions       : [{ date: '2026-08-01', count: 1, running_total: 1 }],
      occupancyRate    : 80,
      occupancy        : { occupied: 8, total: 10 },
      deptDistribution : [{ department: 'Cardiology', count: 3 }],
      avgLengthOfStay  : 4.5,
    });

    expect(redisSetex).toHaveBeenCalledWith(
      'analytics:patient:7d',
      300,
      JSON.stringify(res)
    );
  });

  it('defaults to 30 days and handles empty occupancy/los', async () => {
    q.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ occupied: 0, total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await analytics.getPatientStats();
    expect(q.mock.calls[0][1]).toEqual([30]);
    expect(res.occupancyRate).toBe(0);
    expect(res.occupancy).toEqual({ occupied: 0, total: 0 });
    expect(res.avgLengthOfStay).toBe(0);
  });
});

describe('analytics.service — getFinancialStats', () => {
  it('aggregates revenue and outstanding totals', async () => {
    q.mockResolvedValueOnce({ rows: [{ date: 'd1', revenue: 100, cumulative: 100 }, { date: 'd2', revenue: 50, cumulative: 150 }] })
      .mockResolvedValueOnce({ rows: [{ outstanding: 500, bill_count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ method: 'CASH', count: 2, total: 150 }] })
      .mockResolvedValueOnce({ rows: [{ department: 'Cardio', revenue: 250 }] });

    const res = await analytics.getFinancialStats('30d');

    expect(res.dailyRevenue).toHaveLength(2);
    expect(res.outstandingAmount).toBe(500);
    expect(res.outstandingBillCount).toBe(3);
    expect(res.totalCollected).toBe(150);
    expect(res.paymentMethodBreakdown).toEqual([{ method: 'CASH', count: 2, total: 150 }]);
    expect(res.topDepts).toEqual([{ department: 'Cardio', revenue: 250 }]);
    expect(q.mock.calls[0][1]).toEqual([30]);
    expect(redisSetex).toHaveBeenCalledWith('analytics:financial:30d', 300, expect.any(String));
  });

  it('defaults to zero when no outstanding rows exist', async () => {
    q.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await analytics.getFinancialStats('90d');
    expect(res.outstandingAmount).toBe(0);
    expect(res.outstandingBillCount).toBe(0);
    expect(res.totalCollected).toBe(0);
    expect(q.mock.calls[0][1]).toEqual([90]);
  });
});

describe('analytics.service — getStaffPerformance', () => {
  it('returns doctor and nurse rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'd1', first_name: 'Ann', last_name: 'Lee', patients_seen: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'n1', first_name: 'Bo', last_name: 'Ba', vitals_recorded: 9 }] });

    const res = await analytics.getStaffPerformance('30d');
    expect(res.doctors).toEqual([{ id: 'd1', first_name: 'Ann', last_name: 'Lee', patients_seen: 4 }]);
    expect(res.nurses).toEqual([{ id: 'n1', first_name: 'Bo', last_name: 'Ba', vitals_recorded: 9 }]);
    expect(q.mock.calls[0][1]).toEqual([30]);
    expect(q.mock.calls[1][1]).toEqual([30]);
  });
});

describe('analytics.service — getOperationalStats', () => {
  it('computes fulfillment rate and counts', async () => {
    q.mockResolvedValueOnce({ rows: [{ completed: 7, total: 10, no_show: 1, cancelled: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ date: 'd1', count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ category: 'X', current_stock: 5, reorder_level: 2, low_stock_count: 1 }] });

    const res = await analytics.getOperationalStats('7d');

    expect(res.appointmentFulfillmentRate).toBe(70);
    expect(res.appointments).toEqual({ completed: 7, total: 10, noShow: 1, cancelled: 2 });
    expect(res.telemedicineCount).toBe(4);
    expect(res.labTestVolume).toEqual([{ date: 'd1', count: 3 }]);
    expect(res.inventoryTurnover).toEqual([{ category: 'X', current_stock: 5, reorder_level: 2, low_stock_count: 1 }]);
    expect(redisSetex).toHaveBeenCalledWith('analytics:operational:7d', 300, expect.any(String));
  });

  it('handles zero appointments', async () => {
    q.mockResolvedValueOnce({ rows: [{ completed: 0, total: 0, no_show: 0, cancelled: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await analytics.getOperationalStats('30d');
    expect(res.appointmentFulfillmentRate).toBe(0);
    expect(res.telemedicineCount).toBe(0);
  });
});
