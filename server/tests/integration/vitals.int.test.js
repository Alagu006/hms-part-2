// DB-backed integration test for the critical-vitals alert path.
//
// triggerAlerts() used `SELECT DISTINCT u.id,... ORDER BY mr.visit_date DESC`
// — with SELECT DISTINCT the ORDER BY column must be in the select list, so the
// query threw on Postgres and NO critical alert ever fired (patient-safety
// issue). The query now uses DISTINCT ON (u.id). This test verifies the real
// query against the real schema and that alert jobs are enqueued.

import { describe, it, expect, vi } from 'vitest';

const { notifAdd } = vi.hoisted(() => ({ notifAdd: vi.fn() }));
vi.mock('../../src/shared/jobs/queue.js', () => ({
  notificationQueue: { add: notifAdd },
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { recordVitals } from '../../src/modules/vitals/vitals.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedDoctor() {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Vitals', 'Doc', $2, $3)
     RETURNING id`,
    [uniq('E-INT-VDOC'), uniq('vitalsdoc') + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedPatient() {
  const { rows } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (gen_random_uuid(), $1, 'Vitals', 'Patient', '1978-07-07', 'MALE')
     RETURNING id`,
    [uniq('MRN-INT-VIT')]
  );
  return rows[0].id;
}

async function seedRecordAndNurse(patientId, doctorId) {
  const { rows: [mr] } = await run(
    `INSERT INTO medical_records (id, patient_id, attending_doctor_id, chief_complaint)
     VALUES (gen_random_uuid(), $1, $2, 'vitals check') RETURNING id`,
    [patientId, doctorId]
  );
  const { rows: [nurse] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Vitals', 'Nurse', $2, $3)
     RETURNING id`,
    [uniq('E-INT-VNURSE'), uniq('vitalsnurse') + '@example.com', 'x'.repeat(60)]
  );
  return { medicalRecordId: mr.id, nurseId: nurse.id };
}

describe('vitals — critical alert path against the real schema', () => {
  it('fires alert jobs for the assigned doctor and nurses when vitals are critical', async () => {
    const doctorId = await seedDoctor();
    const patientId = await seedPatient();
    const { medicalRecordId, nurseId } = await seedRecordAndNurse(patientId, doctorId);
    notifAdd.mockClear();

    await recordVitals(
      {
        patientId,
        medicalRecordId,
        spo2: 90, // below 94 → critical
        pulseBpm: 120,
      },
      nurseId,
      '127.0.0.1',
      'integration-test'
    );

    // triggerAlerts is fire-and-forget — wait for the async job enqueues.
    await vi.waitFor(() => expect(notifAdd).toHaveBeenCalled());
    const calls = notifAdd.mock.calls;
    expect(calls.some(([, j]) => j.userId === doctorId && j.type === 'ALERT')).toBe(true);
    expect(calls.some(([, j]) => j.targetRole === 'NURSE')).toBe(true);
  });

  it('does not fire alerts when vitals are within range', async () => {
    const doctorId = await seedDoctor();
    const patientId = await seedPatient();
    const { medicalRecordId, nurseId } = await seedRecordAndNurse(patientId, doctorId);
    notifAdd.mockClear();

    await recordVitals(
      {
        patientId,
        medicalRecordId,
        spo2: 98,
        pulseBpm: 72,
      },
      nurseId,
      '127.0.0.1',
      'integration-test'
    );

    expect(notifAdd).not.toHaveBeenCalled();
  });
});
