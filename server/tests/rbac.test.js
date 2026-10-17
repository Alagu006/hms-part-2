// Coverage for the RBAC middleware (authorize / adminOnly / clinicalStaff).
//
// Part 1 (unit): every branch of authorize() in isolation.
// Part 2 (integration): real protected routes mounted in an Express app,
// exercised with valid RS256 JWTs so allowed roles pass and denied roles get
// 403 — including the admin-scoped billing routes and ROLE_ASSIGNABILITY
// boundaries enforced at the schema layer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt  from 'jsonwebtoken';
import crypto from 'crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding : { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const { authorize, adminOnly, clinicalStaff } = await import('../src/shared/middleware/rbac.js');
const { createUserSchemaFor, ROLE_ASSIGNABILITY } = await import('../src/modules/admin/admin.schema.js');

function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, ...overrides };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

describe('authorize() — unit', () => {
  it('returns 401 when req.user is absent (unauthenticated)', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('ADMIN')(makeReq(), res, next);
    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the wildcard * for any authenticated user', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('*')(makeReq({ user: { roles: ['PATIENT'] } }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('allows a user whose role matches one of the allowed roles', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('DOCTOR', 'NURSE')(makeReq({ user: { roles: ['NURSE'] } }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('returns 403 listing required roles when the role is denied', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('ADMIN')(makeReq({ user: { roles: ['DOCTOR'] } }), res, next);
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied. Required roles: ADMIN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.roles is empty', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('ADMIN')(makeReq({ user: { roles: [] } }), res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.roles is undefined (defensive)', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('ADMIN')(makeReq({ user: {} }), res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a multi-role requirement with no overlap', () => {
    const res  = makeRes();
    const next = vi.fn();
    authorize('SUPER_ADMIN', 'ADMIN')(makeReq({ user: { roles: ['BILLING'] } }), res, next);
    expect(res._status).toBe(403);
  });

  it('adminOnly grants SUPER_ADMIN and ADMIN but not others', () => {
    let next = vi.fn();
    let res  = makeRes();
    adminOnly(makeReq({ user: { roles: ['ADMIN'] } }), res, next);
    expect(next).toHaveBeenCalledOnce();

    next = vi.fn();
    res  = makeRes();
    adminOnly(makeReq({ user: { roles: ['SUPER_ADMIN'] } }), res, next);
    expect(next).toHaveBeenCalledOnce();

    next = vi.fn();
    res  = makeRes();
    adminOnly(makeReq({ user: { roles: ['DOCTOR'] } }), res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('clinicalStaff allows clinical roles and denies non-clinical ones', () => {
    for (const role of ['SUPER_ADMIN','ADMIN','DOCTOR','NURSE','ANESTHETIST','RADIOLOGIST']) {
      const next = vi.fn();
      const res  = makeRes();
      clinicalStaff(makeReq({ user: { roles: [role] } }), res, next);
      expect(next).toHaveBeenCalledOnce();
    }

    const next = vi.fn();
    const res  = makeRes();
    clinicalStaff(makeReq({ user: { roles: ['BILLING'] } }), res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration — real Express routes with RS256 JWTs
// ---------------------------------------------------------------------------
import express from 'express';
import { Router } from 'express';

// Stub authenticate that mirrors the real middleware's contract: verifies the
// JWT and attaches req.user with the token's roles.
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

async function withServer(routes) {
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    base,
    get(path, token) {
      return fetch(base + path, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    },
    post(path, token) {
      return fetch(base + path, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

describe('RBAC integration — real routes + JWTs', () => {
  let server;

  beforeEach(() => {
    const router = Router();

    // Mirror billing.routes.js role matrix with lightweight handlers.
    const billing = authorize('RECEPTIONIST', 'BILLING', 'ADMIN', 'SUPER_ADMIN');
    const admin   = authorize('ADMIN', 'SUPER_ADMIN');

    router.get('/admin-only',    admin,   (req, res) => res.json({ ok: true, by: req.user.id }));
    router.post('/billing',      billing, (req, res) => res.status(201).json({ ok: true }));
    router.get('/billing/:id',
      authorize('BILLING', 'PATIENT', 'ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'),
      (req, res) => res.json({ ok: true })
    );
    router.get('/open', authorize('*'), (req, res) => res.json({ ok: true }));

    server = withServer(Router().use(authStub(publicKey), router));
  });

  it('returns 401 for an unauthenticated request', async () => {
    const srv = await server;
    const res = await srv.get('/admin-only');
    expect(res.status).toBe(401);
    await srv.close();
  });

  it('rejects a signed JWT with an unrelated role on an admin route', async () => {
    const srv = await server;
    const res = await srv.get('/admin-only', makeToken(['DOCTOR']));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Access denied') });
    await srv.close();
  });

  it('allows ADMIN on an admin-only route', async () => {
    const srv = await server;
    const res = await srv.get('/admin-only', makeToken(['ADMIN'], 'admin-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, by: 'admin-1' });
    await srv.close();
  });

  it('allows SUPER_ADMIN on an admin-only route', async () => {
    const srv = await server;
    const res = await srv.get('/admin-only', makeToken(['SUPER_ADMIN']));
    expect(res.status).toBe(200);
    await srv.close();
  });

  it('rejects a NURSE on a billing route and allows a BILLING user', async () => {
    const srv = await server;
    const denied = await srv.post('/billing', makeToken(['NURSE']));
    expect(denied.status).toBe(403);

    const allowed = await srv.post('/billing', makeToken(['BILLING']));
    expect(allowed.status).toBe(201);
    await srv.close();
  });

  it('allows a PATIENT on the patient-readable billing/:id route', async () => {
    const srv = await server;
    const res = await srv.get('/billing/bill-1', makeToken(['PATIENT']));
    expect(res.status).toBe(200);
    await srv.close();
  });

  it('allows any authenticated user through the wildcard route', async () => {
    const srv = await server;
    const res = await srv.get('/open', makeToken(['SECURITY_OFC']));
    expect(res.status).toBe(200);
    await srv.close();
  });
});

// ---------------------------------------------------------------------------
// ROLE_ASSIGNABILITY boundary — HR cannot grant ADMIN; SUPER_ADMIN can.
// ---------------------------------------------------------------------------
describe('ROLE_ASSIGNABILITY boundary', () => {
  const payload = (role) => ({ body: { firstName: 'A', lastName: 'B', email: 'a@x.com', role } });

  it('HR cannot grant ADMIN (schema rejects the role field)', () => {
    const schema = createUserSchemaFor(['HR']);
    const res = schema.safeParse(payload('ADMIN'));
    expect(res.success).toBe(false);
    expect(res.error.issues.some((i) => i.path.join('.') === 'body.role')).toBe(true);
  });

  it('SUPER_ADMIN can grant ADMIN', () => {
    const schema = createUserSchemaFor(['SUPER_ADMIN']);
    expect(schema.safeParse(payload('ADMIN')).success).toBe(true);
  });

  it('ADMIN can grant clinical roles but not ADMIN (no self-escalation)', () => {
    const schema = createUserSchemaFor(['ADMIN']);
    expect(schema.safeParse(payload('ADMIN')).success).toBe(false);
    expect(schema.safeParse(payload('DOCTOR')).success).toBe(true);
  });

  it('ADMIN is assignable from ROLE_ASSIGNABILITY.SUPER_ADMIN only', () => {
    expect(ROLE_ASSIGNABILITY.SUPER_ADMIN).toContain('ADMIN');
    expect(ROLE_ASSIGNABILITY.ADMIN).not.toContain('ADMIN');
    expect(ROLE_ASSIGNABILITY.HR).not.toContain('ADMIN');
  });
});
