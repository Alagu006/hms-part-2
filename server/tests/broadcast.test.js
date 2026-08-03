// Coverage for the broadcast module: creating broadcasts with batched
// fan-out to staff, listing with filters, receipts, and staff counts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q, auditMock, createNotifMock, loggerError } = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
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

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}));

import * as broadcast from '../src/modules/broadcast/broadcast.service.js';

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('broadcast.service — createBroadcast', () => {
  it('creates a broadcast with zero recipients (fallback sender name)', async () => {
    q.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1', title: 'Test' }] });

    const res = await broadcast.createBroadcast(
      { title: 'Test', message: 'Hello', priority: 'HIGH', expiresAt: null },
      'u1', 'ip', 'ua', null
    );

    expect(q.mock.calls[0][0]).toContain("ur.role != 'PATIENT'");
    expect(q.mock.calls[2][0]).toContain('INSERT INTO broadcasts');
    expect(q.mock.calls[2][1]).toEqual(['Test', 'Hello', 'HIGH', 'u1', null]);
    expect(res).toEqual({ broadcast: { id: 'b1', title: 'Test' }, totalCount: 0 });

    expect(auditMock).toHaveBeenCalledWith({
      userId: 'u1', action: 'BROADCAST', entity: 'broadcasts',
      entityId: 'b1', prevData: null,
      nextData: { title: 'Test', priority: 'HIGH', recipientCount: 0 },
      ip: 'ip', userAgent: 'ua',
    });

    await flush();
    await flush();
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('fans out notifications in batches and emits to admin', async () => {
    const users = Array.from({ length: 120 }, (_, i) => ({ id: `u${i}` }));
    q.mockResolvedValueOnce({ rows: users })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Ann', last_name: 'Lee' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1', title: 'Test' }] });

    const emit = vi.fn();
    const io = { of: vi.fn(() => ({ to: vi.fn(() => ({ emit })) })) };

    const res = await broadcast.createBroadcast(
      { title: 'Test', message: 'Hello', priority: 'HIGH', expiresAt: '2026-09-01' },
      'u1', 'ip', 'ua', io
    );

    expect(res.totalCount).toBe(120);
    expect(q.mock.calls[2][1]).toEqual(['Test', 'Hello', 'HIGH', 'u1', '2026-09-01']);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      nextData: { title: 'Test', priority: 'HIGH', recipientCount: 120 },
    }));

    await flush();
    await flush();
    await flush();

    expect(createNotifMock).toHaveBeenCalledTimes(120);
    const [firstUid, type, title, message, metadata, ioArg] = createNotifMock.mock.calls[0];
    expect(firstUid).toBe('u0');
    expect(type).toBe('BROADCAST');
    expect(title).toBe('[HIGH] Test');
    expect(message).toBe('Hello');
    expect(metadata).toEqual({
      entityType: 'BROADCAST', entityId: 'b1', priority: 'HIGH',
      senderName: 'Ann Lee', sentBy: 'u1',
    });
    expect(ioArg).toBe(io);

    expect(io.of).toHaveBeenCalledWith('/notifications');
    expect(emit).toHaveBeenCalledWith('broadcast:delivered', {
      broadcastId: 'b1', deliveredCount: 120,
    });
  });

  it('logs a fan-out error via logger.error', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'u0' }] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'A', last_name: 'B' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1', title: 'T' }] });

    const io = {}; // of() is undefined → fan-out throws TypeError
    await broadcast.createBroadcast(
      { title: 'T', message: 'M', priority: 'LOW' }, 'u1', 'ip', 'ua', io
    );

    await flush();
    await flush();
    await flush();

    expect(loggerError).toHaveBeenCalledWith(
      '[broadcast] Fan-out error',
      expect.objectContaining({ message: expect.stringContaining('io.of is not a function') })
    );
  });
});

describe('broadcast.service — listBroadcasts', () => {
  it('paginates with a priority filter and strips total_count', async () => {
    q.mockResolvedValue({ rows: [
      { id: 'b1', total_count: '2' },
      { id: 'b2', total_count: '2' },
    ] });
    const res = await broadcast.listBroadcasts({ page: 1, limit: 10, priority: 'HIGH' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('b.priority = $3');
    expect(params).toEqual([10, 0, 'HIGH']);
    expect(res).toEqual({
      broadcasts: [{ id: 'b1' }, { id: 'b2' }],
      total: 2, page: 1, limit: 10,
    });
  });

  it('handles empty rows', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await broadcast.listBroadcasts({ page: 1, limit: 10 });
    expect(res.total).toBe(0);
    expect(res.broadcasts).toEqual([]);
  });
});

describe('broadcast.service — getBroadcastById', () => {
  it('returns the broadcast row', async () => {
    q.mockResolvedValue({ rows: [{ id: 'b1', sender_name: 'Ann Lee' }] });
    const res = await broadcast.getBroadcastById('b1');
    expect(q.mock.calls[0][1]).toEqual(['b1']);
    expect(res).toEqual({ id: 'b1', sender_name: 'Ann Lee' });
  });

  it('returns null when not found', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await broadcast.getBroadcastById('b1');
    expect(res).toBeNull();
  });
});

describe('broadcast.service — getReadReceipts', () => {
  it('paginates and strips total_count', async () => {
    q.mockResolvedValue({ rows: [{ id: 'u1', is_read: true, total_count: '1' }] });
    const res = await broadcast.getReadReceipts('b1', { page: 2, limit: 5 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain("n.entity_type = 'BROADCAST'");
    expect(params).toEqual(['b1', 5, 5]);
    expect(res).toEqual({
      receipts: [{ id: 'u1', is_read: true }],
      total: 1, page: 2, limit: 5,
    });
  });
});

describe('broadcast.service — getStaffCount', () => {
  it('returns parsed staff count', async () => {
    q.mockResolvedValue({ rows: [{ count: '7' }] });
    const res = await broadcast.getStaffCount();
    expect(res).toBe(7);
  });
});
