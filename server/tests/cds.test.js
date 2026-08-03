// Coverage for the CDS module: sepsis/duplicate/allergy/interaction/guideline
// checks, alert persistence with dedupe, and acknowledge/dismiss.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, poolConnect, clientQuery, uuidV4 } = vi.hoisted(() => ({
  q: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  uuidV4: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: poolConnect },
  withTransaction: vi.fn(),
}));

vi.mock('uuid', () => ({ v4: uuidV4 }));

import * as cds from '../src/modules/cds/cds.service.js';

const client = { query: clientQuery, release: vi.fn() };

function setupQueries(overrides) {
  clientQuery.mockImplementation(async (sql, params) => {
    if (sql.includes('INSERT INTO cds_alerts')) {
      if (overrides?.insert && overrides.insert.length === 0) return { rows: [] };
      const severity = params[4] ?? 'GENERAL';
      return { rows: [{ id: `persisted-${params[3]}`, type: params[3], severity, message: params[5], status: 'active', created_at: 'now' }] };
    }
    if (sql.includes('FROM patients')) return { rows: overrides?.patients ?? [{ id: 'p1', conditions: '' }] };
    if (sql.includes('FROM vitals'))    return { rows: overrides?.vitals ?? [] };
    if (sql.includes('FROM prescription_items')) return { rows: overrides?.meds ?? [] };
    if (sql.includes('FROM patient_allergies'))  return { rows: overrides?.allergies ?? [] };
    if (sql.includes('FROM lab_orders')) return { rows: overrides?.labOrders ?? [] };
    if (sql.includes('FROM cds_alerts')) return { rows: overrides?.existing ?? [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  uuidV4.mockReturnValue('alert-id');
  poolConnect.mockResolvedValue(client);
});

describe('cds.service — getInsights', () => {
  it('rejects an invalid patient UUID', async () => {
    await expect(cds.getInsights('not-a-uuid', 'd1')).rejects.toMatchObject({
      message: 'Invalid patient ID format', status: 400,
    });
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it('throws 404 when the patient is not found', async () => {
    setupQueries({ patients: [] });
    await expect(cds.getInsights('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'd1'))
      .rejects.toMatchObject({ message: 'Patient not found', status: 404 });
    expect(client.release).toHaveBeenCalled();
  });

  it('runs all checks, persists and returns sorted alerts', async () => {
    setupQueries({
      patients: [{ id: 'p1', conditions: 'diabetes, hypertension' }],
      vitals: [
        {
          temperature: 39, heart_rate: 110, respiratory_rate: 24,
          wbc_count: 15000, systolic_bp: 130,
        },
        { systolic_bp: 200 },
      ],
      meds: [
        { medication_name: 'Penicillin V' },
        { medication_name: 'Warfarin' },
        { medication_name: 'Aspirin' },
      ],
      allergies: [{ allergen: 'penicillin' }],
      labOrders: [
        { test_name: 'CBC', ordered_at: new Date(Date.now() - 3600000).toISOString() },
        { test_name: 'CBC', ordered_at: new Date(Date.now() - 7200000).toISOString() },
      ],
      existing: [],
    });

    const res = await cds.getInsights('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'd1');

    // 6 raw alerts: sepsis, allergy, interaction, duplicate, 2 guidelines
    expect(clientQuery.mock.calls[0][0]).toContain('FROM patients');
    expect(uuidV4).toHaveBeenCalled();
    expect(res.patientId).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(res.alerts).toHaveLength(6);

    const sev = res.alerts.map(a => a.severity);
    expect(sev).toEqual(['high', 'high', 'high', 'medium', 'low', 'low']);
    expect(res.summary).toEqual({ total: 6, high: 3, medium: 1, low: 2 });

    const messages = res.alerts.map(a => a.message).join(' | ');
    expect(messages).toContain('Sepsis screening');
    expect(messages).toContain('Allergy alert');
    expect(messages).toContain('Warfarin + Aspirin');
    expect(messages).toContain('Duplicate order');
    expect(messages).toContain('no HbA1c on record');
    expect(messages).toContain('no recent BP monitoring order');
  });

  it('dedupes against existing alerts and skips ON CONFLICT inserts', async () => {
    setupQueries({
      patients: [{ id: 'p1', conditions: '' }],
      vitals: [{ temperature_c: 37 }], // < 2 rows → no sepsis check
      labOrders: [
        { test_name: 'Old', ordered_at: new Date(Date.now() - 48 * 3600000).toISOString() },
      ],
      existing: [{ id: 'e1', type: 'GENERAL', severity: 'high', message: 'm', status: 'active', created_at: 'now' }],
      insert: [], // all inserts hit ON CONFLICT → nothing persisted
    });

    const res = await cds.getInsights('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'd1');

    // existing alert message 'm' is in the returned alerts
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0].id).toBe('e1');
    expect(res.alerts[0].status).toBe('active');
    expect(res.summary).toEqual({ total: 1, high: 1, medium: 0, low: 0 });
  });

  it('returns no alerts when the patient has no triggers', async () => {
    setupQueries({
      patients: [{ id: 'p1', conditions: 'none' }],
      vitals: [],
      meds: [],
      allergies: [],
      labOrders: [],
      existing: [],
    });

    const res = await cds.getInsights('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'd1');
    expect(res.alerts).toEqual([]);
    expect(res.summary).toEqual({ total: 0, high: 0, medium: 0, low: 0 });
  });
});

describe('cds.service — acknowledgeAlert / dismissAlert', () => {
  it('acknowledges an alert', async () => {
    q.mockResolvedValue({ rows: [] });
    await cds.acknowledgeAlert('a1', 'u1', 'Reviewed');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("SET status = 'acknowledged'");
    expect(params).toEqual(['a1', 'u1', 'Reviewed']);
  });

  it('acknowledges with a null reason', async () => {
    q.mockResolvedValue({ rows: [] });
    await cds.acknowledgeAlert('a1', 'u1');
    expect(q.mock.calls[0][1]).toEqual(['a1', 'u1', null]);
  });

  it('dismisses an alert', async () => {
    q.mockResolvedValue({ rows: [] });
    await cds.dismissAlert('a1', 'u1', 'False alarm');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("SET status = 'dismissed'");
    expect(params).toEqual(['a1', 'u1', 'False alarm']);
  });
});
