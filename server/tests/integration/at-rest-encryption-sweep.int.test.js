// Comprehensive at-rest encryption sweep (R9.5 hardening).
//
// Proves the encryption/decryption round-trip works for EVERY column declared
// `pgp_sym_encrypt at app layer` in schema.sql (25 total), against the real
// PostgreSQL + pgcrypto + the app's own pgEncrypt/pgDecrypt helpers:
//
//   1. Service-level: createPatient stores users.email/phone and the four
//      patients PII columns as ciphertext while returning plaintext; logVisitor
//      stores visitor_logs PII as ciphertext while returning plaintext.
//   2. Raw-level sweep: for every remaining declared column, write a value with
//      pgEncrypt and assert (a) the raw column does not contain the plaintext
//      and (b) pgDecrypt returns the original plaintext.
//
// This complements at-rest-encryption.int.test.js (023 columns) and
// at-rest-encryption-r95.int.test.js (024 columns), which already prove
// ciphertext-at-rest for appointments, incidents, discharge_summaries,
// medical_records and ot_schedules through the real services.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/middleware/audit.js', () => ({
  auditLog: vi.fn(async () => {}),
}));

vi.mock('../../src/shared/services/email.service.js', () => ({
  sendTempPassword: vi.fn(async () => {}),
}));

vi.mock('../../src/shared/services/notification.service.js', () => ({
  createNotification: vi.fn(async () => {}),
  NotificationType  : {},
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { pgEncrypt, pgDecrypt } from '../../src/shared/db/pgcrypto.js';
import { createPatient } from '../../src/modules/patient/patient.service.js';
import { logVisitor } from '../../src/modules/visitors/visitors.service.js';

useTestDb();

let n = 0;
const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(tag, overrides = {}) {
  const { rows: [u] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Sweep', $2, $3, $4) RETURNING id`,
    [uniq(tag), uniq(tag.toLowerCase()), overrides.email ?? uniq(tag.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return u.id;
}

async function seedPatient(userId = null) {
  const { rows: [p] } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender, user_id)
     VALUES (gen_random_uuid(), $1, 'Sweep', 'Patient', '1985-01-01', 'FEMALE', $2) RETURNING id`,
    [uniq('MRN-SW'), userId]
  );
  return p.id;
}

async function seedMedicalRecord(patientId, doctorId) {
  const { rows: [mr] } = await run(
    `INSERT INTO medical_records (id, patient_id, attending_doctor_id)
     VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [patientId, doctorId]
  );
  return mr.id;
}

async function seedRoom() {
  const { rows: [r] } = await run(
    `INSERT INTO rooms (id, room_number, room_type)
     VALUES (gen_random_uuid(), $1, 'OT') RETURNING id, room_number`,
    [uniq('OT-SW')]
  );
  return r;
}

async function seedMedicine() {
  const { rows: [m] } = await run(
    `INSERT INTO medicines (id, name, category, form)
     VALUES (gen_random_uuid(), $1, 'GENERIC', 'TABLET') RETURNING id`,
    [uniq('SW-MED')]
  );
  return m.id;
}

async function seedLabOrder(patientId, doctorId, mrId) {
  const { rows: [o] } = await run(
    `INSERT INTO lab_orders (id, medical_record_id, patient_id, ordered_by, test_name)
     VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
    [mrId, patientId, doctorId, uniq('SW-LAB')]
  );
  return o.id;
}

// Write a value into a column via the app's own pgEncrypt and assert the raw
// DB value is ciphertext (does not contain the plaintext) and that the app's
// own pgDecrypt restores the original.
async function expectColumnRoundTrip({ table, column, idColumn, idValue, sample }) {
  await run(
    `UPDATE ${table} SET ${column} = $1 WHERE ${idColumn} = $2`,
    [await pgEncrypt(sample), idValue]
  );
  const { rows: [row] } = await run(
    `SELECT ${column} FROM ${table} WHERE ${idColumn} = $1`,
    [idValue]
  );
  expect(row[column], `${table}.${column} should be ciphertext`).not.toContain(sample);
  expect(await pgDecrypt(row[column]), `${table}.${column} should decrypt`).toBe(sample);
}

describe('at-rest encryption sweep — service-level (patients + users)', () => {
  it('createPatient encrypts users.email/phone and patients PII at rest, returns plaintext', async () => {
    const createdBy = await seedUser('SW-STAFF');
    const patient = await createPatient(
      {
        firstName       : 'Ada',
        lastName        : 'Lovelace',
        email           : 'ada.sweep@example.com',
        phone           : '+10000000001',
        dateOfBirth     : '1985-01-01',
        gender          : 'FEMALE',
        bloodGroup      : 'A+',
        address         : '12 Cipher St, Testville',
        emergencyContact: 'Mother +10000000002',
      },
      createdBy, '127.0.0.1', 'sweep-agent'
    );

    expect(patient.email).toBe('ada.sweep@example.com');
    expect(patient.phone).toBe('+10000000001');
    expect(patient.address).toBe('12 Cipher St, Testville');
    expect(patient.emergency_contact).toBe('Mother +10000000002');

    const { rows: [pRow] } = await run('SELECT email, phone, address, emergency_contact FROM patients WHERE id = $1', [patient.id]);
    for (const col of ['email', 'phone', 'address', 'emergency_contact']) {
      expect(pRow[col], `patients.${col} at rest`).not.toContain(col === 'address' ? 'Cipher' : col === 'emergency_contact' ? 'Mother' : '@');
      expect(await pgDecrypt(pRow[col])).toBe(col === 'email' ? 'ada.sweep@example.com'
        : col === 'phone' ? '+10000000001'
        : col === 'address' ? '12 Cipher St, Testville'
        : 'Mother +10000000002');
    }

    const { rows: [uRow] } = await run('SELECT email, phone FROM users WHERE id = $1', [patient.user_id]);
    expect(uRow.email).not.toContain('ada.sweep@example.com');
    expect(await pgDecrypt(uRow.email)).toBe('ada.sweep@example.com');
    expect(uRow.phone).not.toContain('+10000000001');
    expect(await pgDecrypt(uRow.phone)).toBe('+10000000001');
  });
});

describe('at-rest encryption sweep — service-level (visitor_logs)', () => {
  it('logVisitor encrypts visitor PII at rest and returns plaintext', async () => {
    const staff = await seedUser('SW-NURSE');
    const patientId = await seedPatient();

    const visitor = await logVisitor(
      {
        patientId     : patientId,
        visitor_name  : 'Jane Visitor',
        visitor_phone : '+19998887777',
        id_type       : 'NATIONAL_ID',
        id_number     : 'NV-123456',
        relationship  : 'Sister',
        purpose       : 'Visiting',
      },
      staff, '127.0.0.1', 'sweep-agent'
    );

    expect(visitor.visitor_name).toBe('Jane Visitor');
    expect(visitor.visitor_phone).toBe('+19998887777');
    expect(visitor.id_number).toBe('NV-123456');

    const { rows: [row] } = await run('SELECT visitor_name, visitor_phone, id_number FROM visitor_logs WHERE id = $1', [visitor.id]);
    expect(row.visitor_name).not.toContain('Jane');
    expect(row.visitor_phone).not.toContain('+19998887777');
    expect(row.id_number).not.toContain('NV-123456');
    expect(await pgDecrypt(row.visitor_name)).toBe('Jane Visitor');
    expect(await pgDecrypt(row.visitor_phone)).toBe('+19998887777');
    expect(await pgDecrypt(row.id_number)).toBe('NV-123456');
  });
});

describe('at-rest encryption sweep — raw round-trip for remaining declared columns', () => {
  it('medical_records chief_complaint / diagnosis / treatment_plan', async () => {
    const doctor = await seedUser('SW-DOC');
    const patientId = await seedPatient();
    const mrId = await seedMedicalRecord(patientId, doctor);

    await expectColumnRoundTrip({ table: 'medical_records', column: 'chief_complaint', idColumn: 'id', idValue: mrId, sample: 'acute chest pain' });
    await expectColumnRoundTrip({ table: 'medical_records', column: 'diagnosis', idColumn: 'id', idValue: mrId, sample: 'pneumonia (right lobe)' });
    await expectColumnRoundTrip({ table: 'medical_records', column: 'treatment_plan', idColumn: 'id', idValue: mrId, sample: 'IV antibiotics, chest physio' });
  });

  it('ot_schedules.notes', async () => {
    const surgeon = await seedUser('SW-SURG');
    const patientId = await seedPatient();
    const room = await seedRoom();

    const { rows: [ot] } = await run(
      `INSERT INTO ot_schedules (id, patient_id, surgeon_id, room_id, procedure_name, scheduled_start, scheduled_end)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + interval '1 hour', NOW() + interval '2 hours') RETURNING id`,
      [patientId, surgeon, room.id, uniq('SW-PROC')]
    );
    await expectColumnRoundTrip({ table: 'ot_schedules', column: 'notes', idColumn: 'id', idValue: ot.id, sample: 'cross-match 2 units before surgery' });
  });

  it('prescriptions.notes and prescription_items.instructions', async () => {
    const doctor = await seedUser('SW-DOC2');
    const patientId = await seedPatient();
    const mrId = await seedMedicalRecord(patientId, doctor);
    const medicineId = await seedMedicine();

    const { rows: [presc] } = await run(
      `INSERT INTO prescriptions (id, medical_record_id, patient_id, prescribed_by)
       VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
      [mrId, patientId, doctor]
    );
    await expectColumnRoundTrip({ table: 'prescriptions', column: 'notes', idColumn: 'id', idValue: presc.id, sample: '{"diagnosisCodes":["J18"],"freeNotes":"review in 7 days"}' });

    const { rows: [item] } = await run(
      `INSERT INTO prescription_items (id, prescription_id, medicine_id, dosage, frequency, duration_days, quantity)
       VALUES (gen_random_uuid(), $1, $2, $3, 'OD', 7, 7) RETURNING id`,
      [presc.id, medicineId, uniq('SW-DOSE')]
    );
    await expectColumnRoundTrip({ table: 'prescription_items', column: 'instructions', idColumn: 'id', idValue: item.id, sample: 'take with food, avoid dairy' });
  });

  it('lab_results result_data and interpretation', async () => {
    const doctor = await seedUser('SW-LABDOC');
    const tech = await seedUser('SW-LABTECH');
    const patientId = await seedPatient();
    const mrId = await seedMedicalRecord(patientId, doctor);
    const labOrderId = await seedLabOrder(patientId, doctor, mrId);

    const { rows: [res] } = await run(
      `INSERT INTO lab_results (id, lab_order_id, patient_id, performed_by, result_data)
       VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [labOrderId, patientId, tech, await pgEncrypt('{"wbc":12.4,"hgb":9.8}')]
    );
    await expectColumnRoundTrip({ table: 'lab_results', column: 'result_data', idColumn: 'id', idValue: res.id, sample: '{"wbc":12.4,"hgb":9.8}' });
    await expectColumnRoundTrip({ table: 'lab_results', column: 'interpretation', idColumn: 'id', idValue: res.id, sample: 'leukocytosis consistent with infection' });
  });

  it('discharge_summaries follow_up_notes and medications_on_discharge', async () => {
    const doctor = await seedUser('SW-DISCH');
    const patientId = await seedPatient();
    const mrId = await seedMedicalRecord(patientId, doctor);

    const { rows: [summary] } = await run(
      `INSERT INTO discharge_summaries (id, patient_id, medical_record_id, discharged_by, discharge_type, discharge_condition, final_diagnosis)
       VALUES (gen_random_uuid(), $1, $2, $3, 'REGULAR', 'STABLE', $4) RETURNING id`,
      [patientId, mrId, doctor, await pgEncrypt('pneumonia')]
    );
    await expectColumnRoundTrip({ table: 'discharge_summaries', column: 'follow_up_notes', idColumn: 'id', idValue: summary.id, sample: 'return if fever persists beyond 48h' });
    await expectColumnRoundTrip({ table: 'discharge_summaries', column: 'medications_on_discharge', idColumn: 'id', idValue: summary.id, sample: 'Amoxicillin 500mg tid x7d' });
  });
});
