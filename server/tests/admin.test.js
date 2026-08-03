// Coverage for the admin module: stats (Redis-cached), audit log querying and
// hash-chain verification, user CRUD/status with transactions, active session
// enumeration/logout, audit flagging, and IP blocking.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const m = vi.hoisted(() => ({
  poolQuery  : vi.fn(),
  poolConnect: vi.fn(),
  redis      : { status: 'ready', get: vi.fn(), setex: vi.fn(), keys: vi.fn(), pipeline: vi.fn(), del: vi.fn() },
  pgEncrypt  : vi.fn(),
  sendTemp   : vi.fn(),
  deptGroup  : vi.fn(),
  argon2Hash : vi.fn(),
  logger     : { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../src/shared/db/pool.js', () => ({
  pool : { query: m.poolQuery, connect: m.poolConnect },
  query: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: m.redis,
}));

vi.mock('../src/shared/db/pgcrypto.js', () => ({
  pgEncrypt: m.pgEncrypt,
  pgDecrypt: vi.fn(async (v) => v),
}));

vi.mock('../src/shared/services/email.service.js', () => ({
  sendTempPassword: m.sendTemp,
}));

vi.mock('../src/modules/messaging/messaging.service.js', () => ({
  getOrCreateDepartmentGroup: m.deptGroup,
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: m.logger,
}));

vi.mock('argon2', () => ({
  default: { hash: m.argon2Hash, argon2id: 2 },
  hash   : m.argon2Hash,
  argon2id: 2,
}));

import * as admin from '../src/modules/admin/admin.service.js';
import { createUserSchemaFor, ROLE_ASSIGNABILITY } from '../src/modules/admin/admin.schema.js';

const flush = () => new Promise((r) => setImmediate(r));

function mockClient() {
  const client = { query: vi.fn(), release: vi.fn() };
  m.poolConnect.mockResolvedValue(client);
  return client;
}

function makeIo() {
  return {
    of: vi.fn().mockReturnValue({
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.pgEncrypt.mockImplementation(async (v) => `enc:${v}`);
  m.argon2Hash.mockResolvedValue('hash');
  m.sendTemp.mockResolvedValue();
  m.deptGroup.mockResolvedValue({ id: 'g1' });
  m.redis.get.mockResolvedValue(null);
  m.redis.setex.mockResolvedValue('OK');
  m.redis.del.mockResolvedValue(1);
  m.redis.keys.mockResolvedValue([]);
  m.redis.status = 'ready';
  m.redis.pipeline.mockImplementation(() => ({
    get : vi.fn(),
    exec: vi.fn().mockResolvedValue([]),
  }));
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------
describe('admin.service — getStats', () => {
  it('returns cached stats without hitting the DB', async () => {
    m.redis.get.mockResolvedValue(JSON.stringify({ todayAdmissions: 3 }));
    const res = await admin.getStats();
    expect(res).toEqual({ todayAdmissions: 3 });
    expect(m.poolQuery).not.toHaveBeenCalled();
  });

  it('falls through to DB when the cache holds invalid JSON', async () => {
    m.redis.get.mockResolvedValue('not-json');
    m.poolQuery.mockResolvedValue({ rows: [{ count: '5' }] });
    const res = await admin.getStats();
    expect(res.todayAdmissions).toBe(5);
    expect(m.poolQuery).toHaveBeenCalledTimes(5);
    expect(m.redis.setex).toHaveBeenCalled();
  });

  it('computes stats from five queries and caches them', async () => {
    m.poolQuery
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })   // admissions
      .mockResolvedValueOnce({ rows: [{ occupied: '2', total: '10' }] }) // beds
      .mockResolvedValueOnce({ rows: [{ pending_revenue: '1250.5', pending_bills: '7' }] }) // revenue
      .mockResolvedValueOnce({ rows: [{ count: '20' }] })   // users
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });   // failed logins

    const res = await admin.getStats();

    expect(res).toEqual({
      todayAdmissions: 4,
      bedOccupancy   : { occupied: 2, total: 10 },
      pendingRevenue : 1250.5,
      pendingBills   : 7,
      activeUsers    : 20,
      failedLogins24h: 3,
    });
    expect(m.poolQuery).toHaveBeenCalledTimes(5);
    expect(m.redis.setex).toHaveBeenCalledWith('admin:stats', 300, JSON.stringify(res));
  });
});

// ---------------------------------------------------------------------------
// getAuditLogs
// ---------------------------------------------------------------------------
describe('admin.service — getAuditLogs', () => {
  it('uses default filter and pagination when no options given', async () => {
    m.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'a1' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const res = await admin.getAuditLogs({});

    expect(m.poolQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('WHERE 1=1');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(sql).not.toContain('JOIN user_roles');
    expect(params).toEqual([50, 0]);
    expect(res).toEqual({ rows: [{ id: 'a1' }], total: 1, page: 1, limit: 50 });
  });

  it('builds conditions, role join and count params in order', async () => {
    m.poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await admin.getAuditLogs({
      userId: 'u1', action: 'LOGIN', entity: 'users', severity: 'high',
      dateFrom: '2025-01-01', dateTo: '2025-01-31', flagged: 'true',
      role: 'ADMIN', page: 3, limit: 20,
    });

    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('al.user_id = $1');
    expect(sql).toContain('al.action ILIKE $2');
    expect(sql).toContain('al.entity ILIKE $3');
    expect(sql).toContain('al.created_at >= $4');
    expect(sql).toContain('al.created_at <= $5');
    expect(sql).toContain('al.flagged = TRUE');
    expect(sql).toContain('JOIN user_roles ur ON ur.user_id = al.user_id AND ur.revoked_at IS NULL');
    expect(sql).toContain('ur.role = $6');
    expect(sql).toContain('LIMIT $7 OFFSET $8');
    expect(params).toEqual(['u1', '%LOGIN%', '%users%', '2025-01-01', '2025-01-31', 'ADMIN', 20, 40]);

    const [countSql, countParams] = m.poolQuery.mock.calls[1];
    expect(countSql).toContain('SELECT COUNT(*) AS total');
    expect(countSql).not.toContain('LIMIT');
    expect(countParams).toEqual(['u1', '%LOGIN%', '%users%', '2025-01-01', '2025-01-31', 'ADMIN']);
  });

  it('handles flagged=false without adding a parameter', async () => {
    m.poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });
    await admin.getAuditLogs({ flagged: 'false' });
    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('al.flagged = FALSE');
    expect(params).toEqual([50, 0]);
  });
});

// ---------------------------------------------------------------------------
// verifyAuditChain
// ---------------------------------------------------------------------------
describe('admin.service — verifyAuditChain', () => {
  it('is trivially valid when there are no rows', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    const res = await admin.verifyAuditChain();
    expect(res).toEqual({ valid: true, totalChecked: 0 });
  });

  it('verifies an unbroken chain', async () => {
    m.poolQuery.mockResolvedValue({
      rows: [
        { id: 1, prev_hash: null, row_hash: 'a', created_at: '2025-01-01' },
        { id: 2, prev_hash: 'a', row_hash: 'b', created_at: '2025-01-02' },
      ],
    });
    const res = await admin.verifyAuditChain();
    expect(res).toEqual({ valid: true, totalChecked: 2 });
  });

  it('detects a tampered row and reports where it broke', async () => {
    m.poolQuery.mockResolvedValue({
      rows: [
        { id: 1, prev_hash: null, row_hash: 'a', created_at: '2025-01-01' },
        { id: 2, prev_hash: 'XX', row_hash: 'b', created_at: '2025-01-02' },
      ],
    });
    const res = await admin.verifyAuditChain();
    expect(res).toEqual({
      valid: false, firstTamperedId: 2, totalChecked: 1, checkedUntil: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// getUsers
// ---------------------------------------------------------------------------
describe('admin.service — getUsers', () => {
  it('queries active users with default pagination and no joins', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await admin.getUsers({});
    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('WHERE u.deleted_at IS NULL');
    expect(sql).not.toContain('JOIN user_roles ur2');
    expect(params).toEqual([50, 0]);
  });

  it('combines department/status/search/role filters and orders params', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await admin.getUsers({ department: 'dep1', status: 'active', search: 'jo', role: 'DOCTOR', limit: 10 });
    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('u.department_id = $1');
    expect(sql).toContain('u.is_active = TRUE');
    expect(sql).toContain("(u.employee_id ILIKE $2 OR (u.first_name || ' ' || u.last_name) ILIKE $2)");
    expect(sql).toContain('AND ur2.role = $3');
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(params).toEqual(['dep1', '%jo%', 'DOCTOR', 10, 0]);
  });

  it('filters inactive users', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await admin.getUsers({ status: 'inactive' });
    expect(m.poolQuery.mock.calls[0][0]).toContain('u.is_active = FALSE');
  });

  it('normalizes the roles array_agg string', async () => {
    m.poolQuery.mockResolvedValue({
      rows: [{ id: 'u1', first_name: 'A', roles: '{ADMIN,DOCTOR}' }],
    });
    const res = await admin.getUsers({});
    expect(res[0].roles).toEqual(['ADMIN', 'DOCTOR']);
  });
});

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------
describe('admin.service — createUser', () => {
  it('creates a staff user in a transaction with temp password and joins groups', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: 'u1', employee_id: 'DOC123456', first_name: 'Jane', last_name: 'Doe' }] };
      }
      return { rows: [] };
    });

    const res = await admin.createUser(
      { firstName: 'Jane', lastName: 'Doe', email: 'j@x.com', phone: '555', role: 'DOCTOR', departmentId: 'dep1' },
      'actor1'
    );

    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[queries.length - 1]).toBe('COMMIT');

    const userParams = client.query.mock.calls[1][1];
    expect(userParams[0]).toBe('Jane');
    expect(userParams[2]).toBe('enc:j@x.com');
    expect(userParams[3]).toBe('enc:555');
    expect(userParams[4]).toBe('hash');

    const roleParams = client.query.mock.calls[2][1];
    expect(roleParams).toEqual(['u1', 'DOCTOR', 'actor1']);

    expect(m.sendTemp).toHaveBeenCalledWith('j@x.com', 'DOC123456', res.tempPassword);
    expect(m.deptGroup).toHaveBeenCalledWith('dep1', 'u1', 'actor1');
    expect(m.deptGroup).toHaveBeenCalledWith(null, 'u1', 'actor1', 'General Staff');
    expect(client.release).toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'u1', role: 'DOCTOR', email: 'j@x.com' });
    expect(typeof res.tempPassword).toBe('string');
  });

  it('creates a linked patients record when role is PATIENT and skips group joins', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: 'u2', employee_id: 'PAT123456', first_name: 'P', last_name: 'X' }] };
      }
      if (sql.includes('INSERT INTO patients')) return { rows: [{ id: 'p1' }] };
      return { rows: [] };
    });

    const res = await admin.createUser(
      { firstName: 'P', lastName: 'X', email: 'p@x.com', role: 'PATIENT' },
      'actor1'
    );

    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[queries.length - 1]).toBe('COMMIT');

    const patientCall = client.query.mock.calls.find((c) => c[0].includes('INSERT INTO patients'));
    const patientSql = patientCall[0];
    const patientParams = patientCall[1];
    expect(patientSql).toContain('INSERT INTO patients');
    expect(patientSql).toContain("'1900-01-01'");
    expect(patientSql).toContain("'PREFER_NOT_TO_SAY'");
    expect(patientParams[0]).toMatch(/^MRN-\d{6}$/);
    expect(patientParams[3]).toBe('u2');
    expect(patientParams[4]).toBe('actor1');

    expect(m.deptGroup).not.toHaveBeenCalled();
    expect(res.role).toBe('PATIENT');
  });

  it('omits phone encryption when phone is not provided', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'u3', employee_id: 'NUR123456' }] };
      return { rows: [] };
    });

    await admin.createUser({ firstName: 'N', lastName: 'N', email: 'n@x.com', role: 'NURSE' }, 'a');

    expect(m.pgEncrypt).toHaveBeenCalledTimes(1); // email only
    expect(client.query.mock.calls[1][1][3]).toBeNull();
  });

  it('rolls back and rethrows on DB error', async () => {
    const client = mockClient();
    client.query.mockRejectedValueOnce(new Error('db down'));

    await expect(admin.createUser({ firstName: 'X', lastName: 'Y', email: 'x@y.com', role: 'NURSE' }, 'a'))
      .rejects.toThrow('db down');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects granting the ADMIN role to a non-SUPER_ADMIN actor', async () => {
    m.poolQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      admin.createUser({ firstName: 'A', lastName: 'B', email: 'a@x.com', role: 'ADMIN' }, 'hr1')
    ).rejects.toMatchObject({ status: 403, message: 'Only a SUPER_ADMIN can create ADMIN accounts' });
    expect(m.poolConnect).not.toHaveBeenCalled();
  });

  it('rejects granting SUPER_ADMIN role to a non-SUPER_ADMIN actor', async () => {
    m.poolQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      admin.createUser({ firstName: 'A', lastName: 'B', email: 'a@x.com', role: 'SUPER_ADMIN' }, 'hr1')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows a SUPER_ADMIN actor to create an ADMIN account', async () => {
    m.poolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: 'u-admin', employee_id: 'ADM123456', first_name: 'A', last_name: 'B' }] };
      }
      return { rows: [] };
    });

    const res = await admin.createUser(
      { firstName: 'A', lastName: 'B', email: 'a@x.com', role: 'ADMIN' },
      'sa'
    );
    expect(m.poolQuery.mock.calls[0][1]).toEqual(['sa']);
    expect(client.query.mock.calls[2][1]).toEqual(['u-admin', 'ADMIN', 'sa']);
    expect(res.role).toBe('ADMIN');
  });

  it('logs and swallows fire-and-forget failures', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'u4', employee_id: 'DOC123456' }] };
      return { rows: [] };
    });

    m.sendTemp.mockRejectedValue(new Error('smtp down'));
    m.deptGroup.mockRejectedValue(new Error('group fail'));

    const res = await admin.createUser(
      { firstName: 'J', lastName: 'D', email: 'j@x.com', role: 'DOCTOR', departmentId: 'dep1' },
      'a'
    );

    expect(res.id).toBe('u4');
    await flush();
    await flush();
    expect(m.logger.error).toHaveBeenCalledWith(
      '[admin] Failed to queue welcome email', { message: 'smtp down' }
    );
    expect(m.logger.error).toHaveBeenCalledWith(
      '[admin] Dept group auto-join failed', { message: 'group fail' }
    );
    expect(m.logger.error).toHaveBeenCalledWith(
      '[admin] General group auto-join failed', { message: 'group fail' }
    );
  });
});

// ---------------------------------------------------------------------------
// createUserSchemaFor — per-actor role allow-list
// ---------------------------------------------------------------------------
describe('admin.schema — createUserSchemaFor role allow-list', () => {
  const payload = (role) => ({ body: { firstName: 'A', lastName: 'B', email: 'a@x.com', role } });

  it('lets HR assign every clinical/staff role it is meant to', () => {
    const schema = createUserSchemaFor(['HR']);
    for (const role of ROLE_ASSIGNABILITY.HR) {
      expect(schema.safeParse(payload(role)).success).toBe(true);
    }
  });

  it('lets ADMIN assign clinical/staff roles but not the ADMIN role', () => {
    const schema = createUserSchemaFor(['ADMIN']);
    expect(schema.safeParse(payload('ADMIN')).success).toBe(false);
    expect(schema.safeParse(payload('DOCTOR')).success).toBe(true);
    expect(schema.safeParse(payload('NURSE')).success).toBe(true);
  });

  it('rejects the ADMIN role when the caller is HR (flag on body.role)', () => {
    const schema = createUserSchemaFor(['HR']);
    const res = schema.safeParse(payload('ADMIN'));
    expect(res.success).toBe(false);
    expect(res.error.issues.find((i) => i.path.join('.') === 'body.role')).toBeDefined();
  });

  it('lets SUPER_ADMIN grant ADMIN and all other roles', () => {
    const schema = createUserSchemaFor(['SUPER_ADMIN']);
    expect(schema.safeParse(payload('ADMIN')).success).toBe(true);
    expect(schema.safeParse(payload('IT_ADMIN')).success).toBe(true);
  });

  it('never exposes SUPER_ADMIN via the schema (provisioned out-of-band)', () => {
    const schema = createUserSchemaFor(['SUPER_ADMIN']);
    expect(schema.safeParse(payload('SUPER_ADMIN')).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateUser
// ---------------------------------------------------------------------------
describe('admin.service — updateUser', () => {
  it('throws 422 when no updatable fields are provided', async () => {
    await expect(admin.updateUser('u1', {}, 'a')).rejects.toMatchObject({
      status: 422,
      message: 'No updatable fields provided',
    });
  });

  it('maps camelCase to snake_case and encrypts phone', async () => {
    m.poolQuery.mockResolvedValue({
      rows: [{ id: 'u1', first_name: 'Jo', employee_id: 'DOC1' }],
    });
    const res = await admin.updateUser('u1', { firstName: 'Jo', phone: '123', specialization: 'Cardio' }, 'a');

    const [sql, params] = m.poolQuery.mock.calls[0];
    expect(sql).toContain('UPDATE users SET first_name = $1, phone = $2, specialization = $3, updated_at = NOW()');
    expect(sql).toContain('WHERE id = $4 AND deleted_at IS NULL');
    expect(params).toEqual(['Jo', 'enc:123', 'Cardio', 'u1']);
    expect(m.pgEncrypt).toHaveBeenCalledWith('123');
    expect(res.first_name).toBe('Jo');
  });

  it('throws 404 when the user does not exist', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await expect(admin.updateUser('nope', { firstName: 'Jo' }, 'a')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    });
  });
});

// ---------------------------------------------------------------------------
// deleteUser
// ---------------------------------------------------------------------------
describe('admin.service — deleteUser', () => {
  it('soft-deletes the user and linked patient in a transaction', async () => {
    const client = mockClient();
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('UPDATE users')) return { rows: [{ id: 'u1' }] };
      if (sql.includes('UPDATE patients')) return { rows: [{ id: 'p1' }] };
      return { rows: [] };
    });

    const res = await admin.deleteUser('u1', 'a');

    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[queries.length - 1]).toBe('COMMIT');
    expect(queries[1]).toContain('UPDATE users SET deleted_at = NOW()');
    expect(queries[2]).toContain('UPDATE patients SET deleted_at = NOW()');
    expect(client.query.mock.calls[2][1]).toEqual(['u1']);
    expect(client.release).toHaveBeenCalled();
    expect(res).toEqual({ id: 'u1' });
  });

  it('throws 404 and rolls back when the user is missing', async () => {
    const client = mockClient();
    client.query.mockImplementation(async () => ({ rows: [] }));

    await expect(admin.deleteUser('nope', 'a')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setUserStatus
// ---------------------------------------------------------------------------
describe('admin.service — setUserStatus', () => {
  it('updates and returns is_active', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 'u1', is_active: false }] });
    const res = await admin.setUserStatus('u1', false, 'a');
    expect(res).toEqual({ id: 'u1', is_active: false });
    expect(m.poolQuery.mock.calls[0][1]).toEqual([false, 'u1']);
  });

  it('throws 404 when the user is missing', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await expect(admin.setUserStatus('nope', true, 'a')).rejects.toMatchObject({
      status: 404,
      message: 'User not found',
    });
  });
});

// ---------------------------------------------------------------------------
// getActiveSessions
// ---------------------------------------------------------------------------
describe('admin.service — getActiveSessions', () => {
  it('returns [] when there are no refresh keys', async () => {
    const res = await admin.getActiveSessions();
    expect(res).toEqual([]);
    expect(m.poolQuery).not.toHaveBeenCalled();
  });

  it('maps refresh keys through the pipeline and resolves user names', async () => {
    m.redis.keys.mockResolvedValue(['refresh:tok1', 'refresh:tok2']);
    const pipe = { get: vi.fn(), exec: vi.fn() };
    m.redis.pipeline.mockReturnValue(pipe);
    pipe.exec.mockResolvedValue([
      [null, JSON.stringify({ userId: 'u1', sessionId: 's1' })],
      [null, JSON.stringify({ userId: 'u2', sessionId: 's2' })],
    ]);
    m.poolQuery.mockResolvedValue({
      rows: [
        { id: 'u1', first_name: 'Ann', last_name: 'A', employee_id: 'E1', roles: '{DOCTOR}' },
        { id: 'u2', first_name: 'Bob', last_name: 'B', employee_id: 'E2', roles: '{NURSE,ADMIN}' },
      ],
    });

    const res = await admin.getActiveSessions();

    expect(pipe.get).toHaveBeenCalledTimes(2);
    expect(m.poolQuery.mock.calls[0][1]).toEqual([['u1', 'u2']]);
    expect(res).toEqual([
      { sessionId: 'tok1', dbSessionId: 's1', userId: 'u1', firstName: 'Ann', lastName: 'A', employeeId: 'E1', roles: ['DOCTOR'] },
      { sessionId: 'tok2', dbSessionId: 's2', userId: 'u2', firstName: 'Bob', lastName: 'B', employeeId: 'E2', roles: ['NURSE', 'ADMIN'] },
    ]);
  });

  it('drops invalid values and unknown users from the list', async () => {
    m.redis.keys.mockResolvedValue(['refresh:bad1']);
    const pipe = { get: vi.fn(), exec: vi.fn() };
    m.redis.pipeline.mockReturnValue(pipe);
    pipe.exec.mockResolvedValue([[null, 'not-json']]);

    const res = await admin.getActiveSessions();
    expect(res).toEqual([]);
    expect(m.poolQuery).not.toHaveBeenCalled();
  });

  it('returns empty roles for a session whose user row is missing', async () => {
    m.redis.keys.mockResolvedValue(['refresh:tok9']);
    const pipe = { get: vi.fn(), exec: vi.fn() };
    m.redis.pipeline.mockReturnValue(pipe);
    pipe.exec.mockResolvedValue([[null, JSON.stringify({ userId: 'u9', sessionId: 's9' })]]);
    m.poolQuery.mockResolvedValue({ rows: [] });

    const res = await admin.getActiveSessions();
    expect(res).toEqual([
      { sessionId: 'tok9', dbSessionId: 's9', userId: 'u9', firstName: undefined, lastName: undefined, employeeId: undefined, roles: [] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// forceLogout
// ---------------------------------------------------------------------------
describe('admin.service — forceLogout', () => {
  it('throws 404 when the session key is missing', async () => {
    m.redis.get.mockResolvedValue(null);
    await expect(admin.forceLogout('tok1', null)).rejects.toMatchObject({
      status: 404,
      message: 'Session not found',
    });
  });

  it('deletes the key and broadcasts to all namespaces', async () => {
    m.redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1' }));
    const io = makeIo();
    const res = await admin.forceLogout('tok1', io);

    expect(m.redis.del).toHaveBeenCalledWith('refresh:tok1');
    expect(io.of).toHaveBeenCalledTimes(4);
    for (const ns of ['/', '/messaging', '/notifications', '/telemedicine']) {
      expect(io.of).toHaveBeenCalledWith(ns);
    }
    expect(io.of('/').to).toHaveBeenCalledWith(['user:u1']);
    expect(res).toEqual({ sessionId: 'tok1', userId: 'u1' });
  });

  it('falls back to raw userId when the value is not JSON', async () => {
    m.redis.get.mockResolvedValue('u1');
    const res = await admin.forceLogout('tok1', null);
    expect(res).toEqual({ sessionId: 'tok1', userId: 'u1' });
  });

  it('logs socket push failures without throwing', async () => {
    m.redis.get.mockResolvedValue(JSON.stringify({ userId: 'u1' }));
    const io = { of: vi.fn(() => { throw new Error('no socket'); }) };
    const res = await admin.forceLogout('tok1', io);
    expect(m.logger.error).toHaveBeenCalled();
    expect(res).toEqual({ sessionId: 'tok1', userId: 'u1' });
  });
});

// ---------------------------------------------------------------------------
// flagAuditLog / unflagAuditLog
// ---------------------------------------------------------------------------
describe('admin.service — flagAuditLog', () => {
  it('flags an entry with reason and actor', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 'a1', flagged: true, flag_reason: 'suspicious' }] });
    const res = await admin.flagAuditLog('a1', 'suspicious', 'u1');
    expect(m.poolQuery.mock.calls[0][1]).toEqual(['suspicious', 'u1', 'a1']);
    expect(res.flagged).toBe(true);
  });

  it('throws 404 when the entry is missing', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await expect(admin.flagAuditLog('nope', 'r', 'u1')).rejects.toMatchObject({
      status: 404,
      message: 'Audit log entry not found',
    });
  });
});

describe('admin.service — unflagAuditLog', () => {
  it('clears the flag', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 'a1', flagged: false }] });
    const res = await admin.unflagAuditLog('a1');
    expect(m.poolQuery.mock.calls[0][1]).toEqual(['a1']);
    expect(res.flagged).toBe(false);
  });

  it('throws 404 when the entry is missing', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await expect(admin.unflagAuditLog('nope')).rejects.toMatchObject({
      status: 404,
      message: 'Audit log entry not found',
    });
  });
});

// ---------------------------------------------------------------------------
// Blocked IPs
// ---------------------------------------------------------------------------
describe('admin.service — getBlockedIps', () => {
  it('returns blocked IP rows', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 1, ip_address: '1.2.3.4' }] });
    const res = await admin.getBlockedIps();
    expect(res).toEqual([{ id: 1, ip_address: '1.2.3.4' }]);
  });
});

describe('admin.service — blockIp', () => {
  it('inserts/upserts and invalidates the cache', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 1, ip_address: '1.2.3.4' }] });
    const res = await admin.blockIp('1.2.3.4', 'abuse', 'u1', '2026-01-01');
    expect(m.poolQuery.mock.calls[0][1]).toEqual(['1.2.3.4', 'abuse', 'u1', '2026-01-01']);
    expect(m.redis.del).toHaveBeenCalledWith('security:blocked_ips');
    expect(res.ip_address).toBe('1.2.3.4');
  });
});

describe('admin.service — unblockIp', () => {
  it('unblocks and invalidates the cache', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ id: 1, ip_address: '1.2.3.4' }] });
    const res = await admin.unblockIp(1, 'u1');
    expect(m.poolQuery.mock.calls[0][1]).toEqual(['u1', 1]);
    expect(m.redis.del).toHaveBeenCalledWith('security:blocked_ips');
    expect(res.ip_address).toBe('1.2.3.4');
  });

  it('throws 404 when already unblocked or missing', async () => {
    m.poolQuery.mockResolvedValue({ rows: [] });
    await expect(admin.unblockIp(1, 'u1')).rejects.toMatchObject({
      status: 404,
      message: 'Blocked IP not found or already unblocked',
    });
  });
});

describe('admin.service — isIpBlocked', () => {
  it('uses the cache and returns true when present', async () => {
    m.redis.get.mockResolvedValue(JSON.stringify(['1.2.3.4']));
    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(true);
    expect(m.poolQuery).not.toHaveBeenCalled();
  });

  it('uses the cache and returns false when absent', async () => {
    m.redis.get.mockResolvedValue(JSON.stringify(['1.2.3.4']));
    const res = await admin.isIpBlocked('9.9.9.9');
    expect(res).toBe(false);
    expect(m.poolQuery).not.toHaveBeenCalled();
  });

  it('falls through to the DB when the cache is corrupted', async () => {
    m.redis.get.mockResolvedValue('{bad');
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '1.2.3.4' }] });
    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(true);
    expect(m.redis.setex).toHaveBeenCalledWith('security:blocked_ips', 60, JSON.stringify(['1.2.3.4']));
  });

  it('queries the DB on cache miss and re-populates the cache', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '5.6.7.8' }] });
    const res = await admin.isIpBlocked('5.6.7.8');
    expect(res).toBe(true);
    expect(m.redis.setex).toHaveBeenCalledWith('security:blocked_ips', 60, JSON.stringify(['5.6.7.8']));
  });

  it('returns false when the DB list does not include the IP', async () => {
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '5.6.7.8' }] });
    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(false);
  });

  it('Redis down + Postgres up — client not ready skips the cache and queries Postgres', async () => {
    m.redis.status = 'connecting';
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '1.2.3.4' }] });

    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(true);
    expect(m.redis.get).not.toHaveBeenCalled();
    expect(m.redis.setex).not.toHaveBeenCalled();
    expect(m.poolQuery).toHaveBeenCalled();
  });

  it('Redis down + Postgres up — blocked IP not in DB is let through', async () => {
    m.redis.status = 'connecting';
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '5.6.7.8' }] });

    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(false);
    expect(m.poolQuery).toHaveBeenCalled();
  });

  it('a Redis read error (ready client) falls through to Postgres', async () => {
    m.redis.get.mockRejectedValue(new Error('Connection refused'));
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '5.6.7.8' }] });

    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(false);
    expect(m.poolQuery).toHaveBeenCalled();
  });

  it('a Redis cache-write failure does not fail an already-answered check (best-effort)', async () => {
    m.redis.setex.mockRejectedValue(new Error('Connection refused'));
    m.poolQuery.mockResolvedValue({ rows: [{ ip_address: '1.2.3.4' }] });

    const res = await admin.isIpBlocked('1.2.3.4');
    expect(res).toBe(true);
    expect(m.poolQuery).toHaveBeenCalled();
  });
});
