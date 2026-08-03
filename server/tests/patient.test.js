// Coverage for patient module: record access scoping (security),
// create/update with encrypted fields, timeline, and allergies.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, clientQuery, withTx, argonHash,
  pgEncryptFieldsMock, pgDecryptFieldsMock, auditMock, sendTempPassMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  clientQuery: vi.fn(),
  withTx: vi.fn(async (fn) => fn({ query: clientQuery })),
  argonHash: vi.fn(),
  pgEncryptFieldsMock: vi.fn(async (obj, fields) => {
    const out = { ...obj };
    for (const f of fields) out[f] = `enc(${out[f]})`;
    return out;
  }),
  pgDecryptFieldsMock: vi.fn(async (row) => ({ ...row })),
  auditMock: vi.fn(async () => {}),
  sendTempPassMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTx,
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt      : vi.fn(),
  pgDecrypt      : vi.fn(),
  pgEncryptFields: pgEncryptFieldsMock,
  pgDecryptFields: pgDecryptFieldsMock,
}));

vi.mock('argon2', () => ({
  default: { hash: argonHash, argon2id: 'argon2id' },
  hash: argonHash, argon2id: 'argon2id',
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/email.service.js', () => ({
  sendTempPassword: sendTempPassMock,
}));

import * as patient from '../src/modules/patient/patient.service.js';

function patientRow(overrides = {}) {
  return {
    id: 'p1', mrn: 'MRN-123456', user_id: 'u-own', first_name: 'John',
    last_name: 'Doe', date_of_birth: '1990-01-01', gender: 'M',
    blood_group: 'O+', email: 'j@h.com', phone: '123', address: 'addr',
    emergency_contact: 'ec', current_bed_id: null,
    ...overrides,
  };
}

function staffUser(overrides = {}) {
  return { id: 'u-staff', roles: ['DOCTOR'], ...overrides };
}

function patientUser(id = 'u-own') {
  return { id, roles: ['PATIENT'] };
}

beforeEach(() => { vi.clearAllMocks(); });

// ---------------------------------------------------------------------------
// getPatientById — PATIENT self-scoping (security)
// ---------------------------------------------------------------------------
describe('patient.service — getPatientById access control', () => {
  it('returns null when the patient does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await patient.getPatientById('p1', staffUser())).toBeNull();
  });

  it('FORBIDDEN when a patient accesses another patient’s record', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow({ user_id: 'u-other' })] });
    const res = await patient.getPatientById('p1', patientUser('u-me'));
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a patient to read their own record', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    const res = await patient.getPatientById('p1', patientUser('u-own'));
    expect(res).not.toBe('FORBIDDEN');
    expect(res.id).toBe('p1');
    // sensitive fields passed through the decrypt path
    expect(pgDecryptFieldsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      ['email', 'phone', 'address', 'emergency_contact']
    );
  });

  it('allows staff to read any patient record', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    const res = await patient.getPatientById('p1', staffUser());
    expect(res.id).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// getPatientTimeline — PATIENT self-scoping
// ---------------------------------------------------------------------------
describe('patient.service — getPatientTimeline', () => {
  it('FORBIDDEN when a patient requests another patient’s timeline', async () => {
    // scoping query returns the requesting user’s own patient id
    q.mockResolvedValueOnce({ rows: [{ id: 'p-own' }] });
    const res = await patient.getPatientTimeline('p-other', patientUser(), { page: 1, limit: 10 });
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a patient to view their own timeline', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'p-own' }] });
    q.mockResolvedValueOnce({ rows: [{ type: 'appointment', total_count: '1' }] });
    const res = await patient.getPatientTimeline('p-own', patientUser(), { page: 1, limit: 10 });
    expect(res).toEqual({ items: [{ type: 'appointment' }], total: 1, page: 1, limit: 10 });
    // timeline query paginated
    expect(q.mock.calls[1][1]).toEqual(['p-own', 10, 0]);
  });

  it('skips the ownership check for staff and paginates', async () => {
    q.mockResolvedValueOnce({ rows: [{ type: 'lab_order', total_count: '5' }] });
    const res = await patient.getPatientTimeline('p1', staffUser(), { page: 2, limit: 25 });
    expect(res.total).toBe(5);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][1]).toEqual(['p1', 25, 25]);
  });
});

// ---------------------------------------------------------------------------
// getMyRecords / getPatientByMrn / getMedicalRecordById
// ---------------------------------------------------------------------------
describe('patient.service — lookups', () => {
  it('getMyRecords returns the record linked to the user or null', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    expect(await patient.getMyRecords('u-own')).toMatchObject({ id: 'p1', user_id: 'u-own' });

    q.mockResolvedValueOnce({ rows: [] });
    expect(await patient.getMyRecords('u-none')).toBeNull();
  });

  it('getPatientByMrn looks up case-insensitively', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'p1', mrn: 'MRN-1' }] });
    expect(await patient.getPatientByMrn('mrn-1')).toEqual({ id: 'p1', mrn: 'MRN-1' });
    expect(q.mock.calls[0][0]).toContain('UPPER(p.mrn) = UPPER($1)');

    q.mockResolvedValueOnce({ rows: [] });
    expect(await patient.getPatientByMrn('missing')).toBeNull();
  });

  it('getMedicalRecordById returns a record or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'mr1', patient_name: 'John Doe' }] });
    expect(await patient.getMedicalRecordById('mr1')).toEqual({ id: 'mr1', patient_name: 'John Doe' });
    q.mockResolvedValueOnce({ rows: [] });
    expect(await patient.getMedicalRecordById('mr1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createPatient — encryption + temp password + transaction
// ---------------------------------------------------------------------------
describe('patient.service — createPatient', () => {
  beforeEach(() => { argonHash.mockResolvedValue('hash'); });

  it('creates a portal user, assigns PATIENT role, and returns the decrypted patient', async () => {
    clientQuery.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO users')) return { rows: [{ id: 'u-new' }] };
      if (sql.startsWith('INSERT INTO user_roles')) return { rows: [] };
      if (sql.startsWith('INSERT INTO patients')) return { rows: [patientRow({ id: 'p1', user_id: 'u-new' })] };
      return { rows: [] };
    });

    const data = {
      firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-01-01', gender: 'M',
      bloodGroup: 'O+', email: 'j@h.com', phone: '123', address: 'addr', emergencyContact: 'ec',
    };
    const res = await patient.createPatient(data, 'u-admin', '1.1.1.1', 'agent');

    expect(res.id).toBe('p1');
    expect(withTx).toHaveBeenCalledTimes(1);

    // sensitive fields encrypted before insert
    const userInsert = clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO users'));
    expect(userInsert[1]).toEqual([
      'John', 'Doe', 'enc(j@h.com)', 'enc(123)', 'M', '1990-01-01', 'hash',
    ]);
    const roleInsert = clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO user_roles'));
    expect(roleInsert[1]).toEqual(['u-new', 'u-admin']);
    expect(roleInsert[0]).toContain("'PATIENT'");

    const patInsert = clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO patients'));
    expect(patInsert[1]).toEqual([
      expect.stringMatching(/^MRN-\d{6}$/), 'John', 'Doe', '1990-01-01', 'M', 'O+',
      'enc(j@h.com)', 'enc(123)', 'enc(addr)', 'enc(ec)', 'u-new', 'u-admin',
    ]);

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'patients', userId: 'u-admin' }));
    // temp password emailed
    expect(sendTempPassMock).toHaveBeenCalledWith(
      'j@h.com',
      expect.stringMatching(/^MRN-\d{6}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
      'Patient ID (MRN)'
    );
  });
});

// ---------------------------------------------------------------------------
// updatePatient
// ---------------------------------------------------------------------------
describe('patient.service — updatePatient', () => {
  it('returns null when the patient does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await patient.updatePatient('p1', { firstName: 'J' }, 'u')).toBeNull();
  });

  it('returns the existing row unchanged when nothing changed', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    const res = await patient.updatePatient('p1', {}, 'u');
    expect(res).toEqual(patientRow());
    // no UPDATE issued
    expect(q.mock.calls.filter(([sql]) => sql.startsWith('UPDATE patients'))).toHaveLength(0);
  });

  it('updates only provided fields, encrypts sensitive ones, and audits', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    q.mockResolvedValueOnce({ rows: [patientRow({ first_name: 'Jane', phone: 'enc(999)' })] });

    const res = await patient.updatePatient('p1', { firstName: 'Jane', phone: '999' }, 'u-admin', '1.1.1.1', 'ua');

    const update = q.mock.calls.find(([sql]) => sql.startsWith('UPDATE patients'));
    expect(update[0]).toContain('first_name = $1');
    expect(update[0]).toContain('phone = $2');
    expect(update[1]).toEqual(['Jane', 'enc(999)', 'p1']);
    expect(res.first_name).toBe('Jane');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entity: 'patients' }));
  });
});

// ---------------------------------------------------------------------------
// listPatients — filters + pagination
// ---------------------------------------------------------------------------
describe('patient.service — listPatients', () => {
  it('returns patients and total, decrypting rows', async () => {
    q.mockResolvedValueOnce({ rows: [
      { ...patientRow(), total_count: '2' },
      { ...patientRow({ id: 'p2', total_count: '2' }) },
    ] });
    const res = await patient.listPatients({ page: 1, limit: 20 });
    expect(res.total).toBe(2);
    expect(res.patients).toHaveLength(2);
    expect(res.patients[0]).not.toHaveProperty('total_count');
    expect(q.mock.calls[0][1]).toEqual([20, 0]);
  });

  it('builds WHERE clauses for status, department, ward, search, doctor', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await patient.listPatients({
      status: 'inpatient', departmentId: 'd1', ward: '2', search: 'joh', doctorId: 'doc-1', page: 3, limit: 10,
    });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('p.current_bed_id IS NOT NULL');
    expect(sql).toContain('rooms WHERE department_id = $1');
    expect(sql).toContain('r.room_number ILIKE $2');
    expect(sql).toContain('p.mrn ILIKE $3 OR p.first_name ILIKE $3');
    expect(sql).toContain('a.doctor_id = $4');
    expect(params.slice(0, 4)).toEqual(['d1', '%2%', '%joh%', 'doc-1']);
    expect(params.slice(4)).toEqual([10, 20]); // LIMIT / OFFSET
  });
});

// ---------------------------------------------------------------------------
// Allergies
// ---------------------------------------------------------------------------
describe('patient.service — allergies', () => {
  it('listAllergies returns rows ordered by severity', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    expect(await patient.listAllergies('p1')).toEqual([{ id: 'a1' }]);
    expect(q.mock.calls[0][0]).toContain('CASE pa.severity');
  });

  it('createAllergy applies defaults and inserts', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    const res = await patient.createAllergy('p1', { allergen: 'Penicillin' }, 'u-doc');
    expect(res).toEqual({ id: 'a1' });
    expect(q.mock.calls[0][1]).toEqual(['p1', 'Penicillin', 'DRUG', 'MODERATE', null, null, 'u-doc']);
  });

  it('updateAllergy rejects empty updates with 400', async () => {
    await expect(patient.updateAllergy('p1', 'a1', {})).rejects.toMatchObject({ status: 400 });
  });

  it('updateAllergy → 404 when the allergy is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(patient.updateAllergy('p1', 'a1', { severity: 'SEVERE' })).rejects.toMatchObject({ status: 404 });
  });

  it('updateAllergy updates only provided fields and scopes to patient', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'a1', severity: 'SEVERE' }] });
    const res = await patient.updateAllergy('p1', 'a1', { severity: 'SEVERE' });
    expect(res.severity).toBe('SEVERE');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/severity\s+=\s+\$1/);
    expect(params).toEqual(['SEVERE', 'a1', 'p1']);
  });

  it('deleteAllergy throws 404 when nothing matched', async () => {
    q.mockResolvedValueOnce({ rowCount: 0 });
    await expect(patient.deleteAllergy('p1', 'a1')).rejects.toMatchObject({ status: 404 });
  });

  it('deleteAllergy resolves when a row was deleted', async () => {
    q.mockResolvedValueOnce({ rowCount: 1 });
    await expect(patient.deleteAllergy('p1', 'a1')).resolves.toBeUndefined();
  });
});
