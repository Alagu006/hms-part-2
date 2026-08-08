// Coverage for the discharge module: creating discharge summaries with
// patient lookup, in-app notification, email delivery, and listing summaries.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, auditMock, createNotifMock, sendNotifMock } = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
  sendNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt: async (v) => (v == null ? null : `enc(${v})`),
  pgDecrypt: async (v) => (v == null ? null : (typeof v === 'string' && v.startsWith('enc(') ? v.slice(4, -1) : v)),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog: auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { BROADCAST: 'BROADCAST' },
}));

vi.mock('../src/shared/services/email.service.js', () => ({
  sendNotification: sendNotifMock,
}));

import * as discharge from '../src/modules/discharge/discharge.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  process.env.PG_CRYPTO_KEY = 'test-key';
  process.env.HOSPITAL_NAME = 'Test Hospital';
});

describe('discharge.service — createDischargeSummary', () => {
  it('throws 404 when the patient is not found', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(
      discharge.createDischargeSummary({ patientId: 'p1' }, 'd1', null, '1.2.3.4')
    ).rejects.toMatchObject({ message: 'Patient not found', status: 404 });
    expect(q.mock.calls[0][0]).toContain('pgp_sym_decrypt');
    expect(q.mock.calls[0][1]).toEqual(['p1', 'test-key']);
  });

  it('creates a summary and sends notification + email', async () => {
    const patient = {
      id: 'p1', first_name: 'Jane', last_name: 'Doe', user_id: 'u9',
      email: 'jane@example.com',
    };
    const summary = {
      id: 's1', discharge_date: '2026-08-01', final_diagnosis: 'Pneumonia',
    };
    q.mockResolvedValueOnce({ rows: [patient] })
      .mockResolvedValueOnce({ rows: [summary] });

    const input = {
      patientId: 'p1', admissionDate: '2026-07-25',
      dischargeDate: '2026-08-01', diagnosis: 'Pneumonia',
      treatmentSummary: 'Antibiotics', dischargeMedications: 'Amoxicillin',
      followUpDate: '2026-09-01', instructions: 'Rest and hydrate',
    };
    const io = null;
    const res = await discharge.createDischargeSummary(input, 'd1', io, '1.2.3.4');

    expect(q.mock.calls[1][0]).toContain('INSERT INTO discharge_summaries');
    expect(q.mock.calls[1][0]).toContain("'REGULAR'");
    expect(q.mock.calls[1][0]).toContain("'STABLE'");
    expect(q.mock.calls[1][1]).toEqual([
      'p1', 'd1', '2026-08-01', 'enc(Pneumonia)', 'enc(Antibiotics)', 'enc(Amoxicillin)',
      '2026-09-01', 'enc(Rest and hydrate)',
    ]);
    expect(res).toMatchObject({ id: 's1', discharge_date: '2026-08-01', final_diagnosis: 'Pneumonia' });

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'd1', action: 'CREATE', entity: 'discharge_summaries',
      entityId: 's1', ip: '1.2.3.4',
    }));

    expect(createNotifMock).toHaveBeenCalledWith(
      'u9', 'SYSTEM', 'Discharge Summary Ready',
      expect.stringContaining('Follow-up: 2026-09-01'),
      { entityType: 'discharge_summaries', entityId: 's1' },
      io
    );

    expect(sendNotifMock).toHaveBeenCalledWith(
      'jane@example.com',
      'Discharge Summary — Test Hospital',
      expect.stringContaining('Test Hospital')
    );
    const html = sendNotifMock.mock.calls[0][2];
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Pneumonia');
    expect(html).toContain('Rest and hydrate');
  });

  it('skips notification and email when the patient has no portal account/email', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'p1', first_name: 'A', last_name: 'B', user_id: null, email: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', discharge_date: '2026-08-01', final_diagnosis: 'X' }] });

    const res = await discharge.createDischargeSummary(
      { patientId: 'p1', dischargeDate: '2026-08-01', diagnosis: 'X' }, 'd1', null, 'ip'
    );
    expect(res.id).toBe('s1');
    expect(createNotifMock).not.toHaveBeenCalled();
    expect(sendNotifMock).not.toHaveBeenCalled();
  });
});

describe('discharge.service — getPatientDischargeSummaries', () => {
  it('joins doctor name and orders by discharge date', async () => {
    q.mockResolvedValue({ rows: [{ id: 's1', doctor_first: 'Sam' }] });
    const res = await discharge.getPatientDischargeSummaries('p1');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('JOIN users u ON u.id = ds.discharged_by');
    expect(sql).toContain('ORDER BY ds.discharge_date DESC');
    expect(params).toEqual(['p1']);
    expect(res).toEqual([
      { id: 's1', doctor_first: 'Sam', final_diagnosis: null, treatment_summary: null, follow_up_notes: null, medications_on_discharge: null },
    ]);
  });
});
