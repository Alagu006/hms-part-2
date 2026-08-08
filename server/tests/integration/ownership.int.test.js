// DB-backed regression test for the ownership rewrite (R8).
//
// checkOwnership previously only enforced PATIENT ownership — every staff role
// passed through with NO per-patient scoping, so any doctor/nurse could read
// any patient's data by UUID. It now derives the patient's care team from the
// real treating relationships (medical_records.attending_doctor_id, etc.) and
// requires staff to belong to it. This test proves, against the real schema:
//   - the attending doctor passes;
//   - an UNRELATED clinician gets 403;
//   - the owning PATIENT passes and a foreign PATIENT gets 403;
//   - ADMIN passes.

import { describe, it, expect, vi } from 'vitest';

import { useTestDb, run } from '../../test-setup/testDb.js';
import { checkOwnership } from '../../src/shared/middleware/ownership.js';

useTestDb();

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

async function seedUser(role, tag) {
  const { rows: [u] } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'Own', $2, $3, $4) RETURNING id`,
    [uniq(tag), tag, uniq(tag) + '@example.com', 'x'.repeat(60)]
  );
  await run(
    `INSERT INTO user_roles (id, user_id, role) VALUES (gen_random_uuid(), $1, $2)`,
    [u.id, role]
  );
  return u.id;
}

async function seedPatient(userId) {
  const { rows: [p] } = await run(
    `INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, gender, user_id)
     VALUES (gen_random_uuid(), $1, 'Own', 'Patient', '1980-01-01', 'FEMALE', $2) RETURNING id`,
    [uniq('MRN-OWN'), userId]
  );
  return p.id;
}

async function seedRecord(patientId, doctorId) {
  const { rows: [mr] } = await run(
    `INSERT INTO medical_records (id, patient_id, attending_doctor_id, chief_complaint)
     VALUES (gen_random_uuid(), $1, $2, 'ownership check') RETURNING id`,
    [patientId, doctorId]
  );
  return mr.id;
}

function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, user: { id: 'u', roles: [] }, ...overrides };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

describe('checkOwnership — care-team scoping against the real schema', () => {
  it('allows the attending doctor (care team member)', async () => {
    const patientId = await seedPatient(await seedUser('PATIENT', 'OWN-PAT'));
    const docA = await seedUser('DOCTOR', 'OWN-DOCA');
    const recordId = await seedRecord(patientId, docA);

    const mw  = checkOwnership('medical_record');
    const req = makeReq({ params: { id: recordId }, user: { id: docA, roles: ['DOCTOR'] } });
    const res = makeRes();
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('DENIES 403 to an unrelated clinician (regression)', async () => {
    const patientId = await seedPatient(await seedUser('PATIENT', 'OWN-PAT2'));
    const docA = await seedUser('DOCTOR', 'OWN-DOCA2');
    const docB = await seedUser('DOCTOR', 'OWN-DOCB2'); // no relationship to the patient
    const recordId = await seedRecord(patientId, docA);

    const mw  = checkOwnership('medical_record');
    const req = makeReq({ params: { id: recordId }, user: { id: docB, roles: ['DOCTOR'] } });
    const res = makeRes();
    const next = vi.fn();

    await mw(req, res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the owning PATIENT and denies a foreign PATIENT', async () => {
    const owner = await seedUser('PATIENT', 'OWN-OWNR');
    const foreign = await seedUser('PATIENT', 'OWN-FOREIGN');
    const patientId = await seedPatient(owner);

    const mw = checkOwnership('patient', 'patientId');

    const resOwn = makeRes();
    const nxtOwn = vi.fn();
    await mw(makeReq({ params: { patientId }, user: { id: owner, roles: ['PATIENT'] } }), resOwn, nxtOwn);
    expect(nxtOwn).toHaveBeenCalledOnce();
    expect(resOwn._status).toBeNull();

    const resForeign = makeRes();
    const nxtForeign = vi.fn();
    await mw(makeReq({ params: { patientId }, user: { id: foreign, roles: ['PATIENT'] } }), resForeign, nxtForeign);
    expect(resForeign._status).toBe(403);
    expect(nxtForeign).not.toHaveBeenCalled();
  });

  it('lets ADMIN through without a care-team membership check', async () => {
    const patientId = await seedPatient(await seedUser('PATIENT', 'OWN-PAT3'));
    const mw  = checkOwnership('patient', 'patientId');
    const req = makeReq({ params: { patientId }, user: { id: 'u-admin', roles: ['ADMIN'] } });
    const res = makeRes();
    const next = vi.fn();

    await mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });
});
