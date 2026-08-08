// Coverage for the incident module: reporting incidents (witnesses, admin
// alerts) and listing incidents with filters.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  q, auditMock, createNotifMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  auditMock: vi.fn(),
  createNotifMock: vi.fn(),
}));

vi.mock('../src/shared/db/pool.js', () => ({
  pool : { query: q, connect: vi.fn() },
  query: q,
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt: async (v) => (v == null ? null : `enc(${v})`),
  pgDecrypt: async (v) => (v == null ? null : (typeof v === 'string' && v.startsWith('enc(') ? v.slice(4, -1) : v)),
}));

vi.mock('../src/shared/middleware/audit.js', () => ({
  auditLog      : auditMock,
  auditMiddleware: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
}));

import * as incidents from '../src/modules/incidents/incident.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockImplementation(async () => {});
  createNotifMock.mockResolvedValue({});
});

describe('incident.service — createIncident', () => {
  it('creates an incident with witnesses and audits', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', severity: 2, description: 'slip' }] })
      .mockResolvedValueOnce({});
    const res = await incidents.createIncident(
      { type: 'FALL', severity: 2, description: 'slip', patientId: 'p1', witnessIds: ['w1', 'w2'] },
      'u1', null, 'ip'
    );

    expect(q.mock.calls[0][1]).toEqual(['u1', 'p1', 'FALL', 2, 'enc(slip)']);
    const witnessSql = q.mock.calls[1][0];
    expect(witnessSql).toContain('INSERT INTO incident_witnesses');
    expect(witnessSql).toContain('(gen_random_uuid(), $2, $1)');
    expect(witnessSql).toContain('(gen_random_uuid(), $3, $1)');
    expect(q.mock.calls[1][1]).toEqual(['i1', 'w1', 'w2']);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', action: 'CREATE', entity: 'incidents', entityId: 'i1', ip: 'ip',
    }));
    expect(res.id).toBe('i1');
  });

  it('skips witnesses when none are provided', async () => {
    q.mockResolvedValue({ rows: [{ id: 'i1', severity: 1, description: 'x' }] });
    const res = await incidents.createIncident({ type: 'FALL', severity: 1, description: 'x' }, 'u1', null, 'ip');
    expect(q).toHaveBeenCalledTimes(1);
    expect(res.id).toBe('i1');
  });

  it('notifies all admins for high-severity incidents', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', severity: 5, description: 'serious incident happening' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'admin1' }, { id: 'admin2' }] });

    await incidents.createIncident({ type: 'FALL', severity: 5, description: 'serious incident happening' }, 'u1', { io: true }, 'ip');

    expect(createNotifMock).toHaveBeenCalledTimes(2);
    expect(createNotifMock).toHaveBeenCalledWith('admin1', 'EMERGENCY_ALERT',
      'High-Severity Incident Reported (5/5)',
      'Type: FALL. serious incident happening',
      { entityType: 'incidents', entityId: 'i1' }, { io: true });
    expect(createNotifMock).toHaveBeenCalledWith('admin2', 'EMERGENCY_ALERT', expect.any(String), expect.any(String), expect.any(Object), { io: true });
  });

  it('does not notify admins for low-severity incidents', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', severity: 3, description: 'x' }] });
    await incidents.createIncident({ type: 'FALL', severity: 3, description: 'x' }, 'u1', null, 'ip');
    expect(createNotifMock).not.toHaveBeenCalled();
  });

  it('ignores witness insert failures', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: 'i1', severity: 2, description: 'x' }] })
      .mockRejectedValueOnce(new Error('table missing'));
    const res = await incidents.createIncident({ type: 'FALL', severity: 2, description: 'x', witnessIds: ['w1'] }, 'u1', null, 'ip');
    expect(res.id).toBe('i1');
  });
});

describe('incident.service — getIncidents', () => {
  it('lists with defaults', async () => {
    q.mockResolvedValue({ rows: [{ id: 'i1' }] });
    const res = await incidents.getIncidents({});
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('WHERE i.deleted_at IS NULL');
    expect(params).toEqual([20, 0]);
    expect(res).toEqual([{ id: 'i1', description: null }]);
  });

  it('filters by type, severity and status', async () => {
    q.mockResolvedValue({ rows: [] });
    await incidents.getIncidents({ type: 'FALL', severity: 3, status: 'OPEN', page: 2, limit: 5 });
    const [sql, params] = q.mock.calls[0];
    expect(sql).toContain('i.incident_type = $1');
    expect(sql).toContain('i.severity = $2');
    expect(sql).toContain('i.status = $3');
    expect(params).toEqual(['FALL', 3, 'OPEN', 5, 5]);
  });
});
