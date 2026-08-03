// Coverage for the shared notification service: creation with encryption +
// real-time emit + web push, read/unread bookkeeping, and paginated listing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, pgEncryptMock, pgDecryptMock,
  redisGet, redisSetex, redisIncr, redisDecr, redisSet,
  sendPushMock, auditMock, loggerWarn,
} = vi.hoisted(() => ({
  q: vi.fn(),
  pgEncryptMock: vi.fn(),
  pgDecryptMock: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  redisIncr: vi.fn(),
  redisDecr: vi.fn(),
  redisSet: vi.fn(),
  sendPushMock: vi.fn(),
  auditMock: vi.fn(),
  loggerWarn: vi.fn(),
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

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: { get: redisGet, setex: redisSetex, incr: redisIncr, decr: redisDecr, set: redisSet },
}));

vi.mock('../src/shared/services/webpush.service.js', () => ({
  sendPushNotification: sendPushMock,
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as notif from '../src/shared/services/notification.service.js';

function notifRow(overrides = {}) {
  return {
    id: 'n1', user_id: 'u1', type: 'APPOINTMENT', is_read: false,
    created_at: '2026-01-02T10:00:00Z', title: 'enc(Title)', body: 'enc(Body)',
    ...overrides,
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  vi.resetAllMocks();
  pgEncryptMock.mockImplementation(async (t) => `enc(${t})`);
  pgDecryptMock.mockImplementation(async (t) =>
    typeof t === 'string' && t.startsWith('enc(') ? t.slice(4, -1) : t
  );
  auditMock.mockImplementation(async () => {});
  sendPushMock.mockImplementation(async () => {});
  redisIncr.mockImplementation(async () => 1);
  redisDecr.mockImplementation(async () => 0);
});

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------
describe('notification.service — createNotification', () => {
  it('encrypts fields, inserts, increments unread, pushes, and audits', async () => {
    q.mockResolvedValueOnce({ rows: [notifRow()] });
    const res = await notif.createNotification('u1', 'APPOINTMENT', 'Title', 'Body', {
      entityType: 'APPOINTMENT', entityId: 'a1', priority: 'MEDIUM',
    });

    expect(res).toMatchObject({ id: 'n1', user_id: 'u1' });
    expect(pgEncryptMock).toHaveBeenCalledWith('Title');
    expect(pgEncryptMock).toHaveBeenCalledWith('Body');
    expect(pgEncryptMock).toHaveBeenCalledWith(JSON.stringify({ entityType: 'APPOINTMENT', entityId: 'a1', priority: 'MEDIUM' }));

    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('INSERT INTO notifications');
    expect(params).toEqual(['u1', 'APPOINTMENT', 'enc(Title)', 'enc(Body)', 'pgcrypto', 'APPOINTMENT', 'a1']);

    expect(redisIncr).toHaveBeenCalledWith('notif:unread:u1');
    expect(sendPushMock).toHaveBeenCalledWith('u1', { title: 'Title', body: 'Body', data: { type: 'APPOINTMENT', entityType: 'APPOINTMENT', entityId: 'a1', priority: 'MEDIUM' } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'notifications', entityId: 'n1' }));
  });

  it('defaults metadata entity fields to null', async () => {
    q.mockResolvedValueOnce({ rows: [notifRow()] });
    await notif.createNotification('u1', 'APPOINTMENT', 'Title', 'Body');
    expect(q.mock.calls[0][1]).toEqual(['u1', 'APPOINTMENT', 'enc(Title)', 'enc(Body)', 'pgcrypto', null, null]);
  });

  it('emits a real-time event to the user namespace when io is provided', async () => {
    const emit = vi.fn();
    const io = { of: vi.fn(() => ({ to: vi.fn(() => ({ emit })) })) };
    q.mockResolvedValueOnce({ rows: [notifRow()] });

    await notif.createNotification('u1', 'APPOINTMENT', 'Title', 'Body', { entityId: 'a1' }, io);

    expect(io.of).toHaveBeenCalledWith('/notifications');
    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe('notification:new');
    expect(payload).toMatchObject({ id: 'n1', type: 'APPOINTMENT', title: 'Title', isRead: false, highPriority: false });
  });

  it('flags high-priority types in the real-time payload', async () => {
    const emit = vi.fn();
    const io = { of: vi.fn(() => ({ to: vi.fn(() => ({ emit })) })) };
    q.mockResolvedValueOnce({ rows: [notifRow({ type: 'EMERGENCY_ALERT' })] });

    await notif.createNotification('u1', notif.NotificationType.EMERGENCY_ALERT, 'Alert', 'Body', {}, io);
    expect(emit.mock.calls[0][1].highPriority).toBe(true);
  });

  it('logs a warning when the web push fails', async () => {
    q.mockResolvedValueOnce({ rows: [notifRow()] });
    sendPushMock.mockRejectedValueOnce(new Error('push down'));
    await notif.createNotification('u1', 'APPOINTMENT', 'Title', 'Body');
    await flush();
    expect(loggerWarn).toHaveBeenCalledWith('[notification] Push failed:', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------
describe('notification.service — markAsRead', () => {
  it('returns null when no unread notification matches', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await notif.markAsRead('n1', 'u1')).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('marks read, audits, and decrements the unread counter when it is positive', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'n1' }] });
    redisGet.mockResolvedValueOnce('5');
    const res = await notif.markAsRead('n1', 'u1');
    expect(res.id).toBe('n1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityId: 'n1' }));
    expect(redisDecr).toHaveBeenCalledWith('notif:unread:u1');
  });

  it('skips the decrement when the unread count is already zero', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'n1' }] });
    redisGet.mockResolvedValueOnce('0');
    await notif.markAsRead('n1', 'u1');
    expect(redisDecr).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------
describe('notification.service — markAllAsRead', () => {
  it('resets the counter and audits when rows were updated', async () => {
    q.mockResolvedValueOnce({ rowCount: 3 });
    await notif.markAllAsRead('u1');
    expect(redisSet).toHaveBeenCalledWith('notif:unread:u1', '0');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'bulk' }));
  });

  it('does not audit when there was nothing to update', async () => {
    q.mockResolvedValueOnce({ rowCount: 0 });
    await notif.markAllAsRead('u1');
    expect(redisSet).toHaveBeenCalledWith('notif:unread:u1', '0');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------
describe('notification.service — getUnreadCount', () => {
  it('returns the cached count from Redis', async () => {
    redisGet.mockResolvedValueOnce('3');
    expect(await notif.getUnreadCount('u1')).toBe(3);
    expect(q).not.toHaveBeenCalled();
  });

  it('falls back to the DB when Redis is unavailable and re-caches', async () => {
    redisGet.mockRejectedValueOnce(new Error('redis down'));
    q.mockResolvedValueOnce({ rows: [{ count: '7' }] });
    expect(await notif.getUnreadCount('u1')).toBe(7);
    expect(q.mock.calls[0][0]).toContain('COUNT(*) AS count');
    expect(redisSetex).toHaveBeenCalledWith('notif:unread:u1', 3600, '7');
  });
});

// ---------------------------------------------------------------------------
// getNotifications
// ---------------------------------------------------------------------------
describe('notification.service — getNotifications', () => {
  it('decrypts rows, strips total_count, and includes unreadCount', async () => {
    q.mockResolvedValueOnce({ rows: [
      { id: 'n1', title: 'enc(Title)', body: 'enc(Body)', total_count: '2' },
      { id: 'n2', title: 'enc(T2)', body: 'enc(B2)', total_count: '2' },
    ] });
    redisGet.mockResolvedValueOnce('2');
    const res = await notif.getNotifications('u1', { page: 1, limit: 10 });

    expect(res.total).toBe(2);
    expect(res.unreadCount).toBe(2);
    expect(res.notifications[0]).toMatchObject({ id: 'n1', title: 'Title', body: 'Body' });
    expect(res.notifications[0]).not.toHaveProperty('total_count');
    expect(q.mock.calls[0][1]).toEqual(['u1', 10, 0]);
  });

  it('adds a type filter with a shifted placeholder', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    redisGet.mockResolvedValueOnce('0');
    await notif.getNotifications('u1', { page: 1, limit: 20, type: 'ALERT' });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('AND type = $4');
    expect(params).toEqual(['u1', 20, 0, 'ALERT']);
  });

  it('shows placeholders when decryption fails', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'junk', body: 'junk', total_count: '1' }] });
    redisGet.mockResolvedValueOnce('0');
    pgDecryptMock.mockRejectedValue(new Error('bad key'));
    const res = await notif.getNotifications('u1', { page: 1, limit: 10 });
    expect(res.notifications[0]).toMatchObject({ title: '[Encrypted]', body: '[Encrypted]' });
  });
});

// ---------------------------------------------------------------------------
// deleteNotification
// ---------------------------------------------------------------------------
describe('notification.service — deleteNotification', () => {
  it('returns null when no notification matched', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await notif.deleteNotification('n1', 'u1')).toBeNull();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('soft-deletes, audits, and decrements the unread count', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'n1', is_read: false }] });
    redisGet.mockResolvedValueOnce('4');
    const res = await notif.deleteNotification('n1', 'u1');
    expect(res.id).toBe('n1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', entityId: 'n1' }));
    expect(redisDecr).toHaveBeenCalledWith('notif:unread:u1');
  });
});
