// DB-backed integration test for blood-bank reservation integrity (R14).
//
// requestBlood() used to read availability OUTSIDE any lock and then reserve —
// two concurrent requests could both pass the availability check and
// over-reserve. The check + reservation now run inside ONE transaction with the
// matching AVAILABLE rows locked SELECT ... FOR UPDATE (same serialisation
// pattern as OT booking, R20). This test exercises the flow against the real
// schema; the true two-connection serialisation is proven by the live-verify
// script (see the R14 commit).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/shared/services/notification.service.js', () => ({
  createNotification: vi.fn(async () => {}),
  NotificationType  : { BLOOD_REQUEST: 'BLOOD_REQUEST' },
}));

import { useTestDb, run } from '../../test-setup/testDb.js';
import { requestBlood } from '../../src/modules/blood-bank/blood-bank.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser() {
  const { rows } = await run(
    `INSERT INTO users (id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), 'BB', 'Doctor', $1, $2)
     RETURNING id`,
    [uniq('bbdoc') + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

async function seedUnit({ bloodGroup = 'O+', units = 10, expiry = '2027-01-01' }) {
  const { rows } = await run(
    `INSERT INTO blood_bank (id, blood_group, units, donor_name, expiry_date, status)
     VALUES (gen_random_uuid(), $1, $2, 'Donor', $3, 'AVAILABLE')
     RETURNING id`,
    [bloodGroup, units, expiry]
  );
  return rows[0].id;
}

describe('blood-bank.service — requestBlood against the real schema (R14)', () => {
  it('reserves FIFO, splits partial units, and rechecks availability after each reservation', async () => {
    const doctor = await seedUser();
    await seedUnit({ units: 3, expiry: '2026-06-01' }); // expires first -> reserved first
    await seedUnit({ units: 5, expiry: '2027-01-01' });

    // Request 4 of 8 available: 3 come from the sooner-expiring unit, 1 from
    // the other (which splits, leaving a 4-unit AVAILABLE remainder).
    const res = await requestBlood(
      { patientId: null, bloodGroup: 'O+', units: 4, reason: 'Surgery' }, doctor, null, '127.0.0.1'
    );
    expect(res).toEqual({ ok: true, reserved: 4 });

    let { rows: reserved } = await run(
      `SELECT units, status, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
       FROM blood_bank WHERE status = 'RESERVED' ORDER BY expiry_date`
    );
    expect(reserved).toEqual([
      { units: 3, status: 'RESERVED', expiry_date: '2026-06-01' },
      { units: 1, status: 'RESERVED', expiry_date: '2027-01-01' },
    ]);

    const { rows: available } = await run(
      `SELECT units, status FROM blood_bank WHERE status = 'AVAILABLE'`
    );
    expect(available).toEqual([{ units: 4, status: 'AVAILABLE' }]);

    // Consume the remaining 4 units — succeeds.
    await requestBlood(
      { patientId: null, bloodGroup: 'O+', units: 4, reason: 'Surgery' }, doctor, null, '127.0.0.1'
    );

    // Nothing left -> 422, and the rejected request reserves nothing.
    await expect(
      requestBlood({ patientId: null, bloodGroup: 'O+', units: 1, reason: 'Surgery' }, doctor, null, '127.0.0.1')
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Insufficient O+ units. Available: 0, Requested: 1'),
    });

    const { rows: availAfter } = await run(
      `SELECT COALESCE(SUM(units), 0) AS total FROM blood_bank WHERE status = 'AVAILABLE'`
    );
    expect(availAfter[0].total).toBe('0');
  });
});
