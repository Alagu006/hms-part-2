// Coverage for the messaging module: groups, DM history with ownership
// scoping, message send/delete windows, reactions, read tracking, Redis
// pub/sub, and lazy AES-GCM group-key creation.

import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, clientQuery, withTx,
  redisGet, redisSetex, redisPublish, auditMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  clientQuery: vi.fn(),
  withTx: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  redisPublish: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTx,
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: { get: redisGet, setex: redisSetex, publish: redisPublish },
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

import * as msg from '../src/modules/messaging/messaging.service.js';

const originalKey = process.env.DB_ENCRYPTION_KEY;

function encKey(rawB64) {
  const masterKey = Buffer.from(process.env.DB_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const ct = Buffer.concat([cipher.update(rawB64, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DB_ENCRYPTION_KEY = 'ab'.repeat(32);
  withTx.mockImplementation(async (fn) => fn({ query: clientQuery }));
  auditMock.mockImplementation(async () => {});
  redisGet.mockImplementation(async () => null);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.DB_ENCRYPTION_KEY;
  else process.env.DB_ENCRYPTION_KEY = originalKey;
});

// ---------------------------------------------------------------------------
// getMessagingUsers / getUserGroups / getGroupMembers / isMember / addMember
// ---------------------------------------------------------------------------
describe('messaging.service — basic queries', () => {
  it('getMessagingUsers returns the directory rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'u2', first_name: 'A' }] });
    expect(await msg.getMessagingUsers('u1')).toEqual([{ id: 'u2', first_name: 'A' }]);
    expect(q.mock.calls[0][1]).toEqual(['u1']);
  });

  it('getUserGroups returns the group list', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'g1', unread_count: 2 }] });
    expect(await msg.getUserGroups('u1')).toEqual([{ id: 'g1', unread_count: 2 }]);
  });

  it('getGroupMembers returns member rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'ADMIN' }] });
    expect(await msg.getGroupMembers('g1')).toEqual([{ id: 'u1', role: 'ADMIN' }]);
  });

  it('isMember is true only when a row is returned', async () => {
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    expect(await msg.isMember('g1', 'u1')).toBe(true);
    q.mockResolvedValueOnce({ rows: [] });
    expect(await msg.isMember('g1', 'u1')).toBe(false);
  });

  it('addMember upserts the membership', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await msg.addMember('g1', 'u1');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (group_id, user_id) DO UPDATE');
    expect(params).toEqual(['g1', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateDepartmentGroup
// ---------------------------------------------------------------------------
describe('messaging.service — getOrCreateDepartmentGroup', () => {
  it('returns null when there is no department and no group name', async () => {
    expect(await msg.getOrCreateDepartmentGroup(null, 'u1', 'u1')).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });

  it('returns null when the department is missing and no fallback name', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await msg.getOrCreateDepartmentGroup('dep-x', 'u1', 'u1')).toBeNull();
  });

  it('reuses an existing group and joins the user', async () => {
    q.mockResolvedValueOnce({ rows: [{ name: 'Cardiology' }] }); // dept lookup
    q.mockResolvedValueOnce({ rows: [{ id: 'g1' }] });           // existing group
    const groupId = await msg.getOrCreateDepartmentGroup('dep1', 'u2', 'u1');
    expect(groupId).toBe('g1');
    // member insert
    expect(q.mock.calls[2][1]).toEqual(['g1', 'u2']);
  });

  it('creates the department group when none exists', async () => {
    q.mockResolvedValueOnce({ rows: [{ name: 'Cardiology' }] });
    q.mockResolvedValueOnce({ rows: [] }); // no existing
    q.mockResolvedValueOnce({ rows: [{ id: 'g-new' }] }); // create
    const groupId = await msg.getOrCreateDepartmentGroup('dep1', 'u2', 'u1');
    expect(groupId).toBe('g-new');
    expect(q.mock.calls[2][0]).toContain("'DEPARTMENT'");
    expect(q.mock.calls[2][1]).toEqual(['Cardiology', 'u1']);
  });

  it('uses the provided name when no departmentId is given', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'g1' }] }); // existing group by name
    const groupId = await msg.getOrCreateDepartmentGroup(null, 'u2', 'u1', 'Nursing');
    expect(groupId).toBe('g1');
    expect(q.mock.calls[0][1]).toEqual(['Nursing']);
  });
});

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------
describe('messaging.service — createGroup', () => {
  it('creates the group and members with creator as ADMIN', async () => {
    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO message_groups')
      ? { rows: [{ id: 'g1', name: 'Team', type: 'GROUP' }] }
      : { rows: [] });

    const res = await msg.createGroup('Team', 'GROUP', 'u1', ['u2', 'u3']);
    expect(res.id).toBe('g1');

    const memberInserts = clientQuery.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO message_group_members'));
    expect(memberInserts).toHaveLength(3);
    expect(memberInserts[0][1]).toEqual(['g1', 'u1', 'ADMIN']);
    expect(memberInserts[1][1]).toEqual(['g1', 'u2', 'MEMBER']);
    expect(memberInserts[2][1]).toEqual(['g1', 'u3', 'MEMBER']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'CREATE', 'message_groups', 'g1', null, { name: 'Team', type: 'GROUP' });
  });

  it('dedupes member ids', async () => {
    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO message_groups')
      ? { rows: [{ id: 'g1' }] } : { rows: [] });
    await msg.createGroup('Team', 'GROUP', 'u1', ['u1', 'u2', 'u2']);
    const memberInserts = clientQuery.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO message_group_members'));
    expect(memberInserts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// saveMessage
// ---------------------------------------------------------------------------
describe('messaging.service — saveMessage', () => {
  it('stores ciphertext verbatim and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', group_id: 'g1', content: 'CIPHER' }] });
    q.mockResolvedValueOnce({ rows: [] });
    const res = await msg.saveMessage({ groupId: 'g1', senderId: 'u1', content: 'CIPHER', encryptionIv: 'iv', replyToId: 'm0' });
    expect(res.content).toBe('CIPHER');
    expect(q.mock.calls[0][1]).toEqual(['g1', 'u1', 'CIPHER', 'iv', 'm0']);
    expect(q.mock.calls[1][0]).toContain('UPDATE message_groups SET updated_at = NOW()');
    expect(auditMock).toHaveBeenCalledWith('u1', 'CREATE', 'messages', 'm1', null, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// getGroupHistory — membership scoping
// ---------------------------------------------------------------------------
describe('messaging.service — getGroupHistory', () => {
  it('FORBIDDEN for non-members', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await msg.getGroupHistory('g1', 'u1', { page: 1, limit: 50 })).toBe('FORBIDDEN');
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('returns messages newest-first with total and marks the group read', async () => {
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // isMember
    q.mockResolvedValueOnce({ rows: [
      { id: 'm2', sender_name: 'A B', total_count: '2' },
      { id: 'm1', sender_name: 'A B', total_count: '2' },
    ] });
    q.mockResolvedValueOnce({ rows: [] }); // last_read_at update

    const res = await msg.getGroupHistory('g1', 'u1', { page: 1, limit: 10 });
    expect(res.total).toBe(2);
    // rows reversed → oldest first
    expect(res.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(q.mock.calls[1][1]).toEqual(['g1', 10, 0]);
    expect(q.mock.calls[2][1]).toEqual(['g1', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// getDMHistory
// ---------------------------------------------------------------------------
describe('messaging.service — getDMHistory', () => {
  it('reuses an existing DIRECT group', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'g1' }] }); // existing DM
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] });     // isMember
    q.mockResolvedValueOnce({ rows: [] });             // history
    q.mockResolvedValueOnce({ rows: [] });             // last read

    const res = await msg.getDMHistory('u1', 'u2', { page: 1, limit: 20 });
    expect(res.messages).toEqual([]);
    expect(q.mock.calls[0][1]).toEqual(['u1', 'u2']);
  });

  it('creates a DM group when none exists', async () => {
    q.mockResolvedValueOnce({ rows: [] });             // no existing DM
    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO message_groups')
      ? { rows: [{ id: 'g-new' }] } : { rows: [] });
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] });     // isMember
    q.mockResolvedValueOnce({ rows: [] });             // history
    q.mockResolvedValueOnce({ rows: [] });             // last read

    const res = await msg.getDMHistory('u1', 'u2', { page: 1, limit: 20 });
    expect(res.messages).toEqual([]);
    expect(withTx).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO message_groups'))[1]).toEqual([null, 'DIRECT', 'u1']);
  });
});

// ---------------------------------------------------------------------------
// deleteMessage — ownership + 5-minute window
// ---------------------------------------------------------------------------
describe('messaging.service — deleteMessage', () => {
  const recent = () => new Date(Date.now() - 60_000).toISOString();
  const old = () => new Date(Date.now() - 10 * 60_000).toISOString();

  it('returns null when the message is missing or already deleted', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await msg.deleteMessage('m1', 'u1')).toBeNull();
  });

  it('FORBIDDEN when the user is not the sender', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', sender_id: 'other', sent_at: recent() }] });
    expect(await msg.deleteMessage('m1', 'u1')).toBe('FORBIDDEN');
  });

  it('deletes for everyone within the 5-minute window', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', sender_id: 'u1', sent_at: recent() }] });
    q.mockResolvedValueOnce({ rows: [] });
    const res = await msg.deleteMessage('m1', 'u1');
    expect(res).toEqual({ messageId: 'm1', deleteForEveryone: true });
    expect(q.mock.calls[1][0]).toContain("SET is_deleted = TRUE, content = ''");
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'messages', 'm1', expect.anything(), { deleted: true });
  });

  it('hides the message for the user only after the window', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', sender_id: 'u1', sent_at: old() }] });
    q.mockResolvedValueOnce({ rows: [] });
    const res = await msg.deleteMessage('m1', 'u1');
    expect(res).toEqual({ messageId: 'm1', deleteForEveryone: false });
    expect(q.mock.calls[1][0]).toContain('INSERT INTO message_hidden');
    expect(q.mock.calls[1][1]).toEqual(['m1', 'u1']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'messages', 'm1', expect.anything(), { hidden: true });
  });
});

// ---------------------------------------------------------------------------
// addReaction / removeReaction / getPinnedMessages / getReactions
// ---------------------------------------------------------------------------
describe('messaging.service — reactions & pinned', () => {
  it('addReaction upserts, returns the reaction rows, and audits', async () => {
    q.mockResolvedValueOnce({ rows: [] }); // upsert
    q.mockResolvedValueOnce({ rows: [{ emoji: '👍', user_id: 'u1' }] }); // select
    const res = await msg.addReaction('m1', 'u1', '👍');
    expect(res).toEqual([{ emoji: '👍', user_id: 'u1' }]);
    expect(q.mock.calls[0][1]).toEqual(['m1', 'u1', '👍']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'message_reactions', null, null, { messageId: 'm1', emoji: '👍', action: 'ADD' });
  });

  it('removeReaction deletes and audits', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await msg.removeReaction('m1', 'u1', '👍');
    expect(q.mock.calls[0][0]).toContain('DELETE FROM message_reactions');
    expect(q.mock.calls[0][1]).toEqual(['m1', 'u1', '👍']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'message_reactions', null, null, { messageId: 'm1', emoji: '👍', action: 'REMOVE' });
  });

  it('getPinnedMessages returns the pinned rows', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', pinned_by: 'u1' }] });
    expect(await msg.getPinnedMessages('g1')).toEqual([{ id: 'm1', pinned_by: 'u1' }]);
  });

  it('getReactions returns the query result', async () => {
    q.mockResolvedValueOnce({ rows: [{ emoji: '👍', user_id: 'u1' }] });
    expect(await msg.getReactions('m1')).toEqual({ rows: [{ emoji: '👍', user_id: 'u1' }] });
  });
});

// ---------------------------------------------------------------------------
// markGroupRead / markMessageRead / purgeOldMessages
// ---------------------------------------------------------------------------
describe('messaging.service — read tracking & purge', () => {
  it('markGroupRead updates last_read_at and audits', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await msg.markGroupRead('g1', 'u1');
    expect(q.mock.calls[0][1]).toEqual(['g1', 'u1']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'message_group_members', null, null, { groupId: 'g1', action: 'MARK_READ' });
  });

  it('markMessageRead returns null for a missing message', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await msg.markMessageRead('m1', 'u1')).toBeNull();
  });

  it('markMessageRead records the read and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1' }] });
    q.mockResolvedValueOnce({ rows: [] });
    const res = await msg.markMessageRead('m1', 'u1');
    expect(res).toEqual({ messageId: 'm1', userId: 'u1' });
    expect(q.mock.calls[1][1]).toEqual(['m1', 'u1']);
    expect(auditMock).toHaveBeenCalledWith('u1', 'UPDATE', 'message_reads', null, null, { messageId: 'm1', action: 'MARK_READ' });
  });

  it('purgeOldMessages updates and audits the count', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'm1' }, { id: 'm2' }] });
    const res = await msg.purgeOldMessages('g1', '2026-01-01', 'u-admin');
    expect(res).toEqual({ deletedCount: 2, messageIds: ['m1', 'm2'] });
    expect(q.mock.calls[0][1]).toEqual(['g1', '2026-01-01']);
    expect(auditMock).toHaveBeenCalledWith('u-admin', 'DELETE', 'messages', null, null, expect.objectContaining({ count: 2, action: 'PURGE_OLD_MESSAGES' }));
  });
});

// ---------------------------------------------------------------------------
// publishEvent
// ---------------------------------------------------------------------------
describe('messaging.service — publishEvent', () => {
  it('publishes a JSON payload on the messaging channel', async () => {
    redisPublish.mockResolvedValueOnce(1);
    await msg.publishEvent('message:new', { groupId: 'g1' });
    expect(redisPublish).toHaveBeenCalledWith('messaging:events', JSON.stringify({ event: 'message:new', payload: { groupId: 'g1' } }));
    expect(msg.PUBSUB_CHANNEL).toBe('messaging:events');
  });
});

// ---------------------------------------------------------------------------
// getOrCreateGroupKey — lazy AES-GCM key management
// ---------------------------------------------------------------------------
describe('messaging.service — getOrCreateGroupKey', () => {
  it('returns the cached key from Redis without touching the DB', async () => {
    redisGet.mockResolvedValueOnce('cached-key');
    expect(await msg.getOrCreateGroupKey('g1')).toBe('cached-key');
    expect(q).not.toHaveBeenCalled();
  });

  it('decrypts and caches an existing stored key', async () => {
    redisGet.mockResolvedValueOnce(null);
    const raw = crypto.randomBytes(32).toString('base64');
    q.mockResolvedValueOnce({ rows: [{ group_key: encKey(raw) }] });
    const key = await msg.getOrCreateGroupKey('g1');
    expect(key).toBe(raw);
    expect(redisSetex).toHaveBeenCalledWith('groupkey:g1', 3600, raw);
  });

  it('generates, stores, and re-fetches a brand-new key', async () => {
    redisGet.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [] }); // SELECT — none
    q.mockResolvedValueOnce({ rows: [] }); // INSERT
    q.mockResolvedValueOnce({ rows: [] }); // re-fetch — none (race lost)

    const key = await msg.getOrCreateGroupKey('g1');
    expect(key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(key, 'base64')).toHaveLength(32);

    const insert = q.mock.calls[1];
    expect(insert[0]).toContain('ON CONFLICT (group_id) DO NOTHING');
    expect(insert[1][0]).toBe('g1');
    expect(insert[1][1]).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/); // iv:tag:ct

    expect(redisSetex).toHaveBeenCalledWith('groupkey:g1', 3600, key);
  });

  it('throws when DB_ENCRYPTION_KEY is not 32 bytes', async () => {
    redisGet.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [] });
    const original = process.env.DB_ENCRYPTION_KEY;
    process.env.DB_ENCRYPTION_KEY = 'abc';
    await expect(msg.getOrCreateGroupKey('g1')).rejects.toThrow('DB_ENCRYPTION_KEY must be a 64-char hex string');
    if (original === undefined) delete process.env.DB_ENCRYPTION_KEY;
    else process.env.DB_ENCRYPTION_KEY = original;
  });
});
