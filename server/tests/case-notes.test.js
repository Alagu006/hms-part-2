// Coverage for the case-notes module: listing, creating, and updating notes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  pool : { query: q, connect: vi.fn() },
  query: q,
  withTransaction: vi.fn(),
}));

import * as caseNotes from '../src/modules/case-notes/case-notes.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('case-notes.service — listCaseNotes', () => {
  it('lists notes with defaults', async () => {
    q.mockResolvedValue({ rows: [{ id: 'n1' }] });
    const res = await caseNotes.listCaseNotes({});
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE cn.deleted_at IS NULL');
    expect(params).toEqual([50, 0]);
    expect(res).toEqual([{ id: 'n1' }]);
  });

  it('filters by patient', async () => {
    q.mockResolvedValue({ rows: [] });
    await caseNotes.listCaseNotes({ patientId: 'p1', page: 2, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('cn.patient_id = $1');
    expect(params).toEqual(['p1', 10, 10]);
  });
});

describe('case-notes.service — createCaseNote', () => {
  it('inserts with defaults for missing fields', async () => {
    q.mockResolvedValue({ rows: [{ id: 'n1' }] });
    const res = await caseNotes.createCaseNote({ patientId: 'p1', content: 'note' }, 'u1');
    expect(q.mock.calls[0][1]).toEqual(['p1', 'ASSESSMENT', 'note', null, 'u1']);
    expect(res.id).toBe('n1');
  });
});

describe('case-notes.service — updateCaseNote', () => {
  it('throws 400 when there is nothing to update', async () => {
    await expect(caseNotes.updateCaseNote('n1', {}, 'u1')).rejects.toMatchObject({
      status: 400, message: 'Nothing to update',
    });
  });

  it('throws 404 when the note does not exist', async () => {
    q.mockResolvedValue({ rows: [] });
    await expect(caseNotes.updateCaseNote('nope', { content: 'x' }, 'u1')).rejects.toMatchObject({
      status: 404, message: 'Case note not found',
    });
  });

  it('updates provided fields', async () => {
    q.mockResolvedValue({ rows: [{ id: 'n1', content: 'x' }] });
    const res = await caseNotes.updateCaseNote('n1', { content: 'x', followUpDate: '2026-03-03', resolved: true }, 'u1');
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('SET content = $1, follow_up_date = $2, resolved = $3, updated_at = NOW()');
    expect(sql).toContain('WHERE id = $4');
    expect(params).toEqual(['x', '2026-03-03', true, 'n1']);
    expect(res.id).toBe('n1');
  });
});
