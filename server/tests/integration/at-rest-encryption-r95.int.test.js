// DB-backed integration test for the R9.5 at-rest encryption gap:
// medical_records (chief_complaint, diagnosis, treatment_plan, notes) and
// ot_schedules.notes.
//
// Proves:
//   - medical_records.notes written via telemedicine endSession is stored
//     encrypted (not plaintext) and decrypts back to the plaintext;
//   - getMedicalRecordById / getPatientTimeline return plaintext to callers;
//   - ot_schedules.notes written via createOTSchedule is stored encrypted and
//     returned plaintext by getOTSchedule / getOTSchedules;
//   - updateOTSchedule re-encrypts notes and returns plaintext.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') },
  subscriber: {},
}));

vi.mock('bullmq', () => ({
  Queue: class {
    constructor() { this.add = vi.fn(); this.getJob = vi.fn().mockResolvedValue(null); }
  },
  Worker: class { constructor() { this.on = vi.fn(); } },
}));

vi.mock('../../src/shared/jobs/queue.js', () => ({
  emailQueue       : { add: vi.fn() },
  notificationQueue: { add: vi.fn() },
  reportQueue      : { add: vi.fn() },
  closeQueues      : vi.fn(),
}));

vi.mock('../../src/shared/services/notification.service.js', () => ({
  createNotification: vi.fn(async () => {}),
  NotificationType  : {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { pgDecrypt } from '../../src/shared/db/pgcrypto.js';
import { getMedicalRecordById, getPatientTimeline } from '../../src/modules/patient/patient.service.js';
import { endSession } from '../../src/modules/telemedicine/telemedicine.service.js';
import {
  createOTSchedule,
  getOTSchedule,
  getOTSchedules,
  updateOTSchedule,
} from '../../src/modules/ot-scheduling/ot.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(tag) {
  const { rows: [u] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'R9.5', $2, $3, $4) RETURNING id`,
    [uniq(tag), tag, uniq(tag.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return u.id;
}

async function seedPatient(userId) {
  const { rows: [p] } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender, user_id)
     VALUES (gen_random_uuid(), $1, 'R9.5', 'Patient', '1985-01-01', 'FEMALE', $2) RETURNING id`,
    [uniq('MRN-R95'), userId]
  );
  return p.id;
}

async function seedRoom() {
  const { rows: [r] } = await run(
    `INSERT INTO rooms (id, room_number, room_type)
     VALUES (gen_random_uuid(), $1, 'OT') RETURNING id`,
    [uniq('OT-R95')]
  );
  return r.id;
}

describe('R9.5 at-rest encryption — medical_records', () => {
  it('stores medical_records.notes encrypted (telemedicine) and returns plaintext', async () => {
    const doctor  = await seedUser('R95-DOC');
    const patient = await seedUser('R95-PAT');
    const patientId = await seedPatient(patient);

    const { rows: [appt] } = await run(
      `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, duration_minutes, type, status)
       VALUES (gen_random_uuid(), $1, $2, NOW() + interval '1 hour', 30, 'TELEMEDICINE', 'CONFIRMED') RETURNING id`,
      [patientId, doctor]
    );
    const { rows: [sess] } = await run(
      `INSERT INTO telemedicine_sessions (id, appointment_id, patient_id, doctor_id, room_token, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE') RETURNING id`,
      [appt.id, patientId, doctor, uniq('TELE-R95')]
    );

    await endSession(sess.id, doctor, { consultationNote: 'highly sensitive consultation note' }, '127.0.0.1', 'agent');

    const { rows: mrRows } = await run(
      `SELECT id, notes FROM medical_records WHERE patient_id = $1 LIMIT 1`,
      [patientId]
    );
    expect(mrRows.length).toBe(1);
    expect(mrRows[0].notes).not.toContain('sensitive');
    expect(await pgDecrypt(mrRows[0].notes)).toBe('highly sensitive consultation note');

    const record = await getMedicalRecordById(mrRows[0].id);
    expect(record.notes).toBe('highly sensitive consultation note');
  });

  it('getPatientTimeline decrypts medical-record notes', async () => {
    const doctor  = await seedUser('R95-DOC2');
    const patient = await seedUser('R95-PAT2');
    const patientId = await seedPatient(patient);

    await run(
      `INSERT INTO medical_records (id, patient_id, attending_doctor_id, notes)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [patientId, doctor, await pgEncryptRaw('timeline secret note')]
    );

    const timeline = await getPatientTimeline(patientId, { id: 'x', roles: ['ADMIN'] }, { page: 1, limit: 20 });
    const mrItem = timeline.items.find((i) => i.type === 'medical_record');
    expect(mrItem.notes).toBe('timeline secret note');
  });
});

describe('R9.5 at-rest encryption — ot_schedules.notes', () => {
  it('stores ot_schedules.notes encrypted on create and returns plaintext', async () => {
    const [doctor, anesthetist, patientId, roomId] = await Promise.all([
      seedUser('R95-OTDOC'), seedUser('R95-OTANE'), seedPatient(await seedUser('R95-OTPAT')), seedRoom(),
    ]);
    const { rows: [room] } = await run('SELECT room_number FROM rooms WHERE id = $1', [roomId]);

    const created = await createOTSchedule({
      patientId, doctorId: doctor, anesthetistId: anesthetist, theatre: room.room_number,
      scheduledAt: '2026-09-01T10:00:00', durationMinutes: 60,
      procedure: 'Appendectomy', notes: 'prepare blood unit A',
    }, doctor, null, '127.0.0.1');

    expect(created.notes).toBe('prepare blood unit A');

    const { rows: [raw] } = await run('SELECT notes FROM ot_schedules WHERE id = $1', [created.id]);
    expect(raw.notes).not.toContain('blood');
    expect(await pgDecrypt(raw.notes)).toBe('prepare blood unit A');

    const single = await getOTSchedule(created.id);
    expect(single.notes).toBe('prepare blood unit A');

    const list = await getOTSchedules({});
    expect(list.some((s) => s.id === created.id && s.notes === 'prepare blood unit A')).toBe(true);
  });

  it('re-encrypts notes on update and returns plaintext', async () => {
    const [doctor, patientId, roomId] = await Promise.all([
      seedUser('R95-OTDOC2'), seedPatient(await seedUser('R95-OTPAT2')), seedRoom(),
    ]);
    const { rows: [room] } = await run('SELECT room_number FROM rooms WHERE id = $1', [roomId]);

    const created = await createOTSchedule({
      patientId, doctorId: doctor, theatre: room.room_number,
      scheduledAt: '2026-09-02T10:00:00', durationMinutes: 60,
      procedure: 'Surgery', notes: 'first note',
    }, doctor, null, '127.0.0.1');

    const updated = await updateOTSchedule(created.id, { notes: 'updated secret' }, doctor, null, '127.0.0.1');
    expect(updated.notes).toBe('updated secret');

    const { rows: [raw] } = await run('SELECT notes FROM ot_schedules WHERE id = $1', [created.id]);
    expect(raw.notes).not.toContain('updated secret');
    expect(await pgDecrypt(raw.notes)).toBe('updated secret');
  });
});

// Local helper so we can seed ciphertext directly inside the test transaction
// without importing pgEncrypt (which reads the env key at module scope).
async function pgEncryptRaw(value) {
  const { rows } = await run(
    `SELECT encode(pgp_sym_encrypt($1::text, $2), 'hex') AS encrypted`,
    [value, process.env.PG_CRYPTO_KEY]
  );
  return rows[0].encrypted;
}
