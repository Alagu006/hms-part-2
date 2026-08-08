// Coverage for the OT scheduling module: conflict checks, create/update/delete
// of theatre schedules, filtering, and notification fan-out to staff.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, auditMock, createNotifMock, withTxnMock } = vi.hoisted(() => {
  const q = vi.fn();
  const txnClient = { query: (...args) => q(...args) };
  return {
    q,
    auditMock: vi.fn(),
    createNotifMock: vi.fn(),
    // Execute the transaction body immediately on a client that routes to q,
    // mirroring withTransaction's semantics (BEGIN/COMMIT not needed here).
    withTxnMock: vi.fn(async (fn) => fn(txnClient)),
  };
});

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTxnMock,
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog: auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { BROADCAST: 'BROADCAST' },
}));

import * as ot from '../src/modules/ot-scheduling/ot.service.js';

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.resetAllMocks();
  createNotifMock.mockResolvedValue(undefined);
});

describe('ot.service — createOTSchedule', () => {
  it('throws 409 when the theatre is already booked', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'other' }] });

    await expect(
      ot.createOTSchedule({
        patientId: 'p1', doctorId: 'd1', anesthetistId: 'a1', theatre: 'OT1',
        scheduledAt: '2026-08-01T10:00:00', durationMinutes: 60, procedure: 'Surgery',
      }, 'u1', null, 'ip')
    ).rejects.toMatchObject({ message: 'Theatre OT1 is already booked during this time slot', status: 409 });

    expect(q.mock.calls[1][0]).toContain("status NOT IN ('CANCELLED','COMPLETED')");
    expect(q.mock.calls[1][1]).toEqual([expect.any(String), expect.any(Date), expect.any(Date)]);
  });

  it('skips conflict check when the room is not found', async () => {
    q.mockResolvedValueOnce({ rows: [] })  // conflict room lookup — empty
      .mockResolvedValueOnce({ rows: [{ id: 'ot1', scheduled_start: '2026-08-01T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] }) // notify: nurses
      .mockResolvedValueOnce({ rows: [] }); // notify: receptionists

    const res = await ot.createOTSchedule({
      patientId: 'p1', doctorId: 'd1', anesthetistId: null, theatre: 'OT1',
      scheduledAt: '2026-08-01T10:00:00', durationMinutes: 60, procedure: 'Surgery',
    }, 'u1', null, 'ip');

    const insertSql = q.mock.calls[1][0];
    expect(insertSql).toContain('INSERT INTO ot_schedules');
    expect(q.mock.calls[1][1]).toEqual([
      'p1', 'd1', null, null, 'Surgery',
      expect.any(Date), expect.any(Date), 'SCHEDULED', 'u1',
    ]);
    expect(res.theatre).toBe('OT1');
  });

  it('creates a schedule and notifies all parties', async () => {
    const room = { id: 'r1' };
    const scheduleRow = { id: 'ot1', procedure_name: 'Appendectomy', scheduled_start: '2026-08-01T10:00:00.000Z' };
    q.mockResolvedValueOnce({ rows: [room] })                          // conflict room lookup (FOR UPDATE)
      .mockResolvedValueOnce({ rows: [] })                             // conflict query — clear
      .mockResolvedValueOnce({ rows: [scheduleRow] })                  // INSERT
      .mockResolvedValueOnce({ rows: [{ id: 'n1' }, { id: 'n2' }] })   // nurses
      .mockResolvedValueOnce({ rows: [{ id: 'rc1' }] });               // receptionists

    const io = null;
    const res = await ot.createOTSchedule({
      patientId: 'p1', doctorId: 'd1', anesthetistId: 'a1', theatre: 'OT1',
      scheduledAt: '2026-08-01T10:00:00', durationMinutes: 90, procedure: 'Appendectomy',
      status: 'CONFIRMED',
    }, 'u1', io, 'ip');

    expect(q.mock.calls[2][1]).toEqual(['p1', 'd1', 'a1', 'r1', 'Appendectomy',
      expect.any(Date), expect.any(Date), 'CONFIRMED', 'u1',
    ]);
    expect(res).toEqual({ ...scheduleRow, theatre: 'OT1' });

    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'CREATE', entity: 'ot_schedules',
      entityId: 'ot1', nextData: scheduleRow, ip: 'ip',
    });

    // Notify doctor, anesthetist, nurses, receptionists (deduped via Set)
    expect(createNotifMock).toHaveBeenCalledTimes(5);
    const ids = createNotifMock.mock.calls.map(([uid]) => uid).sort();
    expect(ids).toEqual(['a1', 'd1', 'n1', 'n2', 'rc1']);
    const [uid, type, title, message, metadata, ioArg] = createNotifMock.mock.calls[0];
    expect(type).toBe('OT_SCHEDULED');
    expect(title).toBe('OT Scheduled');
    expect(message).toContain('Appendectomy');
    expect(metadata).toEqual({ entityType: 'ot_schedules', entityId: 'ot1' });
    expect(ioArg).toBeNull();
    await flush();
  });
});

describe('ot.service — getOTSchedules', () => {
  it('applies date, theatre and status filters', async () => {
    q.mockResolvedValue({ rows: [{ id: 'ot1', theatre: 'OT1' }] });
    const res = await ot.getOTSchedules({ date: '2026-08-01', theatre: 'OT1', status: 'SCHEDULED' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('DATE(os.scheduled_start) = $1');
    expect(sql).toContain('r.room_number = $2');
    expect(sql).toContain('os.status = $3');
    expect(sql).toContain('ORDER BY os.scheduled_start');
    expect(params).toEqual(['2026-08-01', 'OT1', 'SCHEDULED']);
    expect(res).toEqual([{ id: 'ot1', theatre: 'OT1' }]);
  });

  it('defaults to no filters', async () => {
    q.mockResolvedValue({ rows: [] });
    await ot.getOTSchedules({});
    expect(q.mock.calls[0][0]).toContain('os.deleted_at IS NULL');
    expect(q.mock.calls[0][1]).toEqual([]);
  });
});

describe('ot.service — getOTSchedule', () => {
  it('returns a schedule', async () => {
    q.mockResolvedValue({ rows: [{ id: 'ot1', theatre: 'OT1' }] });
    const res = await ot.getOTSchedule('ot1');
    expect(q.mock.calls[0][1]).toEqual(['ot1']);
    expect(res.theatre).toBe('OT1');
  });

  it('throws 404 when not found', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(ot.getOTSchedule('ot1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('ot.service — updateOTSchedule', () => {
  it('updates fields and re-checks conflicts', async () => {
    const prev = {
      id: 'ot1', theatre: 'OT1', procedure_name: 'Old', status: 'SCHEDULED',
      scheduled_start: '2026-08-01T10:00:00.000Z', scheduled_end: '2026-08-01T11:00:00.000Z',
    };
    const room = { id: 'r1' };
    q.mockResolvedValueOnce({ rows: [prev] })     // getOTSchedule
      .mockResolvedValueOnce({ rows: [room] })   // conflict room lookup
      .mockResolvedValueOnce({ rows: [] })       // conflict query — clear
      .mockResolvedValueOnce({ rows: [room] })   // theatre room lookup
      .mockResolvedValueOnce({ rows: [{ id: 'ot1', procedure_name: 'New', room_id: 'r1' }] }); // UPDATE

    const res = await ot.updateOTSchedule('ot1', {
      procedure: 'New', theatre: 'OT2', scheduledAt: '2026-08-02T09:00:00', durationMinutes: 60,
    }, 'u1', null, 'ip');

    const [sql, params] = q.mock.calls[4];
    expect(sql).toContain('UPDATE ot_schedules SET');
    expect(sql).toContain('procedure_name = $1');
    expect(sql).toContain('scheduled_start = $2');
    expect(sql).toContain('scheduled_end = $3');
    expect(sql).toContain('room_id = $4');
    expect(sql).toContain('WHERE id = $5');
    expect(params[0]).toBe('New');
    expect(params[1]).toEqual(expect.any(Date));
    expect(params[4]).toBe('ot1');

    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'UPDATE', entity: 'ot_schedules',
      entityId: 'ot1', prevData: prev, nextData: res, ip: 'ip',
    });
  });

  it('returns prev unchanged when there are no update fields', async () => {
    const prev = { id: 'ot1', theatre: 'OT1' };
    q.mockResolvedValue({ rows: [prev] });
    const res = await ot.updateOTSchedule('ot1', {}, 'u1', null, 'ip');
    expect(res).toBe(prev);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when the schedule does not exist', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(ot.updateOTSchedule('ot1', { procedure: 'X' }, 'u1', null, 'ip'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when the UPDATE affects no rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'ot1', theatre: 'OT1' }] })
      .mockResolvedValue({ rows: [] });
    await expect(ot.updateOTSchedule('ot1', { procedure: 'X' }, 'u1', null, 'ip'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('ot.service — deleteOTSchedule', () => {
  it('soft-deletes and audits', async () => {
    q.mockResolvedValue({ rows: [{ id: 'ot1' }] });
    const res = await ot.deleteOTSchedule('ot1', 'u1', 'ip');
    expect(q.mock.calls[0][0]).toContain('SET deleted_at = NOW()');
    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'DELETE', entity: 'ot_schedules', entityId: 'ot1', ip: 'ip',
    });
    expect(res).toEqual({ ok: true });
  });

  it('throws 404 when not found', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(ot.deleteOTSchedule('ot1', 'u1', 'ip')).rejects.toMatchObject({ status: 404 });
  });
});
