// DB-backed integration test for the billing refund flow.
//
// refundBill() (billing.service.js) inserts payments with method 'REFUND', but
// the baseline payments.method CHECK only allowed CASH/CARD/INSURANCE/
// BANK_TRANSFER/CHEQUE/ONLINE — so refunds ALWAYS failed on the constraint.
// This test FAILS against the pre-fix schema and PASSES after migration 021
// extends the CHECK to include 'REFUND'.

import { describe, it, expect } from 'vitest';
import { useTestDb, run } from '../../test-setup/testDb.js';
import { refundBill } from '../../src/modules/billing/billing.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser() {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [uniq('E-INT-BIL'), 'Billing', 'Integration', uniq('bil-integration') + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedPatient() {
  const { rows } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (gen_random_uuid(), $1, 'Billing', 'Patient', '1990-01-01', 'MALE')
     RETURNING id`,
    [uniq('MRN-INT-BIL')]
  );
  return rows[0].id;
}

async function seedPaidBill(patientId) {
  const { rows } = await run(
    `INSERT INTO bills (id, patient_id, bill_number, status, total_amount, discount_amount, tax_amount, net_amount)
     VALUES (gen_random_uuid(), $1, $2, 'PAID', 100, 0, 0, 100)
     RETURNING *`,
    [patientId, uniq('BILL-INT')]
  );
  return rows[0];
}

describe('billing — refundBill against the real schema', () => {
  it('refunds a paid bill (inserts payments.method = REFUND, marks bill REFUNDED)', async () => {
    const biller = await seedUser();
    const patientId = await seedPatient();
    const bill = await seedPaidBill(patientId);

    const res = await refundBill({ billId: bill.id, reason: 'customer request', processedBy: biller });

    expect(res.refunded).toBe(true);
    expect(Number(res.amount)).toBe(100);

    const { rows: payments } = await run(
      `SELECT method, status, amount, reference_no FROM payments WHERE bill_id = $1`,
      [bill.id]
    );
    expect(payments.length).toBe(1);
    expect(payments[0].method).toBe('REFUND');
    expect(payments[0].status).toBe('COMPLETED');
    expect(Number(payments[0].amount)).toBe(100);
    expect(payments[0].reference_no).toContain('REFUND:');

    const { rows: bills } = await run(`SELECT status FROM bills WHERE id = $1`, [bill.id]);
    expect(bills[0].status).toBe('REFUNDED');
  });
});
