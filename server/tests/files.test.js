// Coverage for files module: upload/download access control + persistence.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks — env MUST be set before file.service.js is statically imported
// ---------------------------------------------------------------------------
const { q, auditMock, clamState, uploadDir } = vi.hoisted(() => {
  const dir = `${process.cwd()}/.test-uploads-${process.pid}`;
  process.env.UPLOAD_DIR = dir;
  return {
    q: vi.fn(),
    auditMock: vi.fn(async () => {}),
    clamState: { infected: false, viruses: [] },
    uploadDir: dir,
  };
});

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

vi.mock('clamscan', () => {
  class NodeClam {
    async init() {
      if (clamState.error) throw new Error('connect ECONNREFUSED 127.0.0.1:3310');
      return {
        isInfected: async () => ({ isInfected: clamState.infected, viruses: clamState.viruses }),
      };
    }
  }
  return { default: NodeClam };
});

import { fileTypeFromBuffer } from 'file-type';
import * as files from '../src/modules/files/file.service.js';
import { query } from '../src/shared/db/pool.js';
import { auditLog } from '../src/shared/middleware/audit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function writeStorage(bytes = Buffer.from('file-bytes')) {
  const key = 'stored-key-1';
  fs.writeFileSync(path.join(uploadDir, key), bytes);
  return key;
}

function staffUser(overrides = {}) {
  return { id: 'u-staff', roles: ['NURSE'], ...overrides };
}

function patientUser(id = 'u-own', overrides = {}) {
  return { id, roles: ['PATIENT'], ...overrides };
}

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

// ---------------------------------------------------------------------------
// uploadProfileImage
// ---------------------------------------------------------------------------
describe('file.service — uploadProfileImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clamState.infected = false;
    clamState.viruses  = [];
    fileTypeFromBuffer.mockReset();
  });

  it('rejects non-image magic bytes with 415', async () => {
    fileTypeFromBuffer.mockResolvedValue(null);
    await expect(files.uploadProfileImage({ buffer: Buffer.from('x'), originalName: 'a.txt' }, 'u'))
      .rejects.toMatchObject({ status: 415 });
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });
    await expect(files.uploadProfileImage({ buffer: Buffer.from('x'), originalName: 'a.pdf' }, 'u'))
      .rejects.toMatchObject({ status: 415 });
  });

  it('accepts client-encrypted upload only for allowed declared MIME', async () => {
    await expect(files.uploadProfileImage({
      buffer: Buffer.from('enc'), originalName: 'a.gif',
      clientEncrypted: true, declaredMime: 'image/gif',
    }, 'u')).rejects.toMatchObject({ status: 415 });

    q.mockResolvedValueOnce({ rows: [{ id: 'f1', original_name: 'a.png', mime_type: 'image/png', size_bytes: 3, entity_type: 'USER_PROFILE', entity_id: 'u1', created_at: new Date() }] });
    const res = await files.uploadProfileImage({
      buffer: Buffer.from('enc'), originalName: 'a.png',
      clientEncrypted: true, declaredMime: 'image/png',
    }, 'u');
    expect(res.id).toBe('f1');
    // magic-byte detection skipped for client-encrypted
    expect(fileTypeFromBuffer).not.toHaveBeenCalled();
  });

  it('persists image to disk, inserts row and audits', async () => {
    const bytes = Buffer.from('png-bytes');
    fileTypeFromBuffer.mockResolvedValue({ mime: 'image/png' });
    q.mockResolvedValueOnce({ rows: [{ id: 'f1', original_name: 'photo.png', mime_type: 'image/png', size_bytes: bytes.length, entity_type: 'USER_PROFILE', entity_id: 'u1', created_at: new Date() }] });

    const res = await files.uploadProfileImage(
      { buffer: bytes, originalName: 'photo.png', userId: 'u1' },
      'u-admin', '1.2.3.4', 'agent'
    );

    expect(res.mime_type).toBe('image/png');
    const insertCall = q.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO files'));
    expect(insertCall[1]).toEqual([
      'photo.png', expect.any(String), 'image/png', bytes.length,
      expect.stringMatching(/^[a-f0-9]{64}$/), 'none', 'u1', 'u-admin',
    ]);
    // file actually written to disk under the storage key
    expect(fs.existsSync(path.join(uploadDir, insertCall[1][1]))).toBe(true);
    expect(fs.readFileSync(path.join(uploadDir, insertCall[1][1]))).toEqual(bytes);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPLOAD_PROFILE_IMAGE', entityId: 'f1' }));
  });
});

// ---------------------------------------------------------------------------
// downloadProfileImage — access control
// ---------------------------------------------------------------------------
describe('file.service — downloadProfileImage access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileTypeFromBuffer.mockReset();
  });

  function profileRow(overrides = {}) {
    return [{ id: 'f1', entity_type: 'USER_PROFILE', entity_id: 'u-own', storage_key: writeStorage(), mime_type: 'image/png', encryption_iv: 'none', ...overrides }];
  }

  it('returns null when the file does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const res = await files.downloadProfileImage('missing', staffUser());
    expect(res).toBeNull();
  });

  it('FORBIDDEN when a patient requests someone else’s profile image', async () => {
    q.mockResolvedValueOnce({ rows: profileRow() });
    const res = await files.downloadProfileImage('f1', patientUser('u-other'));
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a patient to download their own profile image', async () => {
    q.mockResolvedValueOnce({ rows: profileRow() });
    const res = await files.downloadProfileImage('f1', patientUser('u-own'));
    expect(res).not.toBe('FORBIDDEN');
    expect(res.buffer).toEqual(Buffer.from('file-bytes'));
    expect(res.mimeType).toBe('image/png');
  });

  it('allows staff to download any profile image', async () => {
    q.mockResolvedValueOnce({ rows: profileRow() });
    const res = await files.downloadProfileImage('f1', staffUser());
    expect(res.buffer).toEqual(Buffer.from('file-bytes'));
  });

  it('throws 404 when the blob is missing on disk', async () => {
    q.mockResolvedValueOnce({ rows: profileRow({ storage_key: 'does-not-exist' }) });
    await expect(files.downloadProfileImage('f1', staffUser()))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// uploadFile
// ---------------------------------------------------------------------------
describe('file.service — uploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clamState.infected = false;
    clamState.viruses  = [];
    clamState.error    = false;
    fileTypeFromBuffer.mockReset();
  });

  afterEach(() => {
    delete process.env.CLAMAV_REQUIRED;
  });

  it('rejects disallowed MIME with 415', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/javascript' });
    await expect(files.uploadFile({ buffer: Buffer.from('x'), originalName: 'a.js', entityType: 'PATIENT', entityId: 'p1' }, 'u'))
      .rejects.toMatchObject({ status: 415 });
  });

  it('rejects malware-infected files with 422 and cleans up temp', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });
    clamState.infected = true;
    clamState.viruses  = ['Eicar-Test-Signature'];
    await expect(files.uploadFile({ buffer: Buffer.from('x'), originalName: 'a.pdf', entityType: 'PATIENT', entityId: 'p1' }, 'u'))
      .rejects.toMatchObject({ status: 422, message: /malware detected/ });
    expect(fs.readdirSync(uploadDir).filter((f) => f.startsWith('tmp_'))).toEqual([]);
  });

  it('FAIL-CLOSED: rejects with 503 when the scanner is unreachable and cleans up temp', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });
    clamState.error = true;
    await expect(files.uploadFile({ buffer: Buffer.from('x'), originalName: 'a.pdf', entityType: 'PATIENT', entityId: 'p1' }, 'u'))
      .rejects.toMatchObject({ status: 503, message: /Virus scanner unavailable/ });
    // no file was persisted, no row inserted, no audit, and the temp file is gone
    expect(q.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO files'))).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
    expect(fs.readdirSync(uploadDir).filter((f) => f.startsWith('tmp_'))).toEqual([]);
  });

  it('CLAMAV_REQUIRED=false opts out of the scan (dev-only) and accepts the upload', async () => {
    process.env.CLAMAV_REQUIRED = 'false';
    clamState.error = true; // scanner would be down — but scanning is disabled
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });
    q.mockResolvedValueOnce({ rows: [{ id: 'f1', original_name: 'r.pdf', mime_type: 'application/pdf', size_bytes: 1, entity_type: 'PATIENT', entity_id: 'p1', created_at: new Date() }] });

    const res = await files.uploadFile({ buffer: Buffer.from('x'), originalName: 'r.pdf', entityType: 'PATIENT', entityId: 'p1' }, 'u');
    expect(res.id).toBe('f1');
  });

  it('uses declared MIME for client-encrypted uploads without magic-byte detection', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'f1', original_name: 'r.dcm', mime_type: 'application/dicom', size_bytes: 3, entity_type: 'LAB_RESULT', entity_id: 'l1', created_at: new Date() }] });
    const res = await files.uploadFile({
      buffer: Buffer.from('enc'), originalName: 'r.dcm', entityType: 'LAB_RESULT', entityId: 'l1',
      clientEncrypted: true, declaredMime: 'application/dicom',
    }, 'u');
    expect(res.mime_type).toBe('application/dicom');
    expect(fileTypeFromBuffer).not.toHaveBeenCalled();
    expect(q.mock.calls[0][1]).toEqual([
      'r.dcm', expect.any(String), 'application/dicom', 3,
      expect.stringMatching(/^[a-f0-9]{64}$/), 'client-encrypted',
      'LAB_RESULT', 'l1', 'u',
    ]);
  });

  it('persists the file and audits on success', async () => {
    const bytes = Buffer.from('pdf-bytes');
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' });
    q.mockResolvedValueOnce({ rows: [{ id: 'f1', original_name: 'r.pdf', mime_type: 'application/pdf', size_bytes: bytes.length, entity_type: 'MEDICAL_RECORD', entity_id: 'm1', created_at: new Date() }] });

    const res = await files.uploadFile(
      { buffer: bytes, originalName: 'r.pdf', entityType: 'MEDICAL_RECORD', entityId: 'm1' },
      'u-admin', '9.9.9.9', 'curl'
    );

    expect(res.id).toBe('f1');
    const insertCall = q.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO files'));
    expect(fs.existsSync(path.join(uploadDir, insertCall[1][1]))).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPLOAD' }));
    // temp scan file cleaned up
    expect(fs.readdirSync(uploadDir).filter((f) => f.startsWith('tmp_'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateFileIv / updateFileEntity
// ---------------------------------------------------------------------------
describe('file.service — metadata updates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updateFileIv returns the row or null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'f1' }] });
    expect(await files.updateFileIv('f1', 'iv', 'u')).toEqual({ id: 'f1' });
    expect(q.mock.calls[0][1]).toEqual(['iv', 'f1', 'u']);

    q.mockResolvedValueOnce({ rows: [] });
    expect(await files.updateFileIv('f1', 'iv', 'u')).toBeNull();
  });

  it('updateFileEntity re-links the file or returns null', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'f1' }] });
    expect(await files.updateFileEntity('f1', 'LAB_RESULT', 'l1', 'u')).toEqual({ id: 'f1' });
    expect(q.mock.calls[0][1]).toEqual(['LAB_RESULT', 'l1', 'f1', 'u']);

    q.mockResolvedValueOnce({ rows: [] });
    expect(await files.updateFileEntity('f1', 'LAB_RESULT', 'l1', 'u')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// downloadFile — entity-scoped access control (security)
// ---------------------------------------------------------------------------
describe('file.service — downloadFile access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileTypeFromBuffer.mockReset();
  });

  function fileRow(overrides = {}) {
    return [{
      id: 'f1', original_name: 'doc.pdf', storage_key: writeStorage(),
      mime_type: 'application/pdf', encryption_iv: 'client-encrypted',
      checksum_sha256: 'abc123', is_deleted: false,
      entity_type: 'PATIENT', uploaded_by: 'u-uploader',
      patient_user_id: null, lab_patient_user_id: null,
      mr_patient_user_id: null, rx_patient_user_id: null,
      direct_patient_id: null, lab_patient_id: null,
      mr_patient_id: null, rx_patient_id: null,
      msg_is_member: false,
      ...overrides,
    }];
  }

  it('returns null when the file does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await files.downloadFile('f1', staffUser())).toBeNull();
  });

  it('FORBIDDEN when a patient accesses another patient’s record file', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'PATIENT', patient_user_id: 'u-own' }) });
    const res = await files.downloadFile('f1', patientUser('u-other'));
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a patient to download their own record file', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'PATIENT', patient_user_id: 'u-own' }) });
    const res = await files.downloadFile('f1', patientUser('u-own'));
    expect(res).not.toBe('FORBIDDEN');
    expect(res.buffer).toEqual(Buffer.from('file-bytes'));
    expect(res.originalName).toBe('doc.pdf');
    expect(res.checksumSha256).toBe('abc123');
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DOWNLOAD', entityId: 'f1' }));
  });

  it('allows staff on the care team to download a patient’s file (R18)', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'PATIENT', patient_user_id: 'u-own', direct_patient_id: 'p-own' }) });
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // care-team membership
    const res = await files.downloadFile('f1', staffUser());
    expect(res).not.toBe('FORBIDDEN');
    expect(q.mock.calls[1][1]).toEqual(['p-own', 'u-staff']);
  });

  it('FORBIDDEN for a clinical staff member NOT on the patient’s care team (no blanket grant)', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MEDICAL_RECORD', mr_patient_id: 'p-own' }) });
    q.mockResolvedValueOnce({ rows: [] }); // not a care-team member
    const res = await files.downloadFile('f1', staffUser());
    expect(res).toBe('FORBIDDEN');
  });

  it('allows a doctor on the care team to download a MEDICAL_RECORD file', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MEDICAL_RECORD', mr_patient_id: 'p-own' }) });
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    const res = await files.downloadFile('f1', { id: 'u-doctor', roles: ['DOCTOR'] });
    expect(res).not.toBe('FORBIDDEN');
    expect(res.buffer).toEqual(Buffer.from('file-bytes'));
  });

  it('allows admin to download any patient’s clinical file (care-team bypass)', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'LAB_RESULT', lab_patient_id: 'p-own' }) });
    const res = await files.downloadFile('f1', { id: 'u-admin', roles: ['ADMIN'] });
    expect(res).not.toBe('FORBIDDEN');
  });

  it('resolves ownership through LAB_RESULT → patients join', async () => {
    const row = fileRow({ entity_type: 'LAB_RESULT', lab_patient_user_id: 'u-own' });
    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', patientUser('u-other'))).toBe('FORBIDDEN');
    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', patientUser('u-own'))).not.toBe('FORBIDDEN');
  });

  it('resolves ownership through MEDICAL_RECORD → patients join', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MEDICAL_RECORD', mr_patient_user_id: 'u-own' }) });
    expect(await files.downloadFile('f1', patientUser('u-other'))).toBe('FORBIDDEN');
  });

  it('resolves ownership through PRESCRIPTION → patients join', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'PRESCRIPTION', rx_patient_user_id: 'u-own' }) });
    expect(await files.downloadFile('f1', patientUser('u-other'))).toBe('FORBIDDEN');
  });

  it('FORBIDDEN when a non-clinical staff role requests a patient file', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MEDICAL_RECORD', mr_patient_id: 'p-own' }) });
    q.mockResolvedValueOnce({ rows: [] }); // not on the care team
    const res = await files.downloadFile('f1', { id: 'u-recep', roles: ['RECEPTIONIST'] });
    expect(res).toBe('FORBIDDEN');
  });

  it('denies LAB_TECH access to MESSAGE attachments they are not part of', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MESSAGE', msg_is_member: false }) });
    const res = await files.downloadFile('f1', { id: 'u-lab', roles: ['LAB_TECH'] });
    expect(res).toBe('FORBIDDEN');
  });

  it('allows the uploader to download their own MESSAGE attachment', async () => {
    const row = fileRow({ entity_type: 'MESSAGE', msg_is_member: false });
    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', { id: 'u-uploader', roles: ['NURSE'] })).not.toBe('FORBIDDEN');
  });

  it('allows message group members to download an attachment', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MESSAGE', msg_is_member: true }) });
    const res = await files.downloadFile('f1', { id: 'u-member', roles: ['PHARMACIST'] });
    expect(res).not.toBe('FORBIDDEN');
    expect(res.buffer).toEqual(Buffer.from('file-bytes'));
  });

  it('allows admin to download any message attachment', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'MESSAGE', msg_is_member: false }) });
    const res = await files.downloadFile('f1', { id: 'u-admin', roles: ['ADMIN'] });
    expect(res).not.toBe('FORBIDDEN');
  });

  it('restricts INCIDENT attachments to viewers and uploader', async () => {
    const row = fileRow({ entity_type: 'INCIDENT' });
    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', { id: 'u-nurse', roles: ['NURSE'] })).toBe('FORBIDDEN');

    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', { id: 'u-hr', roles: ['HR'] })).not.toBe('FORBIDDEN');

    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', { id: 'u-sec', roles: ['SECURITY_OFC'] })).not.toBe('FORBIDDEN');

    q.mockResolvedValueOnce({ rows: row });
    expect(await files.downloadFile('f1', { id: 'u-uploader', roles: ['NURSE'] })).not.toBe('FORBIDDEN');
  });

  it('allows staff to download USER_PROFILE images via downloadFile', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'USER_PROFILE' }) });
    const res = await files.downloadFile('f1', { id: 'u-doctor', roles: ['DOCTOR'] });
    expect(res).not.toBe('FORBIDDEN');
  });

  it('FORBIDDEN for unknown entity types', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'UNKNOWN' }) });
    const res = await files.downloadFile('f1', staffUser());
    expect(res).toBe('FORBIDDEN');
  });

  it('passes requesting user id into the query for message membership', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ entity_type: 'PATIENT', patient_user_id: 'u-own' }) });
    await files.downloadFile('f1', patientUser('u-own'));
    expect(q.mock.calls[0][1]).toEqual(['f1', 'u-own']);
  });

  it('throws 404 when the blob is missing on disk', async () => {
    q.mockResolvedValueOnce({ rows: fileRow({ storage_key: 'missing-on-disk', direct_patient_id: 'p-own' }) });
    q.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // staff on the care team
    await expect(files.downloadFile('f1', staffUser())).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------
describe('file.service — deleteFile', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when the file is already gone', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await files.deleteFile('f1', 'u', 'ip', 'ua')).toBeNull();
  });

  it('soft-deletes and audits on success', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'f1' }] });
    const res = await files.deleteFile('f1', 'u-admin', '1.1.1.1', 'agent');
    expect(res).toEqual({ id: 'f1' });
    expect(q.mock.calls[0][0]).toContain('is_deleted = TRUE');
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', userId: 'u-admin' }));
  });
});
