// Coverage for the blood-bank module: unit CRUD, FIFO reservation with
// partial-unit splitting, admin notifications, availability, and low-stock alerts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, poolConnect, clientQuery, auditMock, createNotifMock } = vi.hoisted(() => ({
  q: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: poolConnect },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog: auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { BROADCAST: 'BROADCAST' },
}));

import * as bloodBank from '../src/modules/blood-bank/blood-bank.service.js';

const client = { query: clientQuery, release: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  createNotifMock.mockResolvedValue(undefined);
  poolConnect.mockResolvedValue(client);
});

describe('blood-bank.service — createBloodUnit', () => {
  it('inserts, audits and alerts when the group is low stock', async () => {
    const unit = { id: 'b1', blood_group: 'A+' };
    q.mockResolvedValueOnce({ rows: [unit] })            // INSERT
      .mockResolvedValueOnce({ rows: [{ total: '3' }] }) // low-stock total
      .mockResolvedValueOnce({ rows: [{ id: 'ad1' }] }); // fetch admins

    const res = await bloodBank.createBloodUnit(
      { bloodGroup: 'A+', units: 3, donorName: 'Bob', expiryDate: '2026-12-31', status: 'AVAILABLE' },
      'u1', 'ip'
    );

    expect(q.mock.calls[0][1]).toEqual(['A+', 3, 'Bob', '2026-12-31', 'AVAILABLE', 'u1']);
    expect(res).toBe(unit);
    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'CREATE', entity: 'blood_bank',
      entityId: 'b1', nextData: unit, ip: 'ip',
    });
    expect(q.mock.calls[1][0]).toContain("status = 'AVAILABLE'");
    expect(createNotifMock).toHaveBeenCalledWith(
      'ad1', 'BLOOD_REQUEST', 'Low Blood Stock: A+',
      expect.stringContaining('critically low'),
      { entityType: 'blood_bank', bloodGroup: 'A+' },
      null
    );
  });

  it('skips alerting when stock is sufficient', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', blood_group: 'O-' }] })
      .mockResolvedValueOnce({ rows: [{ total: '10' }] });

    await bloodBank.createBloodUnit(
      { bloodGroup: 'O-', units: 5, expiryDate: '2026-12-31' }, 'u1', 'ip'
    );
    expect(createNotifMock).not.toHaveBeenCalled();
  });
});

describe('blood-bank.service — getBloodUnits', () => {
  it('applies filters and pagination placeholders', async () => {
    q.mockResolvedValue({ rows: [{ id: 'b1' }] });
    const res = await bloodBank.getBloodUnits({ bloodGroup: 'A+', status: 'AVAILABLE', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('blood_group = $1');
    expect(sql).toContain('status = $2');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['A+', 'AVAILABLE', 10, 10]);
    expect(res).toEqual([{ id: 'b1' }]);
  });

  it('defaults pagination', async () => {
    q.mockResolvedValue({ rows: [] });
    await bloodBank.getBloodUnits({});
    expect(q.mock.calls[0][1]).toEqual([50, 0]);
  });
});

describe('blood-bank.service — getBloodUnit', () => {
  it('returns a unit', async () => {
    q.mockResolvedValue({ rows: [{ id: 'b1' }] });
    const res = await bloodBank.getBloodUnit('b1');
    expect(res).toEqual({ id: 'b1' });
  });

  it('throws 404 when not found', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(bloodBank.getBloodUnit('b1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('blood-bank.service — updateBloodUnit', () => {
  it('updates allowed fields and re-checks low stock', async () => {
    const prev = { id: 'b1', blood_group: 'A+', units: 3 };
    const updated = { id: 'b1', blood_group: 'A+', units: 4 };
    q.mockResolvedValueOnce({ rows: [prev] })              // getBloodUnit
      .mockResolvedValueOnce({ rows: [updated] })          // UPDATE
      .mockResolvedValueOnce({ rows: [{ total: '4' }] })   // low-stock total
      .mockResolvedValueOnce({ rows: [{ id: 'ad1' }] });   // fetch admins

    await bloodBank.updateBloodUnit('b1', { bloodGroup: 'A+', units: 4, status: 'AVAILABLE' }, 'u1', 'ip');

    const [sql, params] = q.mock.calls[1];
    expect(sql).toContain('UPDATE blood_bank SET');
    expect(sql).toContain('blood_group = $1');
    expect(sql).toContain('units = $2');
    expect(params.slice(0, 2)).toEqual(['A+', 4]);
    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'UPDATE', entity: 'blood_bank',
      entityId: 'b1', prevData: prev, nextData: updated, ip: 'ip',
    });
  });

  it('rejects unknown fields and returns prev when nothing changes', async () => {
    const prev = { id: 'b1' };
    q.mockResolvedValue({ rows: [prev] });
    const res = await bloodBank.updateBloodUnit('b1', { hackerField: 'x' }, 'u1', 'ip');
    expect(res).toBe(prev);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when the UPDATE affects no rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'b1' }] })
      .mockResolvedValue({ rows: [] });
    await expect(bloodBank.updateBloodUnit('b1', { units: 1 }, 'u1', 'ip'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('blood-bank.service — deleteBloodUnit', () => {
  it('soft-deletes and audits', async () => {
    q.mockResolvedValue({ rows: [{ id: 'b1' }] });
    const res = await bloodBank.deleteBloodUnit('b1', 'u1', 'ip');
    expect(q.mock.calls[0][0]).toContain('SET deleted_at = NOW()');
    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'DELETE', entity: 'blood_bank', entityId: 'b1', ip: 'ip',
    });
    expect(res).toEqual({ ok: true });
  });

  it('throws 404 when not found', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(bloodBank.deleteBloodUnit('b1', 'u1', 'ip')).rejects.toMatchObject({ status: 404 });
  });
});

describe('blood-bank.service — requestBlood', () => {
  it('throws 422 when availability is insufficient (checked inside the txn)', async () => {
    clientQuery.mockResolvedValueOnce({ rows: [] });                          // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 'b1', units: '2' }] });  // availability (FOR UPDATE)
    await expect(
      bloodBank.requestBlood({ patientId: 'p1', bloodGroup: 'A+', units: 5, reason: 'Surgery' }, 'd1', null, 'ip')
    ).rejects.toMatchObject({ message: expect.stringContaining('Insufficient A+ units'), status: 422 });
    expect(poolConnect).toHaveBeenCalled();
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('reserves FIFO units, locks availability FOR UPDATE, and splits partial units', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'ad1' }] })                      // admins (post-txn)
      .mockResolvedValueOnce({ rows: [{ total: '10' }] });                  // low-stock total (sufficient)

    clientQuery.mockResolvedValueOnce({ rows: [] })                         // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'b1', units: '10' }, { id: 'b2', units: '20' }] }) // availability
      .mockResolvedValue({ rows: [] });                                     // UPDATEs + INSERT + COMMIT

    const io = null;
    const res = await bloodBank.requestBlood(
      { patientId: 'p1', bloodGroup: 'A+', units: 25, reason: 'Surgery' }, 'd1', io, 'ip'
    );

    const calls = clientQuery.mock.calls.map(([sql]) => sql);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('FOR UPDATE');                               // availability is lock-read
    expect(calls[2]).toContain("status = 'RESERVED'");
    expect(calls[3]).toContain('SET units = $1');
    expect(calls[4]).toContain('INSERT INTO blood_bank');
    expect(calls[5]).toBe('COMMIT');

    expect(clientQuery.mock.calls[2][1]).toEqual(['b1']);
    expect(clientQuery.mock.calls[3][1]).toEqual([15, 'b2']);
    expect(clientQuery.mock.calls[4][1]).toEqual([5, 'b2']);
    expect(client.release).toHaveBeenCalled();

    expect(createNotifMock).toHaveBeenCalledWith(
      'ad1', 'BLOOD_REQUEST', 'Blood Request',
      expect.stringContaining('25 unit(s) of A+ requested'),
      { entityType: 'blood_bank', patientId: 'p1' },
      io
    );
    expect(auditMock).toHaveBeenCalledWith({
      userId: 'd1', action: 'BLOOD_REQUEST', entity: 'blood_bank',
      nextData: { patientId: 'p1', bloodGroup: 'A+', units: 25, reason: 'Surgery' }, ip: 'ip',
    });
    expect(res).toEqual({ ok: true, reserved: 25 });
  });

  it('rolls back the transaction on failure', async () => {
    clientQuery.mockResolvedValueOnce({ rows: [] })                         // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'b1', units: '10' }] })         // availability
      .mockRejectedValueOnce(new Error('db down'));                         // UPDATE fails

    await expect(
      bloodBank.requestBlood({ patientId: 'p1', bloodGroup: 'A+', units: 5 }, 'd1', null, 'ip')
    ).rejects.toThrow('db down');

    expect(clientQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('blood-bank.service — getAvailability', () => {
  it('parses sums and flags low stock', async () => {
    q.mockResolvedValue({ rows: [
      { blood_group: 'A+', available: '10', reserved: '4', total: '14' },
      { blood_group: 'O-', available: null, reserved: null, total: null },
    ] });
    const res = await bloodBank.getAvailability();
    expect(res).toEqual([
      { bloodGroup: 'A+', available: 10, reserved: 4, total: 14, lowStock: false },
      { bloodGroup: 'O-', available: 0, reserved: 0, total: 0, lowStock: true },
    ]);
    expect(q.mock.calls[0][0]).toContain('expiry_date > NOW()');
  });
});
