// Coverage for the handover-notes module: listing with filters, creating
// notes, and marking notes as read.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

import * as handover from '../src/modules/handover-notes/handover.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handover.service — listHandoverNotes', () => {
  it('paginates with defaults', async () => {
    q.mockResolvedValue({ rows: [{ id: 'h1', total_count: '1' }] });
    const res = await handover.listHandoverNotes({ page: 1, limit: 20 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE hn.deleted_at IS NULL');
    expect(params).toEqual([20, 0]);
    expect(res).toEqual({ handoverNotes: [{ id: 'h1' }], total: 1, page: 1, limit: 20 });
  });

  it('builds filters including unread-only', async () => {
    q.mockResolvedValue({ rows: [] });
    await handover.listHandoverNotes({ toNurseId: 'n1', toShiftType: 'MORNING', unreadOnly: true, patientId: 'p1', page: 1, limit: 10 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('hn.to_nurse_id = $1');
    expect(sql).toContain('hn.to_shift_type = $2');
    expect(sql).toContain('hn.is_read = FALSE');
    expect(sql).toContain('hn.patient_id = $3');
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(params).toEqual(['n1', 'MORNING', 'p1', 10, 0]);
  });
});

describe('handover.service — createHandoverNote', () => {
  it('inserts a note from the nurse', async () => {
    q.mockResolvedValue({ rows: [{ id: 'h1' }] });
    const res = await handover.createHandoverNote(
      { toNurseId: 'n2', toShiftType: 'EVENING', patientId: 'p1', priority: 'URGENT', note: 'Check vitals' },
      'n1'
    );
    expect(q.mock.calls[0][1]).toEqual(['n1', 'n2', 'EVENING', 'p1', 'URGENT', 'Check vitals']);
    expect(res.id).toBe('h1');
  });
});

describe('handover.service — markRead', () => {
  it('marks a note as read', async () => {
    q.mockResolvedValue({ rows: [{ id: 'h1', is_read: true }] });
    const res = await handover.markRead('h1', 'n1');
    expect(q.mock.calls[0][0]).toContain('SET is_read = TRUE');
    expect(q.mock.calls[0][1]).toEqual(['h1', 'n1']);
    expect(res).toEqual({ id: 'h1', is_read: true });
  });

  it('returns null when the note is not found', async () => {
    q.mockResolvedValue({ rows: [] });
    const res = await handover.markRead('h1', 'n1');
    expect(res).toBeNull();
  });
});
