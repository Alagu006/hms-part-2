import { redis } from '../../shared/services/redis.service.js';

/**
 * Sliding window rate limiter backed by Redis.
 *
 * @param {object} opts
 * @param {number}   opts.windowSecs  - Window size in seconds
 * @param {number}   opts.max         - Max requests per window
 * @param {function} [opts.keyFn]     - (req) => string — custom key builder
 */
export function rateLimiter({ windowSecs, max, keyFn }) {
  return async (req, res, next) => {
    const key = keyFn
      ? `rl:${keyFn(req)}`
      : `rl:${req.ip}:${req.method}:${req.path}`;

    try {
      const now      = Date.now();
      const windowMs = windowSecs * 1000;
      const cutoff   = now - windowMs;

      // Sliding window using a sorted set
      // Score = timestamp ms, member = unique request id
      const multi = redis.multi();
      multi.zremrangebyscore(key, '-inf', cutoff);
      multi.zadd(key, now, `${now}-${Math.random()}`);
      multi.zcard(key);
      multi.expire(key, windowSecs);

      const results = await multi.exec();
      const count   = results[2][1]; // zcard result

      res.setHeader('X-RateLimit-Limit',     max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset',     Math.ceil((now + windowMs) / 1000));

      if (count > max) {
        return res.status(429).json({
          error: 'Too many requests. Please slow down.',
        });
      }

      next();
    } catch (err) {
      // If Redis is down, fail open (log and continue)
      console.error('[rateLimiter] Redis error:', err.message);
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
  windowSecs: 15 * 60,
  max       : isDev ? 100 : 20,
  keyFn     : (req) => `auth:${req.ip}`,
});

/** Login-specific: 5 attempts / 15 min per IP+username (50 in dev) */
export const loginRateLimiter = rateLimiter({
  windowSecs: 15 * 60,
  max       : isDev ? 50 : 5,
  keyFn     : (req) => `login:${req.ip}:${req.body?.username ?? 'unknown'}`,
});

/** OTP / forgot-password: 10 req / 15 min per IP (50 in dev) */
export const otpRateLimiter = rateLimiter({
  windowSecs: 15 * 60,
  max       : isDev ? 50 : 10,
  keyFn     : (req) => `otp:${req.ip}`,
});

/** General API limiter: 200 req / min per IP */
export const apiRateLimiter = rateLimiter({
  windowSecs: 60,
  max       : 200,
  keyFn     : (req) => `api:${req.ip}`,
});
