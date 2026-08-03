// Feature: zero-trust-security, Property 1: Revoked sessions are always rejected
// Feature: zero-trust-security, Property 2: Unknown sessions are always rejected

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

// Mock the pool so we can control DB responses without a real DB
vi.mock('../src/shared/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));

// Mock the PUBLIC_KEY export from auth.service — we'll use a test RS256 key pair
vi.mock('../src/modules/auth/auth.service.js', () => ({
  PUBLIC_KEY: null, // overridden per-test via jwt.sign with the private key
}));

// Mock the logger so the middleware's context-change warning can be asserted
vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../src/shared/db/pool.js';
import { logger } from '../src/shared/logger.js';

// ---------------------------------------------------------------------------
// Generate a throwaway RS256 key pair for tests
// ---------------------------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding : { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Patch the module-level PUBLIC_KEY used by authenticate
vi.doMock('../src/modules/auth/auth.service.js', () => ({ PUBLIC_KEY: publicKey }));

// Import authenticate AFTER mocks are set up
const { authenticate } = await import('../src/shared/middleware/auth.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 'user-uuid', roles: ['DOCTOR'], sessionId: 'session-uuid', ...payload },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m', issuer: 'hms', audience: 'hms-client' }
  );
}

function makeReq(token, { ip, userAgent } = {}) {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      ...(userAgent ? { 'user-agent': userAgent } : {}),
    },
    requestId: crypto.randomUUID(),
    ...(ip ? { ip } : {}),
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

// Matches the sha256 → 16-char-hex hashing used by login/auth middleware.
function ctxHash(v) {
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('authenticate middleware — session revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset PUBLIC_KEY mock to the generated key
    vi.doMock('../src/modules/auth/auth.service.js', () => ({ PUBLIC_KEY: publicKey }));
  });

  it('returns 401 "Session revoked" when revoked_at IS NOT NULL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: new Date() }] });

    const req  = makeReq(makeToken());
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Session revoked' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "Session not found" when session row does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req  = makeReq(makeToken());
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Session not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "Missing session ID" when JWT has no sessionId claim', async () => {
    const token = jwt.sign(
      { sub: 'user-uuid', roles: ['DOCTOR'] }, // no sessionId
      privateKey,
      { algorithm: 'RS256', expiresIn: '15m', issuer: 'hms', audience: 'hms-client' }
    );

    const req  = makeReq(token);
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ error: 'Missing session ID' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 503 when DB throws (fail-closed — never fail-open)', async () => {
    pool.query.mockRejectedValueOnce(new Error('Connection refused'));

    const req  = makeReq(makeToken());
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Service temporarily unavailable' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches req.user when session is valid (revoked_at IS NULL)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: null }] });

    const req  = makeReq(makeToken({ sessionId: 'valid-session' }));
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeDefined();
    expect(req.user.sessionId).toBe('valid-session');
  });

  it('returns 401 for missing Authorization header', async () => {
    const req  = { headers: {}, requestId: crypto.randomUUID() };
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  // Property 1: For any revoked sessionId, middleware always returns 401
  it('Property 1 — always rejects revoked sessions (10 random UUIDs)', async () => {
    for (let i = 0; i < 10; i++) {
      const sessionId = crypto.randomUUID();
      pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: new Date() }] });

      const token = jwt.sign(
        { sub: crypto.randomUUID(), roles: ['NURSE'], sessionId },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m', issuer: 'hms', audience: 'hms-client' }
      );

      const req  = makeReq(token);
      const res  = makeRes();
      const next = vi.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Session revoked');
      expect(next).not.toHaveBeenCalled();
    }
  });

  // Property 2: For any unknown sessionId, middleware always returns 401
  it('Property 2 — always rejects unknown sessions (10 random UUIDs)', async () => {
    for (let i = 0; i < 10; i++) {
      const sessionId = crypto.randomUUID();
      pool.query.mockResolvedValueOnce({ rows: [] }); // not found

      const token = jwt.sign(
        { sub: crypto.randomUUID(), roles: ['PATIENT'], sessionId },
        privateKey,
        { algorithm: 'RS256', expiresIn: '15m', issuer: 'hms', audience: 'hms-client' }
      );

      const req  = makeReq(token);
      const res  = makeRes();
      const next = vi.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Session not found');
      expect(next).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// Zero-trust context signal — IP/user-agent change mid-session.
// Logged + flagged, NEVER blocking.
// ---------------------------------------------------------------------------
describe('authenticate middleware — session context signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock('../src/modules/auth/auth.service.js', () => ({ PUBLIC_KEY: publicKey }));
    // Default: any un-queued call (e.g. the fire-and-forget flag UPDATE) resolves,
    // so pool.query(...).catch() receives a real promise like pg returns.
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('logs + flags once when the request IP differs from the login IP', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        revoked_at: null,
        ip_hash: ctxHash('1.2.3.4'),
        user_agent_hash: ctxHash('Chrome'),
        context_flagged_at: null,
      }],
    });

    const req  = makeReq(makeToken(), { ip: '9.9.9.9', userAgent: 'Chrome' });
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.sessionId).toBe('session-uuid');
    expect(logger.warn).toHaveBeenCalledWith('SESSION_CONTEXT_CHANGE', expect.objectContaining({
      userId   : 'user-uuid',
      sessionId: 'session-uuid',
      changed  : ['ip'],
    }));
    const flagUpdate = pool.query.mock.calls[1];
    expect(flagUpdate[0]).toContain('UPDATE sessions SET context_flagged_at = NOW()');
    expect(flagUpdate[1]).toEqual(['session-uuid']);
  });

  it('logs + flags when the user-agent differs from the login user-agent', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        revoked_at: null,
        ip_hash: ctxHash('1.2.3.4'),
        user_agent_hash: ctxHash('Chrome'),
        context_flagged_at: null,
      }],
    });

    const req  = makeReq(makeToken(), { ip: '1.2.3.4', userAgent: 'Firefox' });
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('SESSION_CONTEXT_CHANGE', expect.objectContaining({
      changed: ['userAgent'],
    }));
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('does NOT log or flag when IP and user-agent match the session', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        revoked_at: null,
        ip_hash: ctxHash('1.2.3.4'),
        user_agent_hash: ctxHash('Chrome'),
        context_flagged_at: null,
      }],
    });

    const req  = makeReq(makeToken(), { ip: '1.2.3.4', userAgent: 'Chrome' });
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1); // authoritative session check only
  });

  it('does NOT re-log or re-flag a session that is already context-flagged', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        revoked_at: null,
        ip_hash: ctxHash('1.2.3.4'),
        user_agent_hash: ctxHash('Chrome'),
        context_flagged_at: new Date(),
      }],
    });

    const req  = makeReq(makeToken(), { ip: '9.9.9.9', userAgent: 'Firefox' });
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('request still succeeds when the best-effort flag UPDATE fails', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        revoked_at: null,
        ip_hash: ctxHash('1.2.3.4'),
        user_agent_hash: ctxHash('Chrome'),
        context_flagged_at: null,
      }],
    });
    pool.query.mockRejectedValueOnce(new Error('db down')); // flag write fails

    const req  = makeReq(makeToken(), { ip: '9.9.9.9', userAgent: 'Chrome' });
    const res  = makeRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull(); // never turned into an error response
    expect(logger.warn).toHaveBeenCalledWith('SESSION_CONTEXT_CHANGE', expect.any(Object));
  });
});
