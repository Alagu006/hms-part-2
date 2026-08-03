// Coverage for the visitors module: visitor check-in with field encryption,
// history, checkout, admin list, and past-visitor search.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, auditMock,
  pgEncryptFieldsMock, pgDecryptFieldsMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  pgEncryptFieldsMock: vi.fn(),
  pgDecryptFieldsMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt      : vi.fn(async (v) => v),
  pgDecrypt      : vi.fn(async (v) => v),
  pgEncryptFields: pgEncryptFieldsMock,
  pgDecryptFields: pgDecryptFieldsMock,
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

import * as visitors from '../src/modules/visitors/visitors.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  pgEncryptFieldsMock.mockImplementation(async (data, fields) => {
    const out = {};
    for (const f of fields) out[f] = data[f] ?? null;
    return out;
  });
  pgDecryptFieldsMock.mockImplementation(async (row) => ({ ...row }));
});

// ---------------------------------------------------------------------------
// logVisitor
// ---------------------------------------------------------------------------
describe('visitors.service — logVisitor', () => {
  it('encrypts sensitive fields, inserts, decrypts and audits', async () => {
    q.mockResolvedValue({ rows: [{ id: 'v1', visitor_name: 'enc:John' }] });
    const data = {
      patientId: 'p1',
      visitor_name: 'John', visitor_phone: '123', id_number: 'x123',
      relationship: 'brother', idType: 'AADHAAR', purpose: 'visit',
    };

    const res = await visitors.logVisitor(data, 'u1', 'ip', 'ua');

    expect(pgEncryptFieldsMock).toHaveBeenCalledWith(data, ['visitor_name', 'visitor_phone', 'id_number']);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('INSERT INTO visitor_logs');
    expect(params).toEqual(['p1', 'John', '123', 'brother', 'AADHAAR', 'x123', 'visit', 'u1']);
    expect(pgDecryptFieldsMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith('u1', 'CREATE', 'visitor_logs', 'v1', null, { patientId: 'p1', purpose: 'visit' });
    expect(res.id).toBe('v1');
  });

  it('stores nulls when sensitive fields are absent', async () => {
    q.mockResolvedValue({ rows: [{ id: 'v2' }] });
    const res = await visitors.logVisitor({ patientId: 'p1', relationship: 'brother' }, 'u1', 'ip', 'ua');
    expect(pgEncryptFieldsMock).toHaveBeenCalledWith(expect.anything(), []);
    expect(q.mock.calls[0][1]).toEqual(['p1', null, null, 'brother', null, null, null, 'u1']);
    expect(res.id).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// getVisitorHistory
// ---------------------------------------------------------------------------
describe('visitors.service — getVisitorHistory', () => {
  it('returns decrypted, paginated history', async () => {
    q.mockResolvedValue({ rows: [{ id: 'v1', visitor_name: 'John', total_count: '2' }] });
    const res = await visitors.getVisitorHistory('p1', { page: 1, limit: 10 });
    expect(q.mock.calls[0][1]).toEqual(['p1', 10, 0]);
    expect(res).toEqual({ visitors: [{ id: 'v1', visitor_name: 'John' }], total: 2, page: 1, limit: 10 });
  });
});

// ---------------------------------------------------------------------------
// checkoutVisitor
// ---------------------------------------------------------------------------
describe('visitors.service — checkoutVisitor', () => {
  it('checks out and audits with previous data', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'v1', visitor_name: 'John' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1', checked_out_at: '2026-01-01' }] });

    const res = await visitors.checkoutVisitor('v1', 'u1');

    const [sql, params] = q.mock.calls[1];
    expect(sql).toContain('SET checked_out_at = NOW()');
    expect(params).toEqual(['v1', 'u1']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'visitor_logs', 'v1', { id: 'v1', visitor_name: 'John' }, { id: 'v1', checked_out_at: '2026-01-01' });
    expect(res.id).toBe('v1');
  });

  it('audits with null previous data when none existed', async () => {
    q.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] });
    await visitors.checkoutVisitor('v1', 'u1');
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'visitor_logs', 'v1', null, { id: 'v1' });
  });

  it('returns null without auditing when already checked out', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'v1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await visitors.checkoutVisitor('v1', 'u1');
    expect(res).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listAllVisitors
// ---------------------------------------------------------------------------
describe('visitors.service — listAllVisitors', () => {
  it('queries without filters', async () => {
    q.mockResolvedValue({ rows: [] });
    await visitors.listAllVisitors({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([20, 0]);
  });

  it('filters by date and checked-in status', async () => {
    q.mockResolvedValue({ rows: [] });
    await visitors.listAllVisitors({ page: 1, limit: 20, date: '2026-03-03', checkedOut: 'true' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('DATE(v.checked_in_at) = $1');
    expect(sql).toContain('v.checked_out_at IS NOT NULL');
    expect(params).toEqual(['2026-03-03', 20, 0]);
  });

  it('filters by not-checked-out status', async () => {
    q.mockResolvedValue({ rows: [{ id: 'v1', total_count: '1' }] });
    const res = await visitors.listAllVisitors({ page: 1, limit: 20, checkedOut: 'false' });
    expect(q.mock.calls[0][0]).toContain('v.checked_out_at IS NULL');
    expect(res.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// searchPastVisitors
// ---------------------------------------------------------------------------
describe('visitors.service — searchPastVisitors', () => {
  it('searches decrypted visitor records with the crypto key', async () => {
    process.env.PG_CRYPTO_KEY = 'test-key';
    q.mockResolvedValue({ rows: [{ visitor_name: 'John' }] });
    const res = await visitors.searchPastVisitors('jo');
    expect(q.mock.calls[0][1]).toEqual(['%jo%', 'test-key']);
    expect(q.mock.calls[0][0]).toContain('pgp_sym_decrypt(decode(v.visitor_name');
    expect(res).toEqual([{ visitor_name: 'John' }]);
  });
});
