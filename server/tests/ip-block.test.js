// Coverage for ipBlock.js: the /api IP block-list gate consults isIpBlocked()
// on every request and FAILS CLOSED only when the block list truly cannot be
// determined (Postgres unreachable). Redis is a cache, so a Redis blip must
// not take the app down — isIpBlocked() falls back to Postgres and the request
// proceeds normally.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const m = vi.hoisted(() => ({
  isIpBlocked: vi.fn(),
  redis: { status: 'ready' },
}));

vi.mock('../src/modules/admin/admin.service.js', () => ({ isIpBlocked: m.isIpBlocked }));
vi.mock('../src/shared/services/redis.service.js', () => ({ redis: m.redis }));
vi.mock('../src/shared/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ipBlockMiddleware } = await import('../src/shared/middleware/ipBlock.js');

function makeReq() {
  return { ip: '1.2.3.4', requestId: 'rid' };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

describe('ipBlockMiddleware — fail-closed block-list gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.redis.status = 'ready';
  });

  it('calls next() when the IP is not blocked', async () => {
    m.isIpBlocked.mockResolvedValue(false);

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await ipBlockMiddleware(req, res, next);

    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when the IP is blocked', async () => {
    m.isIpBlocked.mockResolvedValue(true);

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await ipBlockMiddleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 (fail-closed) when the block list cannot be determined by any means', async () => {
    m.isIpBlocked.mockRejectedValue(new Error('Connection refused'));

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await ipBlockMiddleware(req, res, next);

    expect(res._status).toBe(503);
    expect(res._body).toEqual({ error: 'Service temporarily unavailable' });
    expect(next).not.toHaveBeenCalled();
  });

  it('Redis down + Postgres up — still consults isIpBlocked (Postgres fallback) instead of short-circuiting on Redis status', async () => {
    // Regression guard: the middleware must NOT fast-reject when Redis is not
    // ready. It must call isIpBlocked() normally so the Postgres fallback in
    // admin.service runs; a clean block-list answer lets the request through.
    m.redis.status = 'connecting';
    m.isIpBlocked.mockResolvedValue(false);

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await ipBlockMiddleware(req, res, next);

    expect(m.isIpBlocked).toHaveBeenCalledWith('1.2.3.4');
    expect(res._status).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('Redis down + Postgres up — a genuinely blocked IP still gets 403 (not let through)', async () => {
    m.redis.status = 'connecting';
    m.isIpBlocked.mockResolvedValue(true);

    const req = makeReq(), res = makeRes(), next = vi.fn();
    await ipBlockMiddleware(req, res, next);

    expect(m.isIpBlocked).toHaveBeenCalledWith('1.2.3.4');
    expect(res._status).toBe(403);
    expect(res._body).toEqual({ error: 'Access denied.' });
    expect(next).not.toHaveBeenCalled();
  });
});
