// DB-backed integration test for the prescription dispense flow.
//
// dispensePrescription() stamps dispensed_at on prescriptions AND
// prescription_items, but neither table had such a column (only pharmacy_orders
// did) — so dispensing ALWAYS failed. Migration 022 adds the columns. This test
// FAILS on the pre-fix schema and PASSES after it.

import { describe, it, expect } from 'vitest';
import { useTestDb, run } from '../../test-setup/testDb.js';
import { dispensePrescription } from '../../src/modules/prescription/prescription.service.js';

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
