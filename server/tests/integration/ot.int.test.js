// DB-backed integration test for OT scheduling conflict integrity.
//
// createOTSchedule() used to run checkConflict() and the INSERT as separate
// auto-commit queries — two concurrent bookings for the same theatre could
// both pass the overlap check and double-book. The conflict check + write now
// run inside withTransaction() with the theatre room row locked FOR UPDATE.
// This test proves the overlap detection against the real schema; the
// concurrent two-connection serialisation is proven by the live-verify script.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null) },
  subscriber: {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import {
  createOTSchedule,
  updateOTSchedule,
} from '../../src/modules/ot-scheduling/ot.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser() {
  const { rows } = await run(
    `INSERT INTO users (id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), 'OT', 'Doc', $1, $2)
     RETURNING id`,
    [uniq('otdoc') + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedPatient() {
  const { rows } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (gen_random_uuid(), $1, 'OT', 'Patient', '1980-01-01', 'MALE')
     RETURNING id`,
    [uniq('MRN-INT-OT')]
  );
  return rows[0].id;
}

async function seedRoom() {
  const { rows } = await run(
    `INSERT INTO rooms (id, room_number, room_type)
     VALUES (gen_random_uuid(), $1, 'OT')
     RETURNING id`,
    [uniq('OT-THEATRE')]
  );
  return rows[0].id;
}

const base = {
  patientId: null, doctorId: null, theatre: null,
  durationMinutes: 60, procedure: 'Surgery',
};

describe('ot.service — conflict integrity (real DB)', () => {
  it('rejects overlapping bookings, allows adjacent slots, and guards updates', async () => {
    const [doctorId, anesthetistId, patientId, roomId] = await Promise.all([
      seedUser(), seedUser(), seedPatient(), seedRoom(),
    ]);
    const { rows: [room] } = await run(`SELECT room_number FROM rooms WHERE id = $1`, [roomId]);
    const theatre = room.room_number;

    // First booking 10:00-11:00 succeeds.
    const first = await createOTSchedule({
      ...base, patientId, doctorId, anesthetistId, theatre,
      scheduledAt: '2026-09-01T10:00:00',
    }, doctorId, null, '127.0.0.1');
    expect(first.id).toBeTruthy();

    // Overlapping 10:30-11:30 -> 409.
    await expect(
      createOTSchedule({
        ...base, patientId, doctorId, anesthetistId, theatre,
        scheduledAt: '2026-09-01T10:30:00',
      }, doctorId, null, '127.0.0.1')
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('already booked') });

    // Adjacent 11:00-12:00 (start == prior end, no overlap) -> succeeds.
    const adjacent = await createOTSchedule({
      ...base, patientId, doctorId, anesthetistId, theatre,
      scheduledAt: '2026-09-01T11:00:00',
    }, doctorId, null, '127.0.0.1');
    expect(adjacent.id).toBeTruthy();

    // Updating the first booking onto an occupied slot (11:30-12:00) -> 409.
    await expect(
      updateOTSchedule(first.id, {
        scheduledAt: '2026-09-01T11:30:00', durationMinutes: 30,
      }, doctorId, null, '127.0.0.1')
    ).rejects.toMatchObject({ status: 409 });

    // Updating onto a free slot (13:00-14:00) -> succeeds.
    const updated = await updateOTSchedule(first.id, {
      scheduledAt: '2026-09-01T13:00:00', durationMinutes: 60,
    }, doctorId, null, '127.0.0.1');
    expect(updated.id).toBe(first.id);
  });
});
