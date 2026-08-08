// Server-side relay test for the telemedicine chat key-agreement handshake.
//
// tele:key-exchange relays each participant's ECDH PUBLIC key (JWK) to the
// room (or to a specific socket). Only authenticated, room-validated members
// can be in the room (gated by tele:join), so public keys are never exposed
// outside the session. The derived AES key never crosses the wire.

import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(() => ({ sub: 'user1', roles: ['DOCTOR'], firstName: 'A', lastName: 'B' })),
}));

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn(() => 'fake-public-key') },
  readFileSync: vi.fn(() => 'fake-public-key'),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query            : vi.fn(),
  pool             : { query: vi.fn(), connect: vi.fn() },
  withTransaction  : vi.fn(),
}));

vi.mock('../src/modules/telemedicine/telemedicine.service.js', () => ({
  verifyRoomId: vi.fn(() => true),
}));

import { registerTelemedicineSocket } from '../src/modules/telemedicine/telemedicine.socket.js';

const PUBKEY = { kty: 'EC', crv: 'P-256', x: 'AAAB', y: 'AAAC' };

function setup() {
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

  registerTelemedicineSocket(io);
  const connHandler = ns.on.mock.calls.find(([e]) => e === 'connection')[1];
  connHandler(socket);

  return { captured, socket };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('telemedicine socket — tele:key-exchange relay', () => {
  it('broadcasts a participant public key to the room', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1'; // simulated prior validated tele:join
    socket.emit('tele:key-exchange', { roomId: 'room1', publicKey: PUBKEY });

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('socket');
    expect(captured[0].room).toBe('tele:room1');
    expect(captured[0].event).toBe('tele:key-exchange');
    expect(captured[0].payload).toMatchObject({ fromUserId: 'user1', publicKey: PUBKEY });
    expect(captured[0].payload).not.toHaveProperty('privateKey');
  });

  it('targets a specific socket when targetSocketId is provided', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1';
    socket.emit('tele:key-exchange', { roomId: 'room1', publicKey: PUBKEY, targetSocketId: 'sockA' });

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('ns');
    expect(captured[0].target).toBe('sockA');
    expect(captured[0].payload).toMatchObject({ fromUserId: 'user1', publicKey: PUBKEY });
  });

  it('ignores payloads without a public key', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1';
    socket.emit('tele:key-exchange', { roomId: 'room1' });
    expect(captured).toHaveLength(0);
  });
});

describe('telemedicine socket — R16 room-membership guard', () => {
  it('drops key-exchange/signal/chat/admit for a room the socket never joined', () => {
    const { captured, socket } = setup();
    // No tele:join → socket.data.roomId is unset. All relays must be dropped.
    socket.emit('tele:key-exchange', { roomId: 'room1', publicKey: PUBKEY });
    socket.emit('tele:signal', { roomId: 'room1', signal: 'SDP' });
    socket.emit('tele:chat', { roomId: 'room1', ciphertext: 'x', iv: 'iv' });
    socket.emit('tele:admit', { roomId: 'room1', targetUserId: 'user2' });
    expect(captured).toHaveLength(0);
  });

  it('drops relays that name a different room than the one joined', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1'; // joined room1 via validated tele:join

    // Attacker tries to inject into a room they are NOT in.
    socket.emit('tele:signal', { roomId: 'room2', signal: 'SDP' });
    socket.emit('tele:chat', { roomId: 'room2', ciphertext: 'x', iv: 'iv' });
    socket.emit('tele:key-exchange', { roomId: 'room2', publicKey: PUBKEY });
    socket.emit('tele:admit', { roomId: 'room2', targetUserId: 'user2' });
    socket.emit('tele:leave', { roomId: 'room2' });
    expect(captured).toHaveLength(0);
  });

  it('relays only into the room the socket actually joined', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1';

    socket.emit('tele:signal', { roomId: 'room1', signal: 'SDP' });
    socket.emit('tele:chat', { roomId: 'room1', ciphertext: 'x', iv: 'iv' });
    expect(captured.map((c) => c.event)).toEqual(['tele:signal', 'tele:chat']);
    expect(captured.every((c) => c.room === 'tele:room1')).toBe(true);
  });

  it('clears the room on leave so no further relays are accepted', () => {
    const { captured, socket } = setup();
    socket.data.roomId = 'room1';

    socket.emit('tele:leave', { roomId: 'room1' });
    expect(captured.some((c) => c.event === 'tele:peer-left')).toBe(true);
    expect(socket.data.roomId).toBeNull();

    socket.emit('tele:key-exchange', { roomId: 'room1', publicKey: PUBKEY });
    expect(captured.filter((c) => c.event === 'tele:key-exchange')).toHaveLength(0);
  });
});
