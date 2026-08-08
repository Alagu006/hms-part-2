// DB-backed integration test for the R17 ClamAV fail-closed fix.
//
// Before the fix, clamScan() swallowed every error from an unreachable clamd
// and returned { isInfected:false }, so uploads were accepted unscanned.
// After the fix, uploadFile() must reject with 503 and leave NO trace (no
// files row, no blob on disk, no audit entry) when the scanner is down; when
// the scanner is available it persists the file row + audit entry against the
// real schema.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, afterAll } from 'vitest';

const { clamState, uploadDir } = vi.hoisted(() => {
  const dir = `${process.cwd()}/.test-uploads-int-${process.pid}`;
  process.env.UPLOAD_DIR = dir;
  return { clamState: { error: false, infected: false, viruses: [] }, uploadDir: dir };
});

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

import { useTestDb, run } from '../../test-setup/testDb.js';
import { uploadFile } from '../../src/modules/files/file.service.js';

useTestDb();

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const uniq = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

// A structurally valid 1x1 PNG — file-type v22 rejects bare magic bytes and
// needs a real IHDR/IDAT structure before it resolves image/png.
const PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415408D763F8CFC0000003000100000002B1D0A10000000049454E44AE426082',
  'hex'
);

async function seedUser(prefix) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, 'File', 'User', $2, $3)
     RETURNING id`,
    [uniq(prefix), uniq(prefix.toLowerCase()) + '@example.com', 'x'.repeat(60)]
  );
  return rows[0].id;
}

describe('files — R17 ClamAV fail-closed (real DB)', () => {
  it('rejects upload with 503 when the scanner is unreachable and leaves no trace', async () => {
    clamState.error = true;
    const userId = await seedUser('E-INT-FL-D');

    await expect(uploadFile(
      { buffer: PNG, originalName: 'scan.pdf', entityType: 'MEDICAL_RECORD', entityId: '00000000-0000-0000-0000-000000000000' },
      userId, '127.0.0.1', 'integration-test'
    )).rejects.toMatchObject({ status: 503, message: /Virus scanner unavailable/ });

    const { rows: [filesCnt] } = await run(
      `SELECT COUNT(*)::int AS n FROM files WHERE uploaded_by = $1`, [userId]
    );
    expect(filesCnt.n).toBe(0);

    const { rows: [auditCnt] } = await run(
      `SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'files'`
    );
    expect(auditCnt.n).toBe(0);

    // temp scan file cleaned up, nothing persisted on disk
    const leftovers = fs.readdirSync(uploadDir).filter((f) => f.startsWith('tmp_'));
    expect(leftovers).toEqual([]);
    expect(fs.readdirSync(uploadDir)).toHaveLength(0);
  });

  it('persists a scanned-clean upload into the real files + audit_logs tables', async () => {
    clamState.error = false;
    const userId = await seedUser('E-INT-FL-U');

    const res = await uploadFile(
      { buffer: PNG, originalName: 'scan.png', entityType: 'PATIENT', entityId: userId },
      userId, '127.0.0.1', 'integration-test'
    );
    expect(res.mime_type).toBe('image/png');

    const { rows: [row] } = await run(`SELECT * FROM files WHERE id = $1`, [res.id]);
    expect(row).toMatchObject({
      original_name : 'scan.png',
      mime_type     : 'image/png',
      entity_type   : 'PATIENT',
      entity_id     : userId,
      uploaded_by   : userId,
      encryption_iv : 'client-encrypted',
      is_deleted    : false,
    });
    expect(row.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(uploadDir, row.storage_key))).toBe(true);

    const { rows: [auditCnt] } = await run(
      `SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity = 'files' AND action = 'UPLOAD' AND entity_id = $1`,
      [res.id]
    );
    expect(auditCnt.n).toBe(1);
  });
});
