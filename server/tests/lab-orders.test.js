// Coverage for the lab-orders module: create/update/read flows with
// encrypted results, lab-tech + ordering-doctor notifications, and
// decryption of patient result history.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, pgEncryptMock, pgDecryptMock, createNotifMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  pgEncryptMock: vi.fn(),
  pgDecryptMock: vi.fn(),
  createNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt      : pgEncryptMock,
  pgDecrypt      : pgDecryptMock,
  pgEncryptFields: vi.fn(),
  pgDecryptFields: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : {
    LAB_ORDER_CREATED   : 'LAB_ORDER',
    LAB_RESULT_UPLOADED : 'LAB_RESULT',
  },
}));

import * as lab from '../src/modules/lab-orders/lab-orders.service.js';

function labOrderRow(overrides = {}) {
  return {
    id: 'lo1', patient_id: 'p1', ordered_by: 'doc1', medical_record_id: 'mr1',
    test_name: 'CBC', test_code: 'CBC', priority: 'ROUTINE', status: 'PENDING',
    notes: null, ordered_at: '2026-01-02T10:00:00Z', total_count: '1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  pgEncryptMock.mockImplementation(async (t) => `enc(${t})`);
  pgDecryptMock.mockImplementation(async (t) =>
    typeof t === 'string' && t.startsWith('enc(') ? t.slice(4, -1) : t
  );
  createNotifMock.mockImplementation(async () => ({ id: 'n1' }));
});

// ---------------------------------------------------------------------------
// listLabOrders — filters + pagination
// ---------------------------------------------------------------------------
describe('lab-orders.service — listLabOrders', () => {
  it('lists with no filters using default pagination', async () => {
    q.mockResolvedValueOnce({ rows: [labOrderRow()] });
    const res = await lab.listLabOrders({ page: 1, limit: 20 });
    expect(res.labOrders).toHaveLength(1);
    expect(res.labOrders[0]).not.toHaveProperty('total_count');
    expect(res.total).toBe(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE lo.deleted_at IS NULL');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([20, 0]);
  });

  it('builds WHERE clauses for status/priority/date/patientId', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await lab.listLabOrders({
      status: 'PENDING', priority: 'STAT', date: '2026-01-02', patientId: 'p1',
      page: 2, limit: 10,
    });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('lo.status = $1');
    expect(sql).toContain('lo.priority = $2');
    expect(sql).toContain('DATE(lo.ordered_at) = $3');
    expect(sql).toContain('lo.patient_id = $4');
    expect(sql).toContain('LIMIT $5 OFFSET $6');
    expect(params).toEqual(['PENDING', 'STAT', '2026-01-02', 'p1', 10, 10]);
  });

  it('orders by priority rank then time', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await lab.listLabOrders({ page: 1, limit: 10 });
    const sql = q.mock.calls[0][0];
    expect(sql).toMatch(/WHEN 'STAT'\s+THEN 1/);
    expect(sql).toMatch(/WHEN 'URGENT'\s+THEN 2/);
    expect(sql).toMatch(/WHEN 'ROUTINE'\s+THEN 3/);
  });
});

// ---------------------------------------------------------------------------
// createLabOrder — medical record ensure + lab-tech notifications
// ---------------------------------------------------------------------------
describe('lab-orders.service — createLabOrder', () => {
  const data = { patientId: 'p1', testName: 'CBC', testCode: 'CBC', priority: 'URGENT', notes: 'fast' };

  it('creates a medical record if none exists, inserts the order, and notifies lab techs', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'mr-new' }] }); // medical record insert/no-op
    q.mockResolvedValueOnce({ rows: [{ id: 'mr-new' }] }); // latest record lookup
    q.mockResolvedValueOnce({ rows: [labOrderRow()] });    // order insert
    q.mockResolvedValueOnce({ rows: [{ first_name: 'John', last_name: 'Doe' }] }); // patient
    q.mockResolvedValueOnce({ rows: [{ id: 'tech1' }, { id: 'tech2' }] });         // lab techs

    const io = { of: vi.fn() };
    const res = await lab.createLabOrder(data, 'doc1', io);
    expect(res.id).toBe('lo1');

    const orderInsert = q.mock.calls[2];
    expect(orderInsert[0]).toContain('INSERT INTO lab_orders');
    expect(orderInsert[1]).toEqual(['mr-new', 'p1', 'doc1', 'CBC', 'CBC', 'URGENT', 'fast']);

    expect(createNotifMock).toHaveBeenCalledTimes(2);
    expect(createNotifMock.mock.calls[0]).toEqual([
      'tech1', 'LAB_ORDER', 'New Lab Test Ordered',
      'URGENT — CBC ordered for patient John Doe.',
      { entityType: 'LAB_ORDER', entityId: 'lo1' }, io,
    ]);
    expect(createNotifMock.mock.calls[1][0]).toBe('tech2');
  });

  it('applies defaults for priority, code and notes', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [{ id: 'mr1' }] });
    q.mockResolvedValueOnce({ rows: [labOrderRow()] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'A', last_name: 'B' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'tech1' }] });

    await lab.createLabOrder({ patientId: 'p1', testName: 'X' }, 'doc1');
    const orderInsert = q.mock.calls[2];
    expect(orderInsert[1]).toEqual(['mr1', 'p1', 'doc1', 'X', null, 'ROUTINE', null]);
  });

  it('throws 500 when no medical record can be resolved', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [] });
    await expect(lab.createLabOrder(data, 'doc1')).rejects.toMatchObject({ status: 500 });
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('sends no notifications when there are no lab techs', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [{ id: 'mr1' }] });
    q.mockResolvedValueOnce({ rows: [labOrderRow()] });
    q.mockResolvedValueOnce({ rows: [{ first_name: 'A', last_name: 'B' }] });
    q.mockResolvedValueOnce({ rows: [] });

    const res = await lab.createLabOrder(data, 'doc1');
    expect(res.id).toBe('lo1');
    expect(createNotifMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateLabOrder
// ---------------------------------------------------------------------------
describe('lab-orders.service — updateLabOrder', () => {
  it('returns null when no fields are provided', async () => {
    expect(await lab.updateLabOrder('lo1', {})).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });

  it('updates only provided fields in order', async () => {
    q.mockResolvedValueOnce({ rows: [labOrderRow({ status: 'IN_PROGRESS', assigned_to: 'tech1' })] });
    const res = await lab.updateLabOrder('lo1', { status: 'IN_PROGRESS', assignedTo: 'tech1' });
    expect(res.status).toBe('IN_PROGRESS');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('status = $1, assigned_to = $2');
    expect(sql).toContain('WHERE id = $3');
    expect(params).toEqual(['IN_PROGRESS', 'tech1', 'lo1']);
  });

  it('returns null when no row matched', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await lab.updateLabOrder('lo1', { notes: 'x' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createLabResult — encrypted result + ordering-doctor notification
// ---------------------------------------------------------------------------
describe('lab-orders.service — createLabResult', () => {
  const data = {
    labOrderId: 'lo1', resultData: 'WBC 11.2', interpretation: 'Elevated', isAbnormal: true, referenceRange: '4-10',
  };

  it('encrypts the result, resolves the patient, inserts, and notifies the ordering doctor', async () => {
    q.mockResolvedValueOnce({ rows: [{ patient_id: 'p1' }] });  // getLabOrderPatient
    q.mockResolvedValueOnce({ rows: [{ id: 'lr1' }] });         // result insert
    q.mockResolvedValueOnce({ rows: [{ ordered_by: 'doc1', test_name: 'CBC', first_name: 'John', last_name: 'Doe' }] });

    const io = { of: vi.fn() };
    const res = await lab.createLabResult(data, 'tech1', io);
    expect(res.id).toBe('lr1');

    expect(pgEncryptMock).toHaveBeenCalledWith('WBC 11.2');
    expect(pgEncryptMock).toHaveBeenCalledWith('Elevated');

    const insert = q.mock.calls[1];
    expect(insert[1]).toEqual(['lo1', 'p1', 'tech1', 'enc(WBC 11.2)', 'enc(Elevated)', true, '4-10']);

    expect(createNotifMock).toHaveBeenCalledTimes(1);
    expect(createNotifMock.mock.calls[0][0]).toBe('doc1');
    expect(createNotifMock.mock.calls[0][1]).toBe('LAB_RESULT');
    expect(createNotifMock.mock.calls[0][3]).toBe('Result for CBC — John Doe is now available.');
    expect(createNotifMock.mock.calls[0][5]).toBe(io);
  });

  it('uses placeholder text when the result is empty', async () => {
    q.mockResolvedValueOnce({ rows: [{ patient_id: 'p1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'lr2' }] });
    q.mockResolvedValueOnce({ rows: [{ ordered_by: 'doc1', test_name: 'CBC', first_name: 'J', last_name: 'D' }] });

    await lab.createLabResult({ labOrderId: 'lo1' }, 'tech1');
    expect(pgEncryptMock).toHaveBeenCalledWith('See attached file');
    expect(pgEncryptMock).toHaveBeenCalledWith('');
    expect(q.mock.calls[1][1][4]).toBe('enc()');
    expect(q.mock.calls[1][1][5]).toBe(false); // isAbnormal default
  });

  it('skips the doctor notification when the order row is missing', async () => {
    q.mockResolvedValueOnce({ rows: [{ patient_id: 'p1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'lr3' }] });
    q.mockResolvedValueOnce({ rows: [] });

    const res = await lab.createLabResult({ labOrderId: 'lo1', resultData: 'x' }, 'tech1');
    expect(res.id).toBe('lr3');
    expect(createNotifMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getLabOrderById / getLabResultById
// ---------------------------------------------------------------------------
describe('lab-orders.service — lookups', () => {
  it('getLabOrderById returns the row or null', async () => {
    q.mockResolvedValueOnce({ rows: [labOrderRow()] });
    expect(await lab.getLabOrderById('lo1')).toMatchObject({ id: 'lo1' });

    q.mockResolvedValueOnce({ rows: [] });
    expect(await lab.getLabOrderById('lo1')).toBeNull();
  });

  it('getLabResultById returns the row or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'lr1', test_name: 'CBC' }] });
    expect(await lab.getLabResultById('lr1')).toEqual({ id: 'lr1', test_name: 'CBC' });

    q.mockResolvedValueOnce({ rows: [] });
    expect(await lab.getLabResultById('lr1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getPatientLabResults — decryption
// ---------------------------------------------------------------------------
describe('lab-orders.service — getPatientLabResults', () => {
  it('decrypts results and strips the total column', async () => {
    q.mockResolvedValueOnce({ rows: [
      { id: 'lr1', result_data: 'enc(WBC 11.2)', interpretation: 'enc(Elevated)', total_count: '1' },
    ] });
    const res = await lab.getPatientLabResults('p1', { page: 1, limit: 10 });
    expect(res.total).toBe(1);
    expect(res.results).toEqual([
      { id: 'lr1', result_data: 'WBC 11.2', interpretation: 'Elevated' },
    ]);
    expect(q.mock.calls[0][1]).toEqual(['p1', 10, 0]);
  });

  it('falls back to placeholders when decryption fails', async () => {
    q.mockResolvedValueOnce({ rows: [
      { id: 'lr1', result_data: 'garbage', interpretation: 'garbage', total_count: '1' },
    ] });
    pgDecryptMock.mockRejectedValueOnce(new Error('bad key'));
    const res = await lab.getPatientLabResults('p1', { page: 1, limit: 10 });
    expect(res.results[0]).toMatchObject({ result_data: '[Encrypted]', interpretation: '[Encrypted]' });
  });
});
