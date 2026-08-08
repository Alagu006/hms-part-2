// DB-backed integration test for the chatbot appointment-booking path.
//
// handleBookAppointment() inserted appointments with type 'OUTPATIENT', which
// the appointments.type CHECK (IN_PERSON/TELEMEDICINE/FOLLOW_UP/EMERGENCY)
// rejects — so every chatbot booking failed and the error was silently hidden
// behind a generic reply. This test FAILS on the pre-fix service and PASSES
// after the fix (type IN_PERSON + distinct conflict handling).

import { describe, it, expect } from 'vitest';
import { useTestDb, run } from '../../test-setup/testDb.js';
import { handleBookAppointment } from '../../src/modules/chatbot/chatbot.service.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedDoctorAndDepartment() {
  const { rows: [dept] } = await run(
    `INSERT INTO departments (id, name, code, is_active)
     VALUES (gen_random_uuid(), $1, $2, TRUE)
     RETURNING id, name`,
    [uniq('General Medicine'), uniq('GM')]
  );

  const { rows: [doc] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash, department_id)
     VALUES (gen_random_uuid(), $1, 'Chat', 'Doc', $2, $3, $4)
     RETURNING id`,
    [uniq('E-INT-CHATDOC'), uniq('chatdoc') + '@example.com', 'x'.repeat(60), dept.id]
  );

  await run(
    `INSERT INTO user_roles (id, user_id, role) VALUES (gen_random_uuid(), $1, 'DOCTOR')`,
    [doc.id]
  );

  return { dept, doctor: doc };
}

async function seedPatient() {
  const { rows } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender)
     VALUES (gen_random_uuid(), $1, 'Chat', 'Patient', '1995-03-03', 'FEMALE')
     RETURNING id`,
    [uniq('MRN-INT-CHAT')]
  );
  return rows[0].id;
}

describe('chatbot — handleBookAppointment against the real schema', () => {
  it('books an IN_PERSON appointment (not the invalid OUTPATIENT)', async () => {
    const { dept, doctor } = await seedDoctorAndDepartment();
    const patientId = await seedPatient();

    const reply = await handleBookAppointment(
      '00000000-0000-0000-0000-000000000000',
      { patientId, patientName: 'Chat Patient' },
      { intent: 'BOOK_APPOINTMENT', department: dept.name, date: null }
    );

    expect(reply).toContain('appointment has been booked');

    const { rows: appts } = await run(
      `SELECT patient_id, doctor_id, department_id, status, type
       FROM appointments WHERE patient_id = $1`,
      [patientId]
    );
    expect(appts.length).toBe(1);
    expect(appts[0].doctor_id).toBe(doctor.id);
    expect(appts[0].department_id).toBe(dept.id);
    expect(appts[0].status).toBe('SCHEDULED');
    expect(appts[0].type).toBe('IN_PERSON');
  });
});
