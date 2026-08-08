// DB-backed integration test for the prescription dispense flow.
//
// dispensePrescription() stamps dispensed_at on prescriptions AND
// prescription_items, but neither table had such a column (only pharmacy_orders
// did) — so dispensing ALWAYS failed. Migration 022 adds the columns. This test
// FAILS on the pre-fix schema and PASSES after it.
//
// The createPrescription suite (R24) proves, against the real schema:
//   1. Class-based drug-interaction matching rejects a contraindicated pair
//      (Linezolid + Fluoxetine → 422) through the real interactions.js — and
//      that createPrescription no longer selects the non-existent
//      `patients.allergies` column (pre-fix this query throws before the 422).
//   2. A valid prescription is created and DRUG allergies surfaced from the
//      patient_allergies table.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../../src/shared/services/redis.service.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null) },
  subscriber: {},
}));

vi.mock('../../src/shared/jobs/queue.js', () => ({
  notificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
  emailQueue       : { add: vi.fn() },
  reportQueue      : { add: vi.fn() },
  closeQueues      : vi.fn(),
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import {
  dispensePrescription,
  createPrescription,
} from '../../src/modules/prescription/prescription.service.js';
import { pgDecrypt } from '../../src/shared/db/pgcrypto.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(prefix) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Rx', 'User', $2, $3)
     RETURNING id`,
    [uniq(prefix), uniq(prefix.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedPatient() {
  const { rows } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (gen_random_uuid(), $1, 'Rx', 'Patient', '1985-05-05', 'MALE')
     RETURNING id`,
    [uniq('MRN-INT-RX')]
  );
  return rows[0].id;
}

async function seedMedicine() {
  const { rows } = await run(
    `INSERT INTO medicines (id, name, category, form, is_active)
     VALUES (gen_random_uuid(), $1, 'MEDICINE', 'TABLET', TRUE)
     RETURNING id`,
    [uniq('MED-INT')]
  );
  return rows[0].id;
}

async function seedPrescriptionWithItems() {
  const doctor = await seedUser('E-INT-DOC');
  const pharmacist = await seedUser('E-INT-PH');
  const patientId = await seedPatient();
  const medicineId = await seedMedicine();

  const { rows: [mr] } = await run(
    `INSERT INTO medical_records (id, patient_id, attending_doctor_id, chief_complaint)
     VALUES (gen_random_uuid(), $1, $2, 'routine check') RETURNING id`,
    [patientId, doctor]
  );

  const { rows: [presc] } = await run(
    `INSERT INTO prescriptions (id, medical_record_id, patient_id, prescribed_by, status, notes)
     VALUES (gen_random_uuid(), $1, $2, $3, 'PENDING', NULL)
     RETURNING *`,
    [mr.id, patientId, doctor]
  );

  const { rows: items } = await run(
    `INSERT INTO prescription_items (id, prescription_id, medicine_id, dosage, frequency, duration_days, quantity)
     VALUES (gen_random_uuid(), $1, $2, '10mg', 'BID', 5, 10),
            (gen_random_uuid(), $1, $2, '500mg', 'TID', 5, 15)
     RETURNING id`,
    [presc.id, medicineId]
  );

  return { doctor, pharmacist, patientId, prescription: presc, items };
}

describe('prescription — dispensePrescription against the real schema', () => {
  it('dispenses all items and marks the prescription DISPENSED', async () => {
    const { pharmacist, prescription, items } = await seedPrescriptionWithItems();

    const updated = await dispensePrescription(
      prescription.id,
      { dispensedItems: items.map((i) => ({ itemId: i.id, dispensed: true })), notes: '' },
      pharmacist,
      '127.0.0.1',
      'integration-test'
    );

    expect(updated.status).toBe('DISPENSED');
    expect(updated.dispensed_at).toBeTruthy();

    const { rows: rxItems } = await run(
      `SELECT COUNT(*) AS dispensed FROM prescription_items
       WHERE prescription_id = $1 AND dispensed_at IS NOT NULL`,
      [prescription.id]
    );
    expect(Number(rxItems[0].dispensed)).toBe(2);

    const { rows: orders } = await run(
      `SELECT status, dispensed_at, notes FROM pharmacy_orders WHERE prescription_id = $1`,
      [prescription.id]
    );
    expect(orders.length).toBe(1);
    expect(orders[0].status).toBe('DISPENSED');
    expect(orders[0].dispensed_at).toBeTruthy();
  });

  it('marks PARTIALLY_DISPENSED when only some items are dispensed', async () => {
    const { pharmacist, prescription, items } = await seedPrescriptionWithItems();

    const updated = await dispensePrescription(
      prescription.id,
      { dispensedItems: [{ itemId: items[0].id, dispensed: true }], notes: '' },
      pharmacist,
      '127.0.0.1',
      'integration-test'
    );

    expect(updated.status).toBe('PARTIALLY_DISPENSED');

    const { rows: orders } = await run(
      `SELECT status FROM pharmacy_orders WHERE prescription_id = $1`,
      [prescription.id]
    );
    expect(orders[0].status).toBe('PARTIALLY_DISPENSED');
  });
});

// ---------------------------------------------------------------------------
// createPrescription — R24 (class-based interaction matching + real allergy
// storage). createPrescription previously selected `patients.allergies`, a
// column that does not exist (allergies live in patient_allergies), so the
// FIRST query threw and NO prescription could ever be created in production.
// These tests FAIL on that pre-fix code and PASS after it.
// ---------------------------------------------------------------------------

async function seedDoctor() {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Rx', 'Doc', $2, $3)
     RETURNING id`,
    [uniq('E-INT-RXDOC'), uniq('rxdoc') + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedNamedMedicine(name) {
  const { rows } = await run(
    `INSERT INTO medicines (id, name, category, form, is_active)
     VALUES (gen_random_uuid(), $1, 'MEDICINE', 'TABLET', TRUE)
     RETURNING id`,
    [name]
  );
  return rows[0].id;
}

const item = (medicineId, medicineName) => ({
  medicineId, medicineName, dosage: '500mg', frequency: '2x', durationDays: 5, instructions: null,
});

describe('prescription — createPrescription R24 (real DB)', () => {
  beforeAll(() => {
    // Skip OpenFDA network entirely — local-table matching is what R24 fixes.
    vi.stubGlobal('fetch', async () => ({ ok: false }));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a class-matched contraindicated pair with 422 and writes nothing', async () => {
    const doctor = await seedDoctor();
    const patientId = await seedPatient();
    const linezolid = await seedNamedMedicine('Linezolid');
    const fluoxetine = await seedNamedMedicine('Fluoxetine');

    // Linezolid (MAO inhibitor) + an SSRI member → CONTRAINDICATED via the
    // ['linezolid','ssri'] class rule. The rejection happens BEFORE any
    // prescription insert, proving the class matcher fires end-to-end.
    await expect(createPrescription({
      patientId,
      diagnosisCodes: ['Z00.0'],
      items: [item(linezolid, 'Linezolid'), item(fluoxetine, 'Fluoxetine')],
    }, doctor, '127.0.0.1', 'integration-test')).rejects.toMatchObject({ status: 422 });

    const { rows } = await run(
      `SELECT COUNT(*) AS n FROM prescriptions WHERE patient_id = $1`,
      [patientId]
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('creates a prescription and surfaces DRUG allergies from patient_allergies', async () => {
    const doctor = await seedDoctor();
    const patientId = await seedPatient();
    const pcnV = await seedNamedMedicine('Penicillin V');
    const paracetamol = await seedNamedMedicine('Paracetamol');

    await run(
      `INSERT INTO patient_allergies (patient_id, allergen, type, severity)
       VALUES ($1, 'Penicillin', 'DRUG', 'SEVERE')`,
      [patientId]
    );
    await run(
      `INSERT INTO medical_records (id, patient_id, attending_doctor_id, chief_complaint)
       VALUES (gen_random_uuid(), $1, $2, 'routine check')`,
      [patientId, doctor]
    );

    const res = await createPrescription({
      patientId,
      diagnosisCodes: ['J06.9'],
      notes: 'review after 1 week',
      items: [item(pcnV, 'Penicillin V'), item(paracetamol, 'Paracetamol')],
    }, doctor, '127.0.0.1', 'integration-test');

    expect(res.status).toBe('PENDING');
    expect(res.allergyWarnings).toContainEqual({ medicine: 'penicillin v', allergen: 'Penicillin' });

    const { rows } = await run(
      `SELECT COUNT(*) AS n FROM prescriptions WHERE patient_id = $1`,
      [patientId]
    );
    expect(Number(rows[0].n)).toBe(1);

    // both items written against the real FK to medicines
    const { rows: itRows } = await run(
      `SELECT COUNT(*) AS n FROM prescription_items WHERE prescription_id = $1`,
      [res.id]
    );
    expect(Number(itRows[0].n)).toBe(2);

    // audit trail written for the create
    const { rows: auditRows } = await run(
      `SELECT action, entity FROM audit_logs WHERE entity = 'prescriptions' AND entity_id = $1::uuid`,
      [res.id]
    );
    expect(auditRows[0]).toMatchObject({ action: 'CREATE', entity: 'prescriptions' });

    // notes column round-trips through pgcrypto (proves the full transaction
    // path incl. encryption works against the real schema).
    const { rows: [p] } = await run(
      `SELECT notes FROM prescriptions WHERE patient_id = $1`,
      [patientId]
    );
    expect(JSON.parse(await pgDecrypt(p.notes))).toMatchObject({
      diagnosisCodes: ['J06.9'],
      freeNotes: 'review after 1 week',
    });
  });
});
