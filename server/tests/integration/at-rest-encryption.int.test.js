// DB-backed integration test for at-rest encryption (R9).
//
// Proves that appointments.reason, incidents.description and the
// discharge_summaries free-text columns are actually stored encrypted:
//   - the service returns plaintext to callers,
//   - the raw column no longer contains the plaintext,
//   - the raw column decrypts back to the plaintext via pgp_sym_decrypt.
// Also proves legacy plaintext rows (pre-migration) read back as null instead
// of crashing the decrypt-on-read path.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTestDb, run } from '../../test-setup/testDb.js';
import { pgDecrypt } from '../../src/shared/db/pgcrypto.js';
import { createAppointment, getAppointmentById } from '../../src/modules/appointments/appointments.service.js';
import { createIncident, getIncidents } from '../../src/modules/incidents/incident.service.js';
import { createDischargeSummary, getPatientDischargeSummaries } from '../../src/modules/discharge/discharge.service.js';

// createAppointment() schedules its patient notification via setImmediate().
// That async callback runs on the SHARED test connection mid-test and, when it
// fires, its INSERT can violate a constraint (e.g. referencing rows from a
// previous test that were already rolled back), which aborts the whole outer
// transaction and fails unrelated tests. The encryption assertions below do not
// exercise notifications, so stub them out to keep the flow deterministic.
vi.mock('../../src/shared/services/notification.service.js', () => ({
  NotificationType: { APPOINTMENT_BOOKED: 'APPOINTMENT_BOOKED' },
  createNotification: vi.fn(async () => {}),
}));

useTestDb();

let mrnCounter = 0;

async function seedUser(overrides = {}) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [
      overrides.employeeId ?? `E-R9-${++mrnCounter}`,
      overrides.firstName  ?? 'Encryption',
      overrides.lastName   ?? 'Test',
      overrides.email      ?? `r9user${mrnCounter}@example.com`,
      overrides.passwordHash ?? 'x'.repeat(60),
    ]
  );
  return rows[0].id;
}

async function seedPatient({ userId = null, email = null } = {}) {
  const { rows } = await run(
    `INSERT INTO patients (mrn, first_name, last_name, date_of_birth, gender, user_id, email)
     VALUES ($1, 'Enc', 'Patient', '1985-01-01', 'FEMALE', $2, $3)
     RETURNING id`,
    [`MRN-R9-${++mrnCounter}`, userId, email]
  );
  return rows[0].id;
}

describe('R9 at-rest encryption', () => {
  beforeEach(() => {
    mrnCounter = 0;
  });

  it('stores appointments.reason encrypted but returns plaintext', async () => {
    const doctor = await seedUser();
    const patient = await seedPatient();

    const appt = await createAppointment(
      { patientId: patient, doctorId: doctor, scheduledAt: '2026-08-10T09:00:00Z', durationMinutes: 30, type: 'IN_PERSON', reason: 'persistent cough' },
      doctor
    );

    expect(appt.reason).toBe('persistent cough');

    const { rows } = await run('SELECT reason FROM appointments WHERE id = $1', [appt.id]);
    expect(rows[0].reason).not.toBe('persistent cough');
    expect(await pgDecrypt(rows[0].reason)).toBe('persistent cough');
  });

  it('stores incidents.description encrypted but returns plaintext', async () => {
    const reportedBy = await seedUser();

    const incident = await createIncident(
      { type: 'FALL', severity: 2, description: 'patient slipped in corridor' },
      reportedBy, null, '127.0.0.1'
    );

    expect(incident.description).toBe('patient slipped in corridor');

    const { rows } = await run('SELECT description FROM incidents WHERE id = $1', [incident.id]);
    expect(rows[0].description).not.toBe('patient slipped in corridor');
    expect(await pgDecrypt(rows[0].description)).toBe('patient slipped in corridor');

    const list = await getIncidents({});
    expect(list.some((i) => i.description === 'patient slipped in corridor')).toBe(true);
  });

  it('stores discharge_summaries free text encrypted but returns plaintext', async () => {
    const doctor = await seedUser();
    const patient = await seedPatient();
    await run(
      'INSERT INTO medical_records (patient_id, attending_doctor_id) VALUES ($1, $2)',
      [patient, doctor]
    );

    const summary = await createDischargeSummary(
      {
        patientId: patient,
        dischargeDate: '2026-08-01',
        diagnosis: 'Pneumonia',
        treatmentSummary: 'Antibiotics x7d',
        dischargeMedications: 'Amoxicillin 500mg',
        followUpDate: '2026-09-01',
        instructions: 'Rest and hydrate',
      },
      doctor, null, '127.0.0.1'
    );

    expect(summary.final_diagnosis).toBe('Pneumonia');
    expect(summary.treatment_summary).toBe('Antibiotics x7d');
    expect(summary.follow_up_notes).toBe('Rest and hydrate');

    const { rows } = await run(
      'SELECT final_diagnosis, treatment_summary FROM discharge_summaries WHERE id = $1',
      [summary.id]
    );
    expect(rows[0].final_diagnosis).not.toBe('Pneumonia');
    expect(rows[0].treatment_summary).not.toBe('Antibiotics x7d');
    expect(await pgDecrypt(rows[0].final_diagnosis)).toBe('Pneumonia');
    expect(await pgDecrypt(rows[0].treatment_summary)).toBe('Antibiotics x7d');

    const summaries = await getPatientDischargeSummaries(patient);
    expect(summaries[0].final_diagnosis).toBe('Pneumonia');
  });

  it('does not crash reading legacy plaintext appointments', async () => {
    const doctor = await seedUser();
    const patient = await seedPatient();
    const { rows: legacyRows } = await run(
      `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, type, status, reason)
       VALUES (gen_random_uuid(), $1, $2, '2026-01-05T10:00:00Z', 'IN_PERSON', 'SCHEDULED', 'legacy plaintext reason')
       RETURNING id`,
      [patient, doctor]
    );

    const legacy = await getAppointmentById(legacyRows[0].id);
    expect(legacy.id).toBe(legacyRows[0].id);
    expect(legacy.reason).toBeNull();
  });

  it('does not crash reading legacy plaintext discharge summaries', async () => {
    const doctor = await seedUser();
    const patient = await seedPatient();
    const { rows: mrRows } = await run(
      'INSERT INTO medical_records (patient_id, attending_doctor_id) VALUES ($1, $2) RETURNING id',
      [patient, doctor]
    );
    const { rows: legacyRows } = await run(
      `INSERT INTO discharge_summaries
         (id, patient_id, medical_record_id, discharged_by, discharge_type, discharge_condition, final_diagnosis)
       VALUES (gen_random_uuid(), $1, $2, $3, 'REGULAR', 'STABLE', 'legacy plaintext dx')
       RETURNING id`,
      [patient, mrRows[0].id, doctor]
    );

    const summaries = await getPatientDischargeSummaries(patient);
    const legacy = summaries.find((s) => s.id === legacyRows[0].id);
    expect(legacy).toBeTruthy();
    expect(legacy.final_diagnosis).toBeNull();
  });
});
