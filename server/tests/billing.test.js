// Coverage for billing: ownership checks (shared middleware) + billing.service flows.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const { q, pool: poolMock, client, auditMock, notifMock } = vi.hoisted(() => {
  const q = vi.fn();
  const client = { query: vi.fn(), release: vi.fn() };
  const pool = { query: q, connect: vi.fn(async () => client) };
  return { q, pool, client, auditMock: vi.fn(async () => {}), notifMock: vi.fn(async () => {}) };
});

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : poolMock,
  withTransaction: vi.fn(async (fn) => fn(poolMock)),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: notifMock,
  NotificationType  : { BILL_GENERATED: 'SYSTEM' },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkOwnership } from '../src/shared/middleware/ownership.js';
import * as billing from '../src/modules/billing/billing.service.js';
import { pool } from '../src/shared/db/pool.js';
import { auditLog } from '../src/shared/middleware/audit.js';
import { createNotification } from '../src/shared/services/notification.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, user: { id: 'u-owner', roles: [] }, ...overrides };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

// ---------------------------------------------------------------------------
// Ownership middleware (security prompt) — patients can only touch their own
// ---------------------------------------------------------------------------
describe('checkOwnership middleware', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets ADMIN/SUPER_ADMIN through without an ownership query', async () => {
    const mw = checkOwnership('bill');
    const res = makeRes();
    const nxt = vi.fn();

    await mw(makeReq({ user: { id: 'u-admin', roles: ['ADMIN'] } }), res, nxt);
    expect(nxt).toHaveBeenCalledOnce();
    expect(q).not.toHaveBeenCalled();
  });

  it('allows a staff clinician who is on the patient\u2019s care team', async () => {
    q.mockResolvedValueOnce({ rows: [{ patient_id: 'pat-1', user_id: 'u-owner' }] });
    q.mockResolvedValueOnce({ rows: [{ member: 1 }] });
    const mw = checkOwnership('bill');
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'u-doctor', roles: ['DOCTOR'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(q).toHaveBeenNthCalledWith(1, expect.stringContaining('bills'), ['bill-1']);
    expect(q).toHaveBeenNthCalledWith(2, expect.stringContaining('care_team'), ['pat-1', 'u-doctor']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('denies 403 to a staff clinician who is NOT on the patient\u2019s care team', async () => {
    q.mockResolvedValueOnce({ rows: [{ patient_id: 'pat-1', user_id: 'u-owner' }] });
    q.mockResolvedValueOnce({ rows: [] });
    const mw = checkOwnership('bill');
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'u-other-doc', roles: ['DOCTOR'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a PATIENT to access their own bill', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-owner' }] });
    const mw = checkOwnership('bill');
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(q).toHaveBeenCalledWith(expect.stringContaining('bills'), ['bill-1']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 for a PATIENT requesting someone else\u2019s bill', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-other' }] });
    const mw = checkOwnership('bill');
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the resource does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const mw = checkOwnership('prescription');
    const req = makeReq({ params: { id: 'rx-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('checks ownership through the appointments → patients join', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-owner' }] });
    const mw = checkOwnership('appointment');
    const req = makeReq({ params: { id: 'appt-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(q).toHaveBeenCalledWith(expect.stringContaining('appointments'), ['appt-1']);
    expect(next).toHaveBeenCalledOnce();

    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-other' }] });
    await mw(req, res, next);
    expect(res._status).toBe(403);
  });

  it('returns 403 for a PATIENT on another patient\u2019s prescription', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-diff' }] });
    const mw = checkOwnership('prescription');
    const req = makeReq({ params: { id: 'rx-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(res._status).toBe(403);
  });

  it('uses the :patientId param for patient-type resources', async () => {
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-owner' }] });
    const mw = checkOwnership('patient', 'patientId');
    const req = makeReq({ params: { patientId: 'pat-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(q).toHaveBeenCalledWith(expect.stringContaining('patients'), ['pat-1']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('forwards DB errors to next(err)', async () => {
    q.mockRejectedValueOnce(new Error('db down'));
    const mw = checkOwnership('bill');
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'u-owner', roles: ['PATIENT'] } });
    const res = makeRes();

    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toBe('db down');
  });

  it('throws at factory time for unknown entity types', () => {
    expect(() => checkOwnership('garbage')).toThrow(/Unknown entity type/);
  });

  // Property: for ANY other patient_id, a patient is always denied
  it('Property — denies every foreign bill (5 random bills)', async () => {
    const mw = checkOwnership('bill');
    for (let i = 0; i < 5; i++) {
      q.mockResolvedValueOnce({ rows: [{ user_id: `u-other-${i}` }] });
      const req = makeReq({ params: { id: `bill-${i}` }, user: { id: 'u-owner', roles: ['PATIENT'] } });
      const res = makeRes();
      const nxt = vi.fn();
      await mw(req, res, nxt);
      expect(res._status).toBe(403);
      expect(nxt).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// billing.service.js
// ---------------------------------------------------------------------------
describe('billing.service — createBill totals & persistence', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('computes subtotal, tax and net correctly and persists items', async () => {
    const billRow = { id: 'bill-1', net_amount: 198, bill_number: 'BILL-X' };
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO bills')) return { rows: [billRow] };
      if (sql.startsWith('INSERT INTO bill_items')) return { rows: [{ id: 'it' }] };
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-patient' }] });

    const bill = await billing.createBill({
      patientId : 'pat-1',
      items     : [{ description: 'Consult', category: 'CONSULTATION', unitPrice: 100, quantity: 2, discount: 10 }],
      taxPercent: 10,
      notes     : 'n',
      issuedBy  : 'u-admin',
    });

    expect(bill).toEqual(billRow);
    // subtotal = 200 - 10% = 180, tax = 18, net = 198
    const billInsert = client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO bills'));
    expect(billInsert[0]).toContain("'ISSUED'");
    expect(billInsert[1]).toEqual([
      'pat-1',
      expect.stringMatching(/^BILL-[A-Z0-9]+-[A-F0-9]+$/),
      180, 18, 198, 'n', 'u-admin', null,
    ]);
    // two line inserts: bill + item
    const itemInsert = client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO bill_items'));
    expect(itemInsert[1]).toEqual(['bill-1', 'Consult', 'CONSULTATION', 2, 100, 10, 180]);
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(auditLog).toHaveBeenCalled();
    // flush the fire-and-forget notification so it cannot bleed into the next test
    await new Promise((r) => setImmediate(r));
  });

  it('rolls back and rethrows on failure', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql === 'BEGIN') return { rows: [] };
      throw new Error('constraint violation');
    });
    await expect(billing.createBill({ patientId: 'p', items: [{ unitPrice: 1, quantity: 1 }], taxPercent: 0, issuedBy: 'u' }))
      .rejects.toThrow('constraint violation');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('notifies the patient after bill creation (fire-and-forget)', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO bills')) return { rows: [{ id: 'b9', net_amount: 10, bill_number: 'B9' }] };
      if (sql.startsWith('INSERT INTO bill_items')) return { rows: [{ id: 'i' }] };
      return { rows: [] };
    });
    q.mockResolvedValueOnce({ rows: [{ user_id: 'u-patient' }] });

    await billing.createBill({ patientId: 'pat-9', items: [{ description: 'X', category: 'C', unitPrice: 10, quantity: 1 }], taxPercent: 0, issuedBy: 'u' });
    await new Promise((r) => setImmediate(r));

    expect(createNotification).toHaveBeenCalledWith(
      'u-patient', 'SYSTEM', 'New bill generated',
      expect.stringMatching(/^Bill BILL-[A-Z0-9]+-[A-F0-9]+ for ₹10 has been issued/),
      expect.objectContaining({ entityType: 'BILL', entityId: 'b9' })
    );
  });
});

describe('billing.service — queries', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getPendingServices runs the four scoped queries for the patient', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'lo1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'pi1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'bed1' }] });

    const data = await billing.getPendingServices('pat-1');
    expect(data).toEqual({
      consultations: [{ id: 'a1' }],
      labOrders    : [{ id: 'lo1' }],
      prescriptions: [{ id: 'pi1' }],
      bedCharges   : [{ id: 'bed1' }],
    });
    expect(q).toHaveBeenCalledTimes(4);
    expect(q.mock.calls.every(([, params]) => params[0] === 'pat-1')).toBe(true);
  });

  it('getBillById returns the row or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1' }] });
    await expect(billing.getBillById('b1')).resolves.toEqual({ id: 'b1' });
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.getBillById('missing')).resolves.toBeNull();
  });

  it('getBillsByPatient returns the rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1' }] });
    await expect(billing.getBillsByPatient('pat-1')).resolves.toEqual([{ id: 'b1' }]);
    expect(q.mock.calls[0][1]).toEqual(['pat-1']);
  });

  it('listAllBills builds filters and pagination params', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', total_count: '7' }] });
    const res = await billing.listAllBills({ page: 2, limit: 10, status: 'ISSUED', patientId: 'pat-1' });
    expect(res).toMatchObject({ total: 7, page: 2, limit: 10 });
    expect(res.bills).toEqual([{ id: 'b1' }]);
    expect(q.mock.calls[0][1]).toEqual(['ISSUED', 'pat-1', 10, 10]);
    expect(q.mock.calls[0][0]).toContain('b.status = $1');
    expect(q.mock.calls[0][0]).toContain('b.patient_id = $2');
  });

  it('listAllBills with no filters uses only deleted_at guard', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await billing.listAllBills({});
    expect(res.total).toBe(0);
    expect(q.mock.calls[0][1]).toEqual([50, 0]);
  });

  it('getFinancialSummary returns defaults when empty', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [] });
    const res = await billing.getFinancialSummary({});
    expect(res.daily).toEqual({ collected: 0, refunded: 0, transactions: 0 });
    expect(res.outstanding).toEqual([]);
    expect(res.methodBreakdown).toEqual([]);
  });
});

describe('billing.service — payments & refunds', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function setupClient({ bill = null, paid = 0 }) {
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT * FROM bills')) return { rows: bill ? [bill] : [] };
      if (sql.includes('SUM(amount)')) return { rows: [{ paid }] };
      if (sql.startsWith('INSERT INTO payments')) return { rows: [{ id: 'pay-1', amount: 50 }] };
      if (sql.startsWith('UPDATE bills')) return { rows: [{ id: bill?.id }] };
      return { rows: [] };
    });
  }

  it('recordPayment → 404 when bill missing', async () => {
    setupClient({ bill: null });
    await expect(billing.recordPayment({ billId: 'x', amount: 10, paymentMethod: 'CASH', processedBy: 'u' }))
      .rejects.toMatchObject({ status: 404, message: 'Bill not found' });
  });

  it('recordPayment → 400 when bill already paid', async () => {
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'PAID' } });
    await expect(billing.recordPayment({ billId: 'b1', amount: 10, paymentMethod: 'CASH', processedBy: 'u' }))
      .rejects.toMatchObject({ status: 400, message: 'Bill already paid' });
  });

  it('recordPayment → 400 on overpayment', async () => {
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'ISSUED' }, paid: 0 });
    await expect(billing.recordPayment({ billId: 'b1', amount: 500, paymentMethod: 'CASH', processedBy: 'u' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('recordPayment full amount marks bill PAID', async () => {
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'ISSUED' }, paid: 0 });
    const res = await billing.recordPayment({ billId: 'b1', amount: 100, paymentMethod: 'CASH', processedBy: 'u' });
    expect(res.billStatus).toBe('PAID');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(auditLog).toHaveBeenCalledTimes(2);
  });

  it('recordPayment partial amount marks bill PARTIALLY_PAID', async () => {
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'ISSUED' }, paid: 0 });
    const res = await billing.recordPayment({ billId: 'b1', amount: 40, paymentMethod: 'CASH', processedBy: 'u' });
    expect(res.billStatus).toBe('PARTIALLY_PAID');
  });

  it('refundBill → 404 / 400 guards', async () => {
    setupClient({ bill: null });
    await expect(billing.refundBill({ billId: 'x', reason: 'r', processedBy: 'u' }))
      .rejects.toMatchObject({ status: 404 });
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'ISSUED' } });
    await expect(billing.refundBill({ billId: 'b1', reason: 'r', processedBy: 'u' }))
      .rejects.toMatchObject({ status: 400, message: 'Only paid bills can be refunded' });
  });

  it('refundBill succeeds for a paid bill', async () => {
    setupClient({ bill: { id: 'b1', patient_id: 'p', net_amount: 100, status: 'PAID' } });
    const res = await billing.refundBill({ billId: 'b1', reason: 'customer', processedBy: 'u' });
    expect(res).toEqual({ refunded: true, amount: 100 });
    const updates = client.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE bills'));
    expect(updates).toHaveLength(1);
  });
});

describe('billing.service — insurance', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('attachInsuranceClaim → 404 for inactive/missing policy', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.attachInsuranceClaim({ billId: 'b', insurancePolicyId: 'ip', claimAmount: 10, processedBy: 'u' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('attachInsuranceClaim → 404 when bill missing, success otherwise', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'ip', is_active: true }] });
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.attachInsuranceClaim({ billId: 'b', insurancePolicyId: 'ip', claimAmount: 10, processedBy: 'u' }))
      .rejects.toMatchObject({ status: 404, message: 'Bill not found' });

    q.mockResolvedValueOnce({ rows: [{ id: 'ip', is_active: true }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'b', insurance_policy_id: 'ip' }] });
    const res = await billing.attachInsuranceClaim({ billId: 'b', insurancePolicyId: 'ip', claimAmount: 10, claimReference: 'REF1', processedBy: 'u' });
    expect(res.insurance_policy_id).toBe('ip');
    expect(auditLog).toHaveBeenCalled();
  });

  it('createInsurance inserts and returns the policy', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'pol-1', provider_name: 'A' }] });
    const res = await billing.createInsurance({ patientId: 'p', provider: 'A', policyNumber: 'PN', coverageType: 'T', coverageAmount: 100, validFrom: '2026-01-01', validUntil: '2027-01-01' });
    expect(res.id).toBe('pol-1');
    expect(auditLog).toHaveBeenCalled();
  });

  it('getInsuranceByPatient scopes by patient', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'pol-1' }] });
    await expect(billing.getInsuranceByPatient('pat-1')).resolves.toEqual([{ id: 'pol-1' }]);
    expect(q.mock.calls[0][1]).toEqual(['pat-1']);
  });

  it('updateInsurance → 400 when no fields, 404 when not found, success otherwise', async () => {
    await expect(billing.updateInsurance('i1', {})).rejects.toMatchObject({ status: 400 });

    q.mockResolvedValueOnce({ rows: [] }); // prev
    q.mockResolvedValueOnce({ rows: [] }); // update -> none
    await expect(billing.updateInsurance('i1', { provider: 'B' })).rejects.toMatchObject({ status: 404, message: 'Insurance policy not found' });

    q.mockResolvedValueOnce({ rows: [{ id: 'i1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', provider_name: 'C' }] });
    const res = await billing.updateInsurance('i1', { provider: 'C' });
    expect(res.provider_name).toBe('C');
  });

  it('deleteInsurance → 404 when missing, success otherwise', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.deleteInsurance('i1')).rejects.toMatchObject({ status: 404 });

    q.mockResolvedValueOnce({ rows: [{ id: 'i1' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'i1' }] });
    await expect(billing.deleteInsurance('i1')).resolves.toEqual({ deleted: true });
  });
});

describe('billing.service — Razorpay', () => {
  const KEY_ID = 'rzp_test_123';
  const KEY_SECRET = 'secret-key';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'order_rzp', amount: 10000, currency: 'INR' }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  function payableBill(overrides = {}) {
    return {
      id: 'b1', bill_number: 'B-1', net_amount: 100, status: 'ISSUED', payments: [], ...overrides,
    };
  }

  it('createRazorpayOrder → 404 for missing bill', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.createRazorpayOrder('b1')).rejects.toMatchObject({ status: 404 });
  });

  it('createRazorpayOrder → 400 for unpayable status', async () => {
    q.mockResolvedValueOnce({ rows: [payableBill({ status: 'REFUNDED' })] });
    await expect(billing.createRazorpayOrder('b1')).rejects.toMatchObject({ status: 400 });
  });

  it('createRazorpayOrder → 400 when already fully paid', async () => {
    q.mockResolvedValueOnce({ rows: [payableBill({ payments: [{ status: 'COMPLETED', method: 'CASH', amount: '100' }] })] });
    await expect(billing.createRazorpayOrder('b1')).rejects.toMatchObject({ status: 400, message: 'Bill is already fully paid' });
  });

  it('createRazorpayOrder → 400 when outstanding is under ₹1.00', async () => {
    q.mockResolvedValueOnce({ rows: [payableBill({ net_amount: 0.5 })] });
    await expect(billing.createRazorpayOrder('b1')).rejects.toMatchObject({ status: 400 });
  });

  it('createRazorpayOrder issues an order and returns key/amount', async () => {
    q.mockResolvedValueOnce({ rows: [payableBill({ payments: [{ status: 'COMPLETED', method: 'CASH', amount: '0' }] })] });
    const res = await billing.createRazorpayOrder('b1');
    expect(res.orderId).toBe('order_rzp');
    expect(res.amount).toBe(10000);
    expect(res.currency).toBe('INR');
    expect(res.key).toBe(KEY_ID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/orders',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('createRazorpayOrder → 503 when credentials missing', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    q.mockResolvedValueOnce({ rows: [payableBill()] });
    await expect(billing.createRazorpayOrder('b1')).rejects.toMatchObject({ status: 503, message: 'Razorpay credentials not configured' });
  });

  it('verifyAndRecordRazorpayPayment rejects on signature mismatch', async () => {
    await expect(billing.verifyAndRecordRazorpayPayment({
      billId: 'b1', razorpayOrderId: 'o1', razorpayPaymentId: 'pay1', razorpaySignature: 'bogus',
    })).rejects.toMatchObject({ status: 400, message: /signature mismatch/ });
  });

  it('verifyAndRecordRazorpayPayment rejects a same-length but wrong signature', async () => {
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update('o1|pay1').digest('hex');
    await expect(billing.verifyAndRecordRazorpayPayment({
      billId: 'b1', razorpayOrderId: 'o1', razorpayPaymentId: 'pay1', razorpaySignature: wrongSig,
    })).rejects.toMatchObject({ status: 400, message: /signature mismatch/ });
  });

  it('verifyAndRecordRazorpayPayment rejects a differently-lengthed signature without throwing', async () => {
    await expect(billing.verifyAndRecordRazorpayPayment({
      billId: 'b1', razorpayOrderId: 'o1', razorpayPaymentId: 'pay1', razorpaySignature: 'short-sig',
    })).rejects.toMatchObject({ status: 400, message: /signature mismatch/ });
  });

  it('verifyAndRecordRazorpayPayment records the outstanding amount when signature matches', async () => {
    const expectedSig = crypto.createHmac('sha256', KEY_SECRET).update('o1|pay1').digest('hex');
    // getBillById reads the bill via pool.query
    q.mockResolvedValueOnce({ rows: [payableBill({ patient_id: 'p', payments: [{ status: 'COMPLETED', method: 'CASH', amount: '30' }] })] });
    // the internal recordPayment() call runs against the pooled client
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT * FROM bills')) return { rows: [{ id: 'b1', patient_id: 'p', net_amount: 100, status: 'ISSUED' }] };
      if (sql.includes('SUM(amount)')) return { rows: [{ paid: 30 }] };
      if (sql.startsWith('INSERT INTO payments')) return { rows: [{ id: 'pay-1', amount: 70 }] };
      if (sql.startsWith('UPDATE bills')) return { rows: [] };
      return { rows: [] };
    });

    const res = await billing.verifyAndRecordRazorpayPayment({
      billId: 'b1', razorpayOrderId: 'o1', razorpayPaymentId: 'pay1', razorpaySignature: expectedSig,
    });
    expect(res.billStatus).toBe('PAID');
    const payInsert = client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO payments'));
    expect(payInsert[1]).toEqual(['b1', 'p', 70, 'ONLINE', 'pay1', 'p']);
  });
});

describe('billing.service — misc', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('flagForDiscountApproval sets discount_approved = FALSE and audits', async () => {
    await billing.flagForDiscountApproval('b1');
    expect(q).toHaveBeenCalledWith(expect.stringContaining('discount_approved = FALSE'), ['b1']);
    expect(auditLog).toHaveBeenCalled();
  });

  it('approveDiscount → 404 when missing, updates + audits otherwise', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(billing.approveDiscount({ billId: 'b1', approved: true, adminId: 'u' }))
      .rejects.toMatchObject({ status: 404 });

    q.mockResolvedValueOnce({ rows: [{ id: 'b1', discount_approved: true }] });
    const res = await billing.approveDiscount({ billId: 'b1', approved: true, note: 'ok', adminId: 'u' });
    expect(res.discount_approved).toBe(true);
    expect(auditLog).toHaveBeenCalled();
  });
});
