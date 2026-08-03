// Coverage for rateLimiter.js: Redis-outage behavior — auth routes fail closed
// (503) while non-auth routes stay fail-open.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const m = vi.hoisted(() => ({
  redis: { multi: vi.fn(), status: 'ready' },
}));

vi.mock('../src/shared/services/redis.service.js', () => ({ redis: m.redis }));
vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { rateLimiter } = await import('../src/shared/middleware/rateLimiter.js');

// ioredis multi() returns a chainable stub; exec() resolves [err, result][].
function mockMulti(execImpl) {
  const multi = {};
  multi.zremrangebyscore = vi.fn(() => multi);
  multi.zadd             = vi.fn(() => multi);
  multi.zcard            = vi.fn(() => multi);
  multi.expire           = vi.fn(() => multi);
  multi.exec             = execImpl;
  return multi;
}

function makeReq() {
  return { ip: '1.2.3.4', method: 'POST', path: '/auth/login', requestId: 'rid' };
}

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status     = (s) => { res._status = s; return res; };
  res.json       = (b) => { res._body = b; return res; };
  res.setHeader  = (k, v) => { res._headers[k] = v; };
  return res;
}

// results[2][1] is the zcard count.
const belowLimit = [[null, 1], [null, 1], [null, 3],  [null, 1]];
const overLimit  = [[null, 1], [null, 1], [null, 21], [null, 1]];

describe('rateLimiter — fail-closed on auth routes (failClosed: true)', () => {
  beforeEach(() => { vi.clearAllMocks(); m.redis.status = 'ready'; });

  it('returns 503 when Redis is unreachable instead of letting the request through', async () => {
    m.redis.multi.mockReturnValue(mockMulti(() => Promise.reject(new Error('ECONNREFUSED'))));

    const limiter = rateLimiter({
      windowSecs: 15 * 60,
      max       : 20,
      keyFn     : (req) => `auth:${req.ip}`,
      failClosed: true,
    });

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Service temporarily unavailable' });
    expect(next).not.toHaveBeenCalled();
  });

  it('still fails closed on a later Redis outage even after earlier successes', async () => {
    // First request succeeds (Redis healthy)
    m.redis.multi.mockReturnValueOnce(mockMulti(() => Promise.resolve(belowLimit)));
    const limiter = rateLimiter({ windowSecs: 60, max: 200, failClosed: true });
    await limiter(makeReq(), makeRes(), vi.fn());

    // Redis goes down
    m.redis.multi.mockReturnValueOnce(mockMulti(() => Promise.reject(new Error('down'))));
    const res = makeRes(), next = vi.fn();
    await limiter(makeReq(), res, next);

    expect(res._status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 immediately when Redis is not ready (fast path, no multi call)', async () => {
    m.redis.status = 'connecting';

    const limiter = rateLimiter({
      windowSecs: 15 * 60,
      max       : 20,
      keyFn     : (req) => `auth:${req.ip}`,
      failClosed: true,
    });

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Service temporarily unavailable' });
    expect(m.redis.multi).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('still throttles with 429 when over limit (failClosed does not alter normal behavior)', async () => {
    m.redis.multi.mockReturnValue(mockMulti(() => Promise.resolve(overLimit)));

    const limiter = rateLimiter({ windowSecs: 60, max: 20, failClosed: true });
    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(res._status).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when under limit', async () => {
    m.redis.multi.mockReturnValue(mockMulti(() => Promise.resolve(belowLimit)));

    const limiter = rateLimiter({ windowSecs: 60, max: 20, failClosed: true });
    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });
});

describe('rateLimiter — fail-open default (non-auth routes)', () => {
  beforeEach(() => { vi.clearAllMocks(); m.redis.status = 'ready'; });

  it('calls next() when Redis is unreachable and failClosed is omitted', async () => {
    m.redis.multi.mockReturnValue(mockMulti(() => Promise.reject(new Error('ECONNREFUSED'))));

    const limiter = rateLimiter({ windowSecs: 60, max: 200 });
    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('bypasses (calls next) immediately when Redis is not ready — fast fail-open', async () => {
    m.redis.status = 'reconnecting';

    const limiter = rateLimiter({ windowSecs: 60, max: 200 });
    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(res._status).toBeNull();
    expect(m.redis.multi).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() when Redis is unreachable and failClosed is explicitly false', async () => {
    m.redis.multi.mockReturnValue(mockMulti(() => Promise.reject(new Error('ECONNREFUSED'))));

    const limiter = rateLimiter({ windowSecs: 60, max: 200, failClosed: false });
    const req = makeReq(), res = makeRes(), next = vi.fn();
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
