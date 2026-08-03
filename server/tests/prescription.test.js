// Coverage for the prescription module: create/get/dispense flows,
// PATIENT ownership scoping, interaction + allergy checks, and OpenFDA
// medicine search (DB + remote merge, Redis cache).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const {
  q, clientQuery, withTx,
  pgEncryptMock, pgDecryptMock,
  redisGetMock, redisSetexMock,
  auditMock, notifAddMock,
  interactionsMock, allergiesMock,
  loggerWarn, loggerError,
  fetchMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  clientQuery: vi.fn(),
  withTx: vi.fn(),
  pgEncryptMock: vi.fn(),
  pgDecryptMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetexMock: vi.fn(),
  auditMock: vi.fn(),
  notifAddMock: vi.fn(),
  interactionsMock: vi.fn(),
  allergiesMock: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: withTx,
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt      : pgEncryptMock,
  pgDecrypt      : pgDecryptMock,
  pgEncryptFields: vi.fn(),
  pgDecryptFields: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: { get: redisGetMock, setex: redisSetexMock },
  setEx: vi.fn(), get: vi.fn(), del: vi.fn(), incr: vi.fn(),
  expire: vi.fn(), publish: vi.fn(), subscribe: vi.fn(),
  unsubscribe: vi.fn(), closeRedis: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/jobs/queue.js', () => ({
  notificationQueue: { add: notifAddMock },
  emailQueue       : { add: vi.fn() },
  reportQueue      : { add: vi.fn() },
  closeQueues      : vi.fn(),
}));

vi.mock('../src/modules/prescription/interactions.js', () => ({
  checkInteractions: interactionsMock,
  checkAllergies   : allergiesMock,
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { warn: loggerWarn, error: loggerError, info: vi.fn(), debug: vi.fn() },
}));

import * as presc from '../src/modules/prescription/prescription.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const patientRow = (overrides = {}) => ({
  id: 'p1', first_name: 'John', last_name: 'Doe',
  allergies: ['Penicillin'], user_id: 'u-pat',
  ...overrides,
});

function prescRow(overrides = {}) {
  return {
    id: 'rx1', patient_id: 'p1', patient_user_id: 'u-pat', prescribed_by: 'doc1',
    status: 'PENDING', notes: 'enc({"d":"R51"})', deleted_at: null,
    ...overrides,
  };
}

function itemRow(overrides = {}) {
  return {
    id: 'pi1', prescription_id: 'rx1', medicine_id: 'med1',
    medicine_name: 'Aspirin', form: 'TAB', strength: '300mg',
    instructions: 'enc(After food)', dosage: '300mg',
    frequency: '2x', duration_days: 5, quantity: 10,
    ...overrides,
  };
}

const baseItem = (overrides = {}) => ({
  medicineId: 'med1', medicineName: 'Aspirin', dosage: '300mg',
  frequency: '2x', durationDays: 5, instructions: 'After food',
  ...overrides,
});

const staffUser = (overrides = {}) => ({ id: 'u-doc', roles: ['DOCTOR'], ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  withTx.mockImplementation(async (fn) => fn({ query: clientQuery }));
  pgEncryptMock.mockImplementation(async (t) => `enc(${t})`);
  pgDecryptMock.mockImplementation(async (t) =>
    typeof t === 'string' && t.startsWith('enc(') ? t.slice(4, -1) : t
  );
  redisGetMock.mockImplementation(async () => null);
  redisSetexMock.mockImplementation(async () => {});
  auditMock.mockImplementation(async () => {});
  notifAddMock.mockImplementation(async () => {});
  interactionsMock.mockImplementation(async () => []);
  allergiesMock.mockImplementation(() => []);
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [] }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// searchMedicines — Redis cache + local DB + OpenFDA merge
// ---------------------------------------------------------------------------
describe('prescription.service — searchMedicines', () => {
  it('returns cached results without querying the DB', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify([{ id: 'm1', name: 'Aspirin', source: 'local' }]));
    const res = await presc.searchMedicines('aspirin');
    expect(res).toEqual([{ id: 'm1', name: 'Aspirin', source: 'local' }]);
    expect(q).not.toHaveBeenCalled();
  });

  it('falls through to the DB when cached JSON is corrupt', async () => {
    redisGetMock.mockResolvedValueOnce('not-json{');
    q.mockResolvedValueOnce({ rows: [] });
    const res = await presc.searchMedicines('aspirin');
    expect(res).toEqual([]);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][1]).toEqual(['%aspirin%']);
  });

  it('merges local + OpenFDA results and caches the merged list', async () => {
    redisGetMock.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [
      { id: 'm1', name: 'Aspirin', genericName: 'Acetylsalicylic Acid', form: 'TAB', strength: '300mg', category: 'GENERAL', is_controlled: false },
    ] });
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [
      { openfda: { brand_name: ['BrandX'], generic_name: ['GenericX'], route: ['ORAL'] } },
      { openfda: { generic_name: ['GenericY'] } },
      { openfda: {} }, // no brand/generic → filtered
    ] }) }));

    const res = await presc.searchMedicines('aspirin');
    expect(res).toHaveLength(3);
    expect(res[0]).toMatchObject({ id: 'm1', source: 'local' });
    expect(res).toContainEqual(expect.objectContaining({ name: 'BrandX', source: 'openfda', form: 'ORAL' }));
    expect(res).toContainEqual(expect.objectContaining({ name: 'GenericY', genericName: 'GenericY', source: 'openfda' }));
    expect(redisSetexMock).toHaveBeenCalledWith('medicine:search:aspirin', 3600, expect.any(String));
  });

  it('dedupes OpenFDA results that match a local medicine name', async () => {
    redisGetMock.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Aspirin', genericName: null, form: null, strength: null, category: null, is_controlled: false }] });
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [
      { openfda: { brand_name: ['Aspirin'], generic_name: ['Acetylsalicylic Acid'] } },
    ] }) }));
    const res = await presc.searchMedicines('aspirin');
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe('local');
  });

  it('returns [] and logs a warning on non-200 OpenFDA responses', async () => {
    redisGetMock.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [] });
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await presc.searchMedicines('x')).toEqual([]);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('logs a warning when OpenFDA times out', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    redisGetMock.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [] });
    fetchMock.mockRejectedValueOnce(abortErr);
    expect(await presc.searchMedicines('x')).toEqual([]);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('logs an error and returns [] when OpenFDA fetch throws', async () => {
    redisGetMock.mockResolvedValueOnce(null);
    q.mockResolvedValueOnce({ rows: [] });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await presc.searchMedicines('x')).toEqual([]);
    expect(loggerError).toHaveBeenCalledWith('[openfda] Error fetching results', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// importOpenFdaMedicines — ADMIN bulk import
// ---------------------------------------------------------------------------
describe('prescription.service — importOpenFdaMedicines', () => {
  it('throws 502 when OpenFDA returns an error', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(presc.importOpenFdaMedicines('aspirin')).rejects.toMatchObject({ status: 502 });
    expect(loggerError).toHaveBeenCalled();
  });

  it('returns 0/0 when nothing maps to a medicine', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [{ openfda: {} }] }) }));
    expect(await presc.importOpenFdaMedicines('asdf')).toEqual({ imported: 0, skipped: 0 });
    expect(q).not.toHaveBeenCalled();
  });

  it('skips existing medicines and inserts new ones', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [
      { openfda: { brand_name: ['Aspirin'], generic_name: ['Acetylsalicylic Acid'] } },
      { openfda: { brand_name: ['Ibuprofen'] } },
    ] }) }));
    q.mockResolvedValueOnce({ rows: [{ id: 'm1' }] }); // Aspirin exists
    q.mockResolvedValueOnce({ rows: [] });             // Ibuprofen is new
    q.mockResolvedValueOnce({ rows: [] });             // INSERT

    expect(await presc.importOpenFdaMedicines('pain')).toEqual({ imported: 1, skipped: 1 });
    const insert = q.mock.calls[2];
    expect(insert[0]).toContain('INSERT INTO medicines');
    expect(insert[1]).toEqual(['Ibuprofen', 'Ibuprofen', 'ORAL']);
  });

  it('counts a failed insert as skipped', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ results: [
      { openfda: { brand_name: ['Xyz'] } },
    ] }) }));
    q.mockResolvedValueOnce({ rows: [] });
    q.mockRejectedValueOnce(new Error('constraint violation'));
    expect(await presc.importOpenFdaMedicines('xyz')).toEqual({ imported: 0, skipped: 1 });
    expect(loggerWarn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createPrescription — interaction / allergy checks + transaction + notifications
// ---------------------------------------------------------------------------
describe('prescription.service — createPrescription', () => {
  it('throws 404 when the patient does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await expect(presc.createPrescription({ patientId: 'nope', items: [baseItem()] }, 'doc1', 'ip', 'ua'))
      .rejects.toMatchObject({ status: 404 });
    expect(withTx).not.toHaveBeenCalled();
  });

  it('rejects contraindicated combinations with 422 and no side effects', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    interactionsMock.mockResolvedValueOnce([
      { drug1: 'linezolid', drug2: 'ssri', severity: 'CONTRAINDICATED', description: 'serotonin syndrome risk' },
      { drug1: 'warfarin', drug2: 'aspirin', severity: 'HIGH', description: 'bleeding risk' },
    ]);
    await expect(presc.createPrescription(
      { patientId: 'p1', items: [baseItem({ medicineName: 'Linezolid' }), baseItem({ medicineName: 'SSRI' })] },
      'doc1', 'ip', 'ua'
    )).rejects.toMatchObject({ status: 422 });
    expect(withTx).not.toHaveBeenCalled();
    expect(notifAddMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('creates the prescription, encrypts, audits, and notifies pharmacist/patient/nurse', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    interactionsMock.mockResolvedValueOnce([
      { drug1: 'warfarin', drug2: 'aspirin', severity: 'HIGH', description: 'bleeding risk' },
    ]);
    allergiesMock.mockReturnValueOnce([{ medicine: 'aspirin', allergen: 'Penicillin' }]);

    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO prescriptions')
      ? { rows: [{ id: 'rx1', status: 'PENDING', patient_id: 'p1' }] }
      : { rows: [] });

    const res = await presc.createPrescription({
      patientId: 'p1', diagnosisCodes: ['R51'], notes: 'fever',
      items: [baseItem(), baseItem({ medicineId: 'med2', medicineName: 'Paracetamol', instructions: null })],
      nurseId: 'nurse1', nurseInstructions: 'Give after meals',
    }, 'doc1', '1.1.1.1', 'agent');

    expect(res.id).toBe('rx1');
    expect(res.interactions).toEqual([expect.objectContaining({ severity: 'HIGH' })]);
    expect(res.allergyWarnings).toEqual([expect.objectContaining({ medicine: 'aspirin', allergen: 'Penicillin' })]);

    // encryption of free notes, nurse instructions, and item instructions
    expect(pgEncryptMock).toHaveBeenCalledWith('fever');
    expect(pgEncryptMock).toHaveBeenCalledWith('Give after meals');
    expect(pgEncryptMock).toHaveBeenCalledWith('After food');

    // header insert params (medical_record subselect is $1-based too)
    const header = clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO prescriptions'));
    expect(header[1]).toEqual(['p1', 'doc1', 'nurse1', 'enc(Give after meals)', 'enc(fever)']);

    // item inserts — computed quantity for 2x * 5 days
    const itemInsert = clientQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO prescription_items'));
    expect(itemInsert[1]).toEqual(['rx1', 'med1', '300mg', '2x', 5, 10, 'enc(After food)']);

    // notes JSON stored encrypted
    const notesUpdate = clientQuery.mock.calls.find(([sql]) => sql.startsWith('UPDATE prescriptions'));
    expect(notesUpdate[0]).toContain('SET notes = $1');
    expect(notesUpdate[1][0]).toBe('enc({"diagnosisCodes":["R51"],"freeNotes":"fever"})');

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', entity: 'prescriptions', entityId: 'rx1', userId: 'doc1',
    }));

    // pharmacist broadcast + patient + nurse
    expect(notifAddMock).toHaveBeenCalledTimes(3);
    expect(notifAddMock.mock.calls[0]).toEqual(['push', expect.objectContaining({ targetRole: 'PHARMACIST', type: 'PRESCRIPTION' })]);
    expect(notifAddMock.mock.calls[1]).toEqual(['push', expect.objectContaining({ userId: 'u-pat', type: 'PRESCRIPTION' })]);
    expect(notifAddMock.mock.calls[2]).toEqual(['push', expect.objectContaining({ userId: 'nurse1', type: 'PRESCRIPTION' })]);
  });

  it('only notifies the pharmacist when there is no portal account or nurse', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow({ user_id: null })] });
    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO prescriptions')
      ? { rows: [{ id: 'rx2' }] } : { rows: [] });

    await presc.createPrescription({ patientId: 'p1', items: [baseItem()] }, 'doc1', 'ip', 'ua');
    expect(notifAddMock).toHaveBeenCalledTimes(1);
    expect(notifAddMock.mock.calls[0][1]).toMatchObject({ targetRole: 'PHARMACIST' });
  });

  it('computes item quantities for 1x, SOS, and unknown frequencies', async () => {
    q.mockResolvedValueOnce({ rows: [patientRow()] });
    clientQuery.mockImplementation(async (sql) => sql.startsWith('INSERT INTO prescriptions')
      ? { rows: [{ id: 'rx3' }] } : { rows: [] });

    await presc.createPrescription({
      patientId: 'p1',
      items: [
        baseItem({ medicineId: 'm1', frequency: '1x', durationDays: 10, instructions: null }),
        baseItem({ medicineId: 'm2', frequency: 'SOS', durationDays: 7, instructions: null }),
        baseItem({ medicineId: 'm3', frequency: 'QID', durationDays: 3, instructions: null }),
      ],
    }, 'doc1', 'ip', 'ua');

    const inserts = clientQuery.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO prescription_items'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0][1][5]).toBe(10); // 1x * 10
    expect(inserts[1][1][5]).toBe(7);  // SOS * 7
    expect(inserts[2][1][5]).toBe(3);  // unknown freq → 1 * 3
  });
});

// ---------------------------------------------------------------------------
// getPrescriptionById — PATIENT ownership scoping (security)
// ---------------------------------------------------------------------------
describe('prescription.service — getPrescriptionById', () => {
  it('returns null when the prescription does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await presc.getPrescriptionById('rx1', staffUser())).toBeNull();
  });

  it('FORBIDDEN when a patient accesses another patient’s prescription', async () => {
    q.mockResolvedValueOnce({ rows: [prescRow({ patient_user_id: 'u-other' })] });
    const res = await presc.getPrescriptionById('rx1', { id: 'u-me', roles: ['PATIENT'] });
    expect(res).toBe('FORBIDDEN');
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('decrypts notes and item instructions for the owning patient', async () => {
    q.mockResolvedValueOnce({ rows: [prescRow()] });
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    const res = await presc.getPrescriptionById('rx1', { id: 'u-pat', roles: ['PATIENT'] });
    expect(res.notes).toEqual({ d: 'R51' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].instructions).toBe('After food');
  });

  it('allows staff to read any prescription', async () => {
    q.mockResolvedValueOnce({ rows: [prescRow({ patient_user_id: 'u-other' })] });
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    const res = await presc.getPrescriptionById('rx1', staffUser());
    expect(res.id).toBe('rx1');
  });

  it('nulls notes when decryption or JSON parsing fails', async () => {
    q.mockResolvedValueOnce({ rows: [prescRow()] });
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    pgDecryptMock.mockRejectedValueOnce(new Error('bad key'));
    const res = await presc.getPrescriptionById('rx1', staffUser());
    expect(res.notes).toBeNull();
  });

  it('nulls item instructions when their decryption fails', async () => {
    q.mockResolvedValueOnce({ rows: [prescRow()] });
    q.mockResolvedValueOnce({ rows: [itemRow()] });
    pgDecryptMock
      .mockImplementationOnce(async () => '{"d":"R51"}')   // notes OK
      .mockRejectedValueOnce(new Error('bad key'));          // item instructions fail
    const res = await presc.getPrescriptionById('rx1', staffUser());
    expect(res.notes).toEqual({ d: 'R51' });
    expect(res.items[0].instructions).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getPatientPrescriptions — history
// ---------------------------------------------------------------------------
describe('prescription.service — getPatientPrescriptions', () => {
  it('returns paginated history and strips the total column', async () => {
    q.mockResolvedValueOnce({ rows: [
      { id: 'rx1', status: 'PENDING', doctor_name: 'Dr A', item_count: '2', total_count: '2' },
      { id: 'rx2', status: 'DISPENSED', doctor_name: 'Dr A', item_count: '1', total_count: '2' },
    ] });
    const res = await presc.getPatientPrescriptions('p1', { page: 1, limit: 10 });
    expect(res).toEqual({
      prescriptions: [
        { id: 'rx1', status: 'PENDING', doctor_name: 'Dr A', item_count: '2' },
        { id: 'rx2', status: 'DISPENSED', doctor_name: 'Dr A', item_count: '1' },
      ],
      total: 2, page: 1, limit: 10,
    });
    expect(q.mock.calls[0][1]).toEqual(['p1', 10, 0]);
  });

  it('returns a zero total for an empty history', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await presc.getPatientPrescriptions('p1', { page: 1, limit: 10 });
    expect(res.total).toBe(0);
    expect(res.prescriptions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listPrescriptions — pharmacist queue filters
// ---------------------------------------------------------------------------
describe('prescription.service — listPrescriptions', () => {
  it('lists with no filters using default pagination', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await presc.listPrescriptions({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE p.deleted_at IS NULL');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([20, 0]);
  });

  it('filters by status and date with shifting placeholders', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await presc.listPrescriptions({ status: 'PENDING', date: '2026-01-02', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('p.status = $1');
    expect(sql).toContain('DATE(p.created_at) = $2');
    expect(params).toEqual(['PENDING', '2026-01-02', 10, 10]);
  });

  it('parses total and strips the total_count column', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'PENDING', total_count: '3' }] });
    const res = await presc.listPrescriptions({ page: 1, limit: 10 });
    expect(res.total).toBe(3);
    expect(res.prescriptions).toEqual([{ id: 'rx1', status: 'PENDING' }]);
  });
});

// ---------------------------------------------------------------------------
// dispensePrescription
// ---------------------------------------------------------------------------
describe('prescription.service — dispensePrescription', () => {
  it('returns null when the prescription is missing', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await presc.dispensePrescription('rx1', { dispensedItems: [] }, 'pharm1', 'ip', 'ua')).toBeNull();
  });

  it('throws 409 when already fully dispensed', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'DISPENSED', patient_id: 'p1' }] });
    await expect(presc.dispensePrescription('rx1', { dispensedItems: [] }, 'pharm1', 'ip', 'ua'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('marks the prescription DISPENSED when every item is dispensed', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'PENDING', patient_id: 'p1' }] });
    q.mockResolvedValueOnce({ rows: [] }); // UPDATE pi1
    q.mockResolvedValueOnce({ rows: [] }); // UPDATE pi2
    q.mockResolvedValueOnce({ rows: [{ id: 'pi1' }, { id: 'pi2' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'DISPENSED' }] });
    q.mockResolvedValueOnce({ rows: [] }); // INSERT pharmacy_orders

    const res = await presc.dispensePrescription(
      'rx1',
      { dispensedItems: [{ itemId: 'pi1', dispensed: true }, { itemId: 'pi2', dispensed: true }], notes: 'ok' },
      'pharm1', 'ip', 'ua'
    );
    expect(res.status).toBe('DISPENSED');

    const itemUpdates = q.mock.calls.filter(([sql]) => sql.startsWith('UPDATE prescription_items'));
    expect(itemUpdates).toHaveLength(2);
    expect(itemUpdates[0][1]).toEqual(['pi1', 'rx1']);
    expect(itemUpdates[1][1]).toEqual(['pi2', 'rx1']);

    const orderInsert = q.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO pharmacy_orders'));
    expect(orderInsert[1]).toEqual(['rx1', 'p1', 'pharm1', 'DISPENSED', 'ok']);

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DISPENSE', entityId: 'rx1',
      nextData: expect.objectContaining({ status: 'DISPENSED' }),
    }));
  });

  it('marks PARTIALLY_DISPENSED and only updates dispensed items', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'PENDING', patient_id: 'p1' }] });
    q.mockResolvedValueOnce({ rows: [] }); // UPDATE pi1 only
    q.mockResolvedValueOnce({ rows: [{ id: 'pi1' }, { id: 'pi2' }] });
    q.mockResolvedValueOnce({ rows: [{ id: 'rx1', status: 'PARTIALLY_DISPENSED' }] });
    q.mockResolvedValueOnce({ rows: [] }); // INSERT pharmacy_orders

    const res = await presc.dispensePrescription(
      'rx1',
      { dispensedItems: [{ itemId: 'pi1', dispensed: true }, { itemId: 'pi2', dispensed: false }] },
      'pharm1', 'ip', 'ua'
    );
    expect(res.status).toBe('PARTIALLY_DISPENSED');

    const itemUpdates = q.mock.calls.filter(([sql]) => sql.startsWith('UPDATE prescription_items'));
    expect(itemUpdates).toHaveLength(1);

    const orderInsert = q.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO pharmacy_orders'));
    expect(orderInsert[1][3]).toBe('PARTIALLY_DISPENSED');
  });
});

// ---------------------------------------------------------------------------
// countPrescriptions
// ---------------------------------------------------------------------------
describe('prescription.service — countPrescriptions', () => {
  it('counts by prescribing doctor when no patientId is given', async () => {
    q.mockResolvedValueOnce({ rows: [{ count: '7' }] });
    expect(await presc.countPrescriptions({}, 'doc1')).toBe(7);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('pr.prescribed_by = $1');
    expect(params).toEqual(['doc1']);
  });

  it('combines status and doctor scoping', async () => {
    q.mockResolvedValueOnce({ rows: [{ count: '3' }] });
    expect(await presc.countPrescriptions({ status: 'DISPENSED' }, 'doc1')).toBe(3);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('pr.status = $1');
    expect(sql).toContain('pr.prescribed_by = $2');
    expect(params).toEqual(['DISPENSED', 'doc1']);
  });

  it('prefers patientId over doctor scoping', async () => {
    q.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    expect(await presc.countPrescriptions({ patientId: 'p1' }, 'doc1')).toBe(1);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('pr.patient_id = $1');
    expect(sql).not.toContain('prescribed_by');
    expect(params).toEqual(['p1']);
  });

  it('returns 0 when there are no rows', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await presc.countPrescriptions({}, 'doc1')).toBe(0);
  });
});
