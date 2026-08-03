// Coverage for the vitals module: record flow with BMI + alert thresholds,
// PATIENT ownership scoping on history, and daily counts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, auditMock, notifAddMock, loggerError,
} = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  notifAddMock: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/jobs/queue.js', () => ({
  notificationQueue: { add: notifAddMock },
  emailQueue       : { add: vi.fn() },
  reportQueue      : { add: vi.fn() },
  closeQueues      : vi.fn(),
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as vitals from '../src/modules/vitals/vitals.service.js';

const patientRow = { id: 'p1', first_name: 'John', last_name: 'Doe' };

function vitalRow(overrides = {}) {
  return {
    id: 'v1', patient_id: 'p1', recorded_by: 'n1',
    temperature_c: 37, pulse_bpm: 80, spo2_pct: 98, bmi: 22.2,
    recorded_at: '2026-01-02T10:00:00Z', ...overrides,
  };
}

// Fire-and-forget alerts run on a microtask chain; flush a few macrotask turns.
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  notifAddMock.mockImplementation(async () => {});
});

// ---------------------------------------------------------------------------
// recordVitals
// ---------------------------------------------------------------------------
describe('vitals.service — recordVitals', () => {
  it('throws 404 when the patient does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(vitals.recordVitals({ patientId: 'nope' }, 'n1', 'ip', 'ua'))
      .rejects.toMatchObject({ status: 404 });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('resolves the latest medical record when none is provided', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [{ id: 'mr-latest' }] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    const res = await vitals.recordVitals({ patientId: 'p1', spo2: 98 }, 'n1', '1.1.1.1', 'ua');
    expect(res.id).toBe('v1');
    // second call was the medical-record resolution
    expect(q.mock.calls[1][0]).toContain('FROM medical_records');
    const insert = q.mock.calls[2];
    expect(insert[1][0]).toBe('mr-latest');
  });

  it('uses the provided medical record id without resolving', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    await vitals.recordVitals({ patientId: 'p1', medicalRecordId: 'mr1', spo2: 98 }, 'n1', 'ip', 'ua');
    expect(q).toHaveBeenCalledTimes(2);
    expect(q.mock.calls[1][1][0]).toBe('mr1');
  });

  it('computes BMI from the latest recorded height and the new weight', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [{ id: 'mr1' }] });
    q.mockResolvedValueOnce({ rows: [{ height_cm: 180 }] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    await vitals.recordVitals({ patientId: 'p1', weightKg: 72, spo2: 98 }, 'n1', 'ip', 'ua');
    const insert = q.mock.calls[3];
    expect(insert[1][10]).toBe(22.2); // 72 / (1.8^2) = 22.22… → 22.2
  });

  it('inserts nulls for missing readings and defaults to null BMI without weight', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [{ id: 'mr1' }] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    await vitals.recordVitals({ patientId: 'p1', medicalRecordId: 'mr1', spo2: 98 }, 'n1', 'ip', 'ua');
    const insert = q.mock.calls[1];
    expect(insert[1]).toEqual([
      'mr1', 'p1', 'n1',
      null, null, null, null,
      98, null, null, null,
      null, null,
    ]);
  });

  it('audits the creation with the original data', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    await vitals.recordVitals({ patientId: 'p1', medicalRecordId: 'mr1', temperature: 37 }, 'n1', '1.1.1.1', 'ua');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'n1', action: 'CREATE', entity: 'vitals',
      nextData: expect.objectContaining({ patientId: 'p1', temperature: 37 }),
    }));
  });

  it('fires no alerts for normal vitals', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });

    await vitals.recordVitals({
      patientId: 'p1', medicalRecordId: 'mr1',
      temperature: 37, pulseBpm: 80, bpSystolic: 120, spo2: 98, bloodGlucose: 5.5,
    }, 'n1', 'ip', 'ua');
    await flush();
    expect(notifAddMock).not.toHaveBeenCalled();
  });

  it('alerts the assigned doctors and broadcasts to nurses on critical SpO2', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });
    q.mockResolvedValueOnce({ rows: [
      { id: 'doc1', first_name: 'A', last_name: 'B' },
      { id: 'doc2', first_name: 'C', last_name: 'D' },
    ] });

    await vitals.recordVitals({ patientId: 'p1', medicalRecordId: 'mr1', spo2: 90 }, 'n1', 'ip', 'ua');
    await flush();

    expect(notifAddMock).toHaveBeenCalledTimes(3);
    expect(notifAddMock.mock.calls[0][1]).toMatchObject({ userId: 'doc1', type: 'ALERT', entityId: 'p1' });
    expect(notifAddMock.mock.calls[1][1]).toMatchObject({ userId: 'doc2' });
    expect(notifAddMock.mock.calls[2][1]).toMatchObject({ targetRole: 'NURSE', type: 'ALERT' });
    expect(notifAddMock.mock.calls[0][1].body).toContain('Critical SpO2: 90%');
  });

  it('joins multiple triggered thresholds into a single alert body', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });
    q.mockResolvedValueOnce({ rows: [{ id: 'doc1', first_name: 'A', last_name: 'B' }] });

    await vitals.recordVitals({
      patientId: 'p1', medicalRecordId: 'mr1', spo2: 90, pulseBpm: 145, temperature: 39,
    }, 'n1', 'ip', 'ua');
    await flush();

    const body = notifAddMock.mock.calls[0][1].body;
    expect(body).toContain('Critical SpO2: 90%');
    expect(body).toContain('Abnormal pulse: 145 bpm');
    expect(body).toContain('High temperature: 39');
    expect(body.split(' | ')).toHaveLength(3);
  });

  it('logs an error when the alert trigger fails', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow] });
    q.mockResolvedValueOnce({ rows: [vitalRow()] });
    q.mockRejectedValueOnce(new Error('db down')); // doctors lookup fails

    await vitals.recordVitals({ patientId: 'p1', medicalRecordId: 'mr1', spo2: 90 }, 'n1', 'ip', 'ua');
    await flush();
    expect(loggerError).toHaveBeenCalledWith('[vitals] Alert trigger failed', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// countVitalsToday
// ---------------------------------------------------------------------------
describe('vitals.service — countVitalsToday', () => {
  it('counts all vitals for today by default', async () => {
    q.mockResolvedValueOnce({ rows: [{ count: '4' }] });
    expect(await vitals.countVitalsToday({})).toBe(4);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('DATE(v.recorded_at) = $1');
    expect(params).toHaveLength(1);
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses the provided date and scopes by nurse', async () => {
    q.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    expect(await vitals.countVitalsToday({ nurseId: 'n1', date: '2026-01-02' })).toBe(2);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('AND v.recorded_by = $2');
    expect(params).toEqual(['2026-01-02', 'n1']);
  });

  it('returns 0 when there are no rows', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await vitals.countVitalsToday({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getVitalsHistory — PATIENT self-scoping
// ---------------------------------------------------------------------------
describe('vitals.service — getVitalsHistory', () => {
  it('FORBIDDEN when a patient requests another patient’s vitals', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await vitals.getVitalsHistory('p-other', { id: 'u-me', roles: ['PATIENT'] }, {});
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a patient to read their own vitals', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    q.mockResolvedValueOnce({ rows: [vitalRow({ total_count: '1' })] });
    const res = await vitals.getVitalsHistory('p1', { id: 'u-pat', roles: ['PATIENT'] }, { page: 1, limit: 20, days: 7 });
    expect(res.vitals).toHaveLength(1);
    expect(res.vitals[0]).not.toHaveProperty('total_count');
    expect(res.total).toBe(1);
    expect(q.mock.calls[1][1]).toEqual(['p1', 7, 20, 0]);
  });

  it('skips the ownership check for staff and applies defaults', async () => {
    q.mockResolvedValueOnce({ rows: [vitalRow({ total_count: '1' })] });
    const res = await vitals.getVitalsHistory('p1', { id: 'u-doc', roles: ['DOCTOR'] }, {});
    expect(res).toMatchObject({ page: 1, limit: 50, days: 7, total: 1 });
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][1]).toEqual(['p1', 7, 50, 0]);
  });

  it('paginates with explicit page/limit/days', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await vitals.getVitalsHistory('p1', { id: 'u-doc', roles: ['DOCTOR'] }, { page: 3, limit: 25, days: 30 });
    expect(res.page).toBe(3);
    expect(res.total).toBe(0);
    expect(q.mock.calls[0][1]).toEqual(['p1', 30, 25, 50]);
  });
});
