// DB-backed integration test for the R15 messaging guard functions.
//
// The socket guards now rely on isMember() + getMessageGroup() to prove, per
// event, that the caller is still a member of the named group and that a
// messageId actually lives in the supplied group. Those two SQL paths are what
// the socket's access control is built on — this test proves them against the
// real schema (users, message_groups, message_group_members, messages).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), incr: vi.fn().mockResolvedValue(1) },
  subscriber: {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { isMember, getMessageGroup } from '../../src/modules/messaging/messaging.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(prefix) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Msg', 'User', $2, $3)
     RETURNING id`,
    [uniq(prefix), uniq(prefix.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

describe('messaging — R15 (real DB)', () => {
  it('isMember reflects real membership and getMessageGroup resolves the real group', async () => {
    const memberId   = await seedUser('E-INT-MSG-M');
    const outsiderId = await seedUser('E-INT-MSG-O');

    const { rows: [g] } = await run(
      `INSERT INTO message_groups (id, name, type, created_by)
       VALUES (gen_random_uuid(), $1, 'GROUP', $2) RETURNING id`,
      [uniq('G-INT-MSG'), memberId]
    );
    await run(
      `INSERT INTO message_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'MEMBER')`,
      [g.id, memberId]
    );

    const { rows: [m] } = await run(
      `INSERT INTO messages (id, group_id, sender_id, content, encryption_iv)
       VALUES (gen_random_uuid(), $1, $2, 'ciphertext', 'iv') RETURNING id`,
      [g.id, memberId]
    );

    expect(await isMember(g.id, memberId)).toBe(true);
    expect(await isMember(g.id, outsiderId)).toBe(false);

    const resolved = await getMessageGroup(m.id);
    expect(resolved).toMatchObject({ group_id: g.id, sender_id: memberId });

    expect(await getMessageGroup('00000000-0000-0000-0000-000000000000')).toBeNull();

    // Exact guard the socket runs: message must live in the supplied group AND
    // the user must be a member. The outsider fails, the member passes.
    const msg = await getMessageGroup(m.id);
    const outsiderCan = msg && msg.group_id === g.id && (await isMember(g.id, outsiderId));
    const memberCan   = msg && msg.group_id === g.id && (await isMember(g.id, memberId));
    expect(outsiderCan).toBe(false);
    expect(memberCan).toBe(true);
  });
});
