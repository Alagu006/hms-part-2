import crypto from 'crypto';
import { redis } from '../../shared/services/redis.service.js';
import { logger } from '../logger.js';

/**
 * Sliding window rate limiter backed by Redis.
 *
 * @param {object} opts
 * @param {number}   opts.windowSecs  - Window size in seconds
 * @param {number}   opts.max         - Max requests per window
 * @param {function} [opts.keyFn]     - (req) => string — custom key builder
 * @param {boolean}  [opts.failClosed] - true → return 503 when Redis is
 *   unreachable instead of letting the request through unthrottled.
 *   Use ONLY on security-sensitive routes (auth). Defaults to fail-open.
 */
export function rateLimiter({ windowSecs, max, keyFn, failClosed = false }) {
  return async (req, res, next) => {
    const key = keyFn
      ? `rl:${keyFn(req)}`
      : `rl:${req.ip}:${req.method}:${req.path}`;

    // Redis-unreachable fast path: with maxRetriesPerRequest:null a command
    // would block for the entire reconnect backoff (~minutes). Instead, when the
    // client is not 'ready' fail closed on auth routes (503) and fail open
    // (bypass) elsewhere — never let a throttled request hang or slip through
    // unchecked on a security-sensitive route.
    if (redis.status !== 'ready') {
      if (failClosed) {
        logger.error('[rateLimiter] Redis not ready — rejecting request:', { status: redis.status });
        return res.status(503).json({ error: 'Service temporarily unavailable' });
      }
      logger.warn('[rateLimiter] Redis not ready — bypassing limiter:', { status: redis.status });
      return next();
    }

    try {
      const now      = Date.now();
      const windowMs = windowSecs * 1000;
      const cutoff   = now - windowMs;

      // Sliding window using a sorted set
      // Score = timestamp ms, member = unique request id
      const multi = redis.multi();
      multi.zremrangebyscore(key, '-inf', cutoff);
      multi.zadd(key, now, `${now}-${crypto.randomBytes(8).toString('hex')}`);
      multi.zcard(key);
      multi.expire(key, windowSecs);

      const results = await multi.exec();
      const count   = results[2][1]; // zcard result

      res.setHeader('X-RateLimit-Limit',     max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset',     Math.ceil((now + windowMs) / 1000));

      if (count > max) {
        logger.warn('RATE_LIMIT_EXCEEDED', {
          ip       : req.ip,
          path     : req.path,
          limit    : max,
          requestId: req.requestId,
        });
        return res.status(429).json({
          error: 'Too many requests. Please slow down.',
        });
      }

      next();
    } catch (err) {
      // FAIL-CLOSED: on auth routes an unreachable Redis must never let the
      // request through unthrottled — reject with 503 (mirrors auth.js).
      logger.error('[rateLimiter] Redis error:', { message: err.message, failClosed });
      if (failClosed) {
        return res.status(503).json({ error: 'Service temporarily unavailable' });
      }
      // Default (fail-open): log and continue — only used for non-auth
      // endpoints where availability matters more than strict throttling.
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Pre-configured limiters
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV !== 'production';

/** Strict limiter for auth endpoints: 20 req / 15 min per IP (100 in dev) */
export const authRateLimiter = rateLimiter({
  windowSecs : 15 * 60,
  max        : isDev ? 100 : 20,
  keyFn      : (req) => `auth:${req.ip}`,
  failClosed : true,
});

/** Login-specific: 5 attempts / 15 min per IP+username (50 in dev) */
export const loginRateLimiter = rateLimiter({
  windowSecs : 15 * 60,
  max        : isDev ? 50 : 5,
  keyFn      : (req) => `login:${req.ip}:${req.body?.username ?? 'unknown'}`,
  failClosed : true,
});

/** OTP / forgot-password: 10 req / 15 min per IP (50 in dev) */
export const otpRateLimiter = rateLimiter({
  windowSecs : 15 * 60,
  max        : isDev ? 50 : 10,
  keyFn      : (req) => `otp:${req.ip}`,
  failClosed : true,
});

/** General API limiter: 200 req / min per IP */
// Deliberately fail-open: throttling is a DoS-mitigation here, not an
// authorization control. Auth endpoints are independently fail-closed via the
// three limiters above, so a Redis outage still blocks brute-force on them.
export const apiRateLimiter = rateLimiter({
  windowSecs: 60,
  max       : 200,
  keyFn     : (req) => `api:${req.ip}`,
});
