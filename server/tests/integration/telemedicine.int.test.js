// DB-backed integration test for the R16 telemedicine room gate.
//
// The socket only ever admits a socket into a room via tele:join, and tele:join
// calls validateParticipant() — the one place socket.data.roomId is set. This
// test proves validateParticipant() against the real schema: the doctor and the
// linked patient user pass, an outsider and an unknown room token do not.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') },
  subscriber: {},
}));

vi.mock('../../src/shared/jobs/queue.js', () => ({
  emailQueue       : { add: vi.fn() },
  notificationQueue: { add: vi.fn() },
  reportQueue      : { add: vi.fn() },
  closeQueues      : vi.fn(),
}));

vi.mock('../../src/shared/services/notification.service.js', () => ({
  createNotification: vi.fn(),
  NotificationType  : {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { validateParticipant } from '../../src/modules/telemedicine/telemedicine.socket.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(prefix) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Tele', 'User', $2, $3)
     RETURNING id`,
    [uniq(prefix), uniq(prefix.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

describe('telemedicine — R16 validateParticipant (real DB)', () => {
  it('admits only the doctor and linked patient user for a room token', async () => {
    const doctorId   = await seedUser('E-INT-TEL-DOC');
    const patientUserId = await seedUser('E-INT-TEL-PAT');
    const outsiderId = await seedUser('E-INT-TEL-OUT');

    const { rows: [pat] } = await run(
      `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender, user_id)
       VALUES (gen_random_uuid(), $1, 'Tele', 'Patient', '1990-01-01', 'FEMALE', $2)
       RETURNING id`,
      [uniq('MRN-INT-TEL'), patientUserId]
    );

    const { rows: [appt] } = await run(
      `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, duration_minutes, type, status)
       VALUES (gen_random_uuid(), $1, $2, NOW() + interval '1 hour', 30, 'TELEMEDICINE', 'CONFIRMED')
       RETURNING id`,
      [pat.id, doctorId]
    );

    const { rows: [sess] } = await run(
      `INSERT INTO telemedicine_sessions (id, appointment_id, patient_id, doctor_id, room_token, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE')
       RETURNING id, room_token`,
      [appt.id, pat.id, doctorId, uniq('TELE-ROOM')]
    );

    const asDoctor  = await validateParticipant(sess.room_token, doctorId);
    const asPatient = await validateParticipant(sess.room_token, patientUserId);
    const asOutsider = await validateParticipant(sess.room_token, outsiderId);
    const unknownToken = await validateParticipant('bogus-room-token', doctorId);

    expect(asDoctor).toMatchObject({ role: 'doctor' });
    expect(asDoctor.session.id).toBe(sess.id);
    expect(asPatient).toMatchObject({ role: 'patient' });
    expect(asPatient.session.id).toBe(sess.id);
    expect(asOutsider).toBeNull();
    expect(unknownToken).toBeNull();
  });
});
