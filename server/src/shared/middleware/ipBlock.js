import { logger } from '../logger.js';
import { isIpBlocked } from '../../modules/admin/admin.service.js';

/**
 * IP block-list gate for all /api requests.
 *
 * Redis is only a cache — blocked_ips in Postgres is the source of truth.
 * isIpBlocked() falls back to Postgres automatically when the cache is
 * unavailable, so a Redis blip must not take the app down: every request still
 * gets a real block-list check against the DB.
 *
 * FAIL-CLOSED only when the block list truly cannot be determined by ANY
 * means — i.e. the Postgres query itself fails (the database is unreachable).
 * At that point the whole app is down anyway, so 503 is the honest answer, not
 * an over-reaction to a cache-layer outage.
 */
export async function ipBlockMiddleware(req, res, next) {
  try {
    const blocked = await isIpBlocked(req.ip);
    if (blocked) return res.status(403).json({ error: 'Access denied.' });
    next();
  } catch (err) {
    logger.error('[ipblock] Block-list check failed — rejecting request:', {
      requestId: req.requestId,
      message  : err.message,
    });
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}
