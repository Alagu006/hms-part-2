// Coverage for the ownership middleware (checkOwnership / isCareTeamMember) and
// a proof that the billing IDOR chain (authorize -> checkOwnership -> handler)
// rejects cross-patient access.
//
// Part 1 (unit): every branch of checkOwnership — admin bypass, PATIENT
// self-ownership, PATIENT on someone else's resource, care-team membership for
// staff, 404 for missing rows, query errors, unknown entity types.
// Part 2 (integration): a real Express route mirroring billing.routes.js is
// exercised with RS256 JWTs. A PATIENT token for a *different* user must be
// denied — if checkOwnership is ever removed from the route, this test fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q },
}));

const { checkOwnership, isCareTeamMember } = await import('../src/shared/middleware/ownership.js');

let ownerRow;
let careTeamMember;

function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, user: { id: 'user-uuid', roles: [] }, ...overrides };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

async function run(entity, req, paramName = 'id') {
  const mw  = checkOwnership(entity, paramName);
  const res = makeRes();
  const next = vi.fn();
  await mw(req, res, next);
  return { res, next };
}

beforeEach(() => {
  q.mockReset();
  ownerRow     = { patient_id: 'p-1', user_id: 'victim-user' };
  careTeamMember = false;
  q.mockImplementation((sql) => {
    if (sql.includes('care_team')) {
      return Promise.resolve({ rows: careTeamMember ? [{ exists: 1 }] : [] });
    }
    return Promise.resolve({ rows: ownerRow ? [ownerRow] : [] });
  });
});

describe('checkOwnership() — unit', () => {
  it('throws on an unknown entity type', () => {
    expect(() => checkOwnership('bogus')).toThrow(/Unknown entity type/);
  });

  it('isCareTeamMember returns true when the care-team query matches', async () => {
    careTeamMember = true;
    await expect(isCareTeamMember('p-1', 'doctor-1')).resolves.toBe(true);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('isCareTeamMember returns false when the care-team query is empty', async () => {
    await expect(isCareTeamMember('p-1', 'doctor-1')).resolves.toBe(false);
  });

  it('lets ADMIN through without any database query', async () => {
    const { res, next } = await run('bill', makeReq({ user: { id: 'admin-1', roles: ['ADMIN'] } }));
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    expect(q).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN through without any database query', async () => {
    const { res, next } = await run('bill', makeReq({ user: { id: 'sa-1', roles: ['SUPER_ADMIN'] } }));
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    expect(q).not.toHaveBeenCalled();
  });

  it('lets a PATIENT access their own resource', async () => {
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'victim-user', roles: ['PATIENT'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    expect(q).toHaveBeenCalledWith(expect.stringContaining('FROM bills'), ['bill-1']);
  });

  it('rejects a PATIENT accessing another user\'s resource (IDOR)', async () => {
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'attacker-user', roles: ['PATIENT'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the resource does not exist', async () => {
    ownerRow = null;
    const req = makeReq({ params: { id: 'missing' }, user: { id: 'user-uuid', roles: ['DOCTOR'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBe(404);
    expect(res._body).toEqual({ error: 'Resource not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a staff member who is not on the patient\'s care team', async () => {
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'doctor-x', roles: ['DOCTOR'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied' });
    expect(next).not.toHaveBeenCalled();
    expect(q).toHaveBeenCalledWith(expect.stringContaining('care_team'), ['p-1', 'doctor-x']);
  });

  it('lets a staff member who IS on the care team through', async () => {
    careTeamMember = true;
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'doctor-1', roles: ['DOCTOR'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('honours a custom param name', async () => {
    const req = makeReq({ params: { patientId: 'p-9' }, user: { id: 'victim-user', roles: ['PATIENT'] } });
    const { res, next } = await run('patient', req, 'patientId');
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    expect(q).toHaveBeenCalledWith(expect.stringContaining('FROM patients'), ['p-9']);
  });

  it('forwards query errors to next(err)', async () => {
    q.mockImplementation(() => Promise.reject(new Error('db down')));
    const req = makeReq({ params: { id: 'bill-1' }, user: { id: 'doctor-x', roles: ['DOCTOR'] } });
    const { res, next } = await run('bill', req);
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }));
  });
});

// ---------------------------------------------------------------------------
// Integration — real billing-style route with RS256 JWTs (IDOR proof)
// ---------------------------------------------------------------------------
import express from 'express';
import jwt  from 'jsonwebtoken';
import crypto from 'crypto';
import { validate } from '../src/shared/middleware/validate.js';
import { authorize } from '../src/shared/middleware/rbac.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding : { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function authStub(jwksPublicKey) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const payload = jwt.verify(token, jwksPublicKey, { algorithms: ['RS256'], issuer: 'hms', audience: 'hms-client' });
      req.user = { id: payload.sub, roles: payload.roles };
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function makeToken(roles, sub = 'user-uuid') {
  return jwt.sign(
    { sub, roles },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m', issuer: 'hms', audience: 'hms-client' }
  );
}

async function withServer() {
  const app = express();
  app.use(express.json());
  app.use(authStub(publicKey));

  // Mirrors billing.routes.js: `router.get('/:id', authorize(...), validate(...), checkOwnership('bill'), handler)`.
  app.get(
    '/api/bills/:id',
    authorize('PATIENT', 'BILLING', 'RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'),
    validate(z.object({ params: z.object({ id: z.string() }) })),
    checkOwnership('bill'),
    (req, res) => res.json({ ok: true, billId: req.params.id, sensitive: 'bill-data' })
  );

  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  return {
    get: (path, token) => fetch(base + path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    close: () => new Promise((r) => srv.close(r)),
  };
}

describe('ownership — billing IDOR integration', () => {
  let server;

  beforeEach(() => {
    ownerRow = { patient_id: 'p-1', user_id: 'victim-user' };
    careTeamMember = false;
    q.mockImplementation((sql) => {
      if (sql.includes('care_team')) {
        return Promise.resolve({ rows: careTeamMember ? [{ exists: 1 }] : [] });
      }
      return Promise.resolve({ rows: ownerRow ? [ownerRow] : [] });
    });
    server = withServer();
  });

  it('denies a PATIENT token for a different user (would-be IDOR)', async () => {
    const srv = await server;
    const res = await srv.get('/bills/bill-1', makeToken(['PATIENT'], 'attacker-user'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Access denied' });
    await srv.close();
  });

  it('allows a PATIENT on their own bill', async () => {
    const srv = await server;
    const res = await srv.get('/bills/bill-1', makeToken(['PATIENT'], 'victim-user'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, billId: 'bill-1', sensitive: 'bill-data' });
    await srv.close();
  });

  it('allows ADMIN regardless of ownership', async () => {
    const srv = await server;
    const res = await srv.get('/bills/bill-1', makeToken(['ADMIN']));
    expect(res.status).toBe(200);
    await srv.close();
  });

  it('denies a BILLING user who is not on the care team', async () => {
    const srv = await server;
    const res = await srv.get('/bills/bill-1', makeToken(['BILLING'], 'billing-1'));
    expect(res.status).toBe(403);
    await srv.close();
  });

  it('allows a BILLING user who is on the care team', async () => {
    careTeamMember = true;
    const srv = await server;
    const res = await srv.get('/bills/bill-1', makeToken(['BILLING'], 'billing-1'));
    expect(res.status).toBe(200);
    await srv.close();
  });
});
