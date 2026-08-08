// R15 regression tests — messaging sockets must NOT trust client-supplied
// groupId/messageId. Every per-event handler now proves the user is still a
// member of the named group, and message events resolve the message's REAL
// group server-side. These tests drive each handler with a mocked service and
// assert the guards fire BEFORE any service mutation / fan-out.

import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(() => ({ sub: 'user1', roles: ['DOCTOR'], firstName: 'A', lastName: 'B' })),
}));

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn(() => 'fake-public-key') },
  readFileSync: vi.fn(() => 'fake-public-key'),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: {
    setex: vi.fn().mockResolvedValue('OK'),
    del  : vi.fn().mockResolvedValue(1),
  },
  subscriber: { subscribe: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
}));

const { isMember, getMessageGroup, publishEvent, markGroupRead, addReaction, removeReaction, deleteMessage, getReactions } = vi.hoisted(() => ({
  isMember       : vi.fn(),
  getMessageGroup: vi.fn(),
  publishEvent   : vi.fn().mockResolvedValue(undefined),
  markGroupRead  : vi.fn().mockResolvedValue(undefined),
  addReaction    : vi.fn().mockResolvedValue([]),
  removeReaction : vi.fn().mockResolvedValue(undefined),
  deleteMessage  : vi.fn().mockResolvedValue({ messageId: 'm1', deleteForEveryone: true }),
  getReactions   : vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../src/modules/messaging/messaging.service.js', () => ({
  PUBSUB_CHANNEL : 'messaging:events',
  getUserGroups  : vi.fn().mockResolvedValue([]),
  publishEvent,
  isMember,
  getMessageGroup,
  saveMessage     : vi.fn(),
  markGroupRead,
  addReaction,
  removeReaction,
  deleteMessage,
  getReactions,
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerMessagingSocket } from '../src/modules/messaging/messaging.socket.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const captured = [];
  const ns = {
    use: vi.fn(),
    on: vi.fn(),
    to: (target) => ({ emit: (event, payload) => captured.push({ kind: 'ns', target, event, payload }) }),
    in: () => ({ fetchSockets: vi.fn().mockResolvedValue([]) }),
  };
  const io = { of: vi.fn(() => ns) };

  const socket = new EventEmitter();
  socket.user  = { id: 'user1', firstName: 'A', lastName: 'B' };
  socket.data  = {};
  socket.join  = vi.fn();
  socket.leave = vi.fn();
  socket.to = (room) => ({ emit: (event, payload) => captured.push({ kind: 'socket', room, event, payload }) });

  registerMessagingSocket(io);
  const connHandler = ns.on.mock.calls.find(([e]) => e === 'connection')[1];
  // Await the (async) connection handler — it only registers the per-event
  // listeners AFTER awaiting getUserGroups. Then drop the connection-time
  // user:online publish so assertions see only event-handler calls.
  await connHandler(socket);
  vi.clearAllMocks();

  return { captured, socket };
}

beforeEach(() => {
  vi.clearAllMocks();
  isMember.mockResolvedValue(false);
  getMessageGroup.mockResolvedValue({ id: 'm1', group_id: 'g1', sender_id: 'user2' });
});

describe('messaging socket — R15 per-event membership guards', () => {
  it('message:delivered — blocks a non-member and lets a member fan out', async () => {
    const { socket, captured } = await setup();

    socket.emit('message:delivered', { messageId: 'm1', groupId: 'g1' });
    await flush();
    expect(publishEvent).not.toHaveBeenCalled();

    isMember.mockResolvedValue(true);
    socket.emit('message:delivered', { messageId: 'm1', groupId: 'g1' });
    await flush();
    expect(publishEvent).toHaveBeenCalledWith('message:delivered', { messageId: 'm1', groupId: 'g1', userId: 'user1' });
    expect(captured).toHaveLength(0);
  });

  it('message:delivered — rejects when the message does not live in the supplied group', async () => {
    const { socket } = await setup();
    getMessageGroup.mockResolvedValue({ id: 'm1', group_id: 'g2', sender_id: 'user2' });

    socket.emit('message:delivered', { messageId: 'm1', groupId: 'g1' });
    await flush();
    expect(isMember).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('message:read — blocks a non-member from marking a group read', async () => {
    const { socket } = await setup();

    socket.emit('message:read', { groupId: 'g1', lastReadMessageId: 'm5' });
    await flush();
    expect(markGroupRead).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();

    isMember.mockResolvedValue(true);
    socket.emit('message:read', { groupId: 'g1', lastReadMessageId: 'm5' });
    await flush();
    expect(markGroupRead).toHaveBeenCalledWith('g1', 'user1');
    expect(publishEvent).toHaveBeenCalledWith('message:read', { groupId: 'g1', userId: 'user1', lastReadMessageId: 'm5' });
  });

  it('typing:start / typing:stop — no emit for non-members, emit for members', async () => {
    const { socket, captured } = await setup();

    socket.emit('typing:start', { groupId: 'g1' });
    await flush();
    expect(captured).toHaveLength(0);

    socket.emit('typing:stop', { groupId: 'g1' });
    await flush();
    expect(captured).toHaveLength(0);

    isMember.mockResolvedValue(true);
    socket.emit('typing:start', { groupId: 'g1' });
    await flush();
    const typingEmits = captured.filter((c) => c.event.startsWith('typing:'));
    expect(typingEmits[0]).toMatchObject({ room: 'group:g1', event: 'typing:start' });
  });

  it('message:react — blocks a non-member / cross-group reaction', async () => {
    const { socket } = await setup();
    const ack = vi.fn();

    // not a member of g1
    socket.emit('message:react', { messageId: 'm1', groupId: 'g1', emoji: '👍' }, ack);
    await flush();
    expect(addReaction).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ error: 'Forbidden' });

    // message lives in a different group than supplied
    getMessageGroup.mockResolvedValue({ id: 'm1', group_id: 'g2', sender_id: 'user2' });
    isMember.mockResolvedValue(true);
    socket.emit('message:react', { messageId: 'm1', groupId: 'g1', emoji: '👍' }, ack);
    await flush();
    expect(addReaction).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ error: 'Forbidden' });

    // member + correct group → allowed
    getMessageGroup.mockResolvedValue({ id: 'm1', group_id: 'g1', sender_id: 'user2' });
    socket.emit('message:react', { messageId: 'm1', groupId: 'g1', emoji: '👍' }, ack);
    await flush();
    expect(addReaction).toHaveBeenCalledWith('m1', 'user1', '👍');
    expect(ack).toHaveBeenLastCalledWith({ ok: true });
  });

  it('message:unreact — blocks a non-member', async () => {
    const { socket } = await setup();
    const ack = vi.fn();

    socket.emit('message:unreact', { messageId: 'm1', groupId: 'g1', emoji: '👍' }, ack);
    await flush();
    expect(removeReaction).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ error: 'Forbidden' });

    isMember.mockResolvedValue(true);
    socket.emit('message:unreact', { messageId: 'm1', groupId: 'g1', emoji: '👍' }, ack);
    await flush();
    expect(removeReaction).toHaveBeenCalledWith('m1', 'user1', '👍');
    expect(ack).toHaveBeenLastCalledWith({ ok: true });
  });

  it('message:delete — rejects a spoofed groupId and fans out to the real group', async () => {
    const { socket } = await setup();
    const ack = vi.fn();

    // client claims the message is in g2, but it is really in g1 → blocked
    socket.emit('message:delete', { messageId: 'm1', groupId: 'g2' }, ack);
    await flush();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(publishEvent).not.toHaveBeenCalled();

    // correct group → delete + fan-out to the server-resolved group
    socket.emit('message:delete', { messageId: 'm1', groupId: 'g1' }, ack);
    await flush();
    expect(deleteMessage).toHaveBeenCalledWith('m1', 'user1');
    expect(publishEvent).toHaveBeenCalledWith('message:deleted', {
      groupId: 'g1',
      messageId: 'm1',
      deleteForEveryone: true,
    });
    expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, messageId: 'm1' }));
  });

  it('message:delete — delete-for-me (non everyone) does not fan out', async () => {
    const { socket } = await setup();
    const ack = vi.fn();
    isMember.mockResolvedValue(true);
    deleteMessage.mockResolvedValue({ messageId: 'm1', deleteForEveryone: false });

    socket.emit('message:delete', { messageId: 'm1', groupId: 'g1' }, ack);
    await flush();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
