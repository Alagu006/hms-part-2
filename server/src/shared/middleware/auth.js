import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PUBLIC_KEY } from '../../modules/auth/auth.service.js';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';

// Must match the hashing used at session creation (auth.service.js hashField):
// sha256 hex truncated to 16 chars. Kept local so the middleware does not have
// to reach into auth.service beyond PUBLIC_KEY.
function hashContext(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Verifies the RS256 JWT from the Authorization: Bearer header.
 * After successful JWT verification, validates the embedded sessionId
 * against the sessions table to detect revoked sessions within the JWT window.
 * Attaches decoded payload to req.user on success.
 *
 * Session-revocation is AUTHORITATIVE and re-checked on EVERY request (do not
 * remove for performance — the DB is the source of truth for revocation).
 *
 * Zero-trust context signal: if the request's IP or user-agent hash differs
 * from the values recorded at login, log a SESSION_CONTEXT_CHANGE warning and
 * best-effort flag the session (context_flagged_at). This is deliberately
 * NON-BLOCKING — IP/UA are weak identifiers that legitimately change (NAT,
 * browser updates), so blocking would cause availability problems. The signal
 * gives security ops a trail; it never fails the request.
 *
 * FAIL-CLOSED: any DB error in the authoritative session check returns 503 —
 * the middleware never fails open.
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer    : process.env.JWT_ISSUER   || 'hms',
      audience  : process.env.JWT_AUDIENCE || 'hms-client',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Require a sessionId claim — tokens without one are rejected
  const sessionId = payload.sessionId ?? null;
  if (!sessionId) {
    return res.status(401).json({ error: 'Missing session ID' });
  }

  // Validate the session against the DB (fail-closed: DB errors → 503)
  try {
    const { rows } = await pool.query(
      `SELECT revoked_at, ip_hash, user_agent_hash, context_flagged_at
       FROM sessions WHERE id = $1`,
      [sessionId]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Session not found' });
    }

    if (rows[0].revoked_at !== null) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    // Zero-trust context signal — NON-BLOCKING (see module doc). Compare the
    // request's IP/UA hashes against the ones recorded at login. When they
    // differ AND the session has not already been flagged, log once and record
    // the flag. Never throws, never blocks the request.
    const { ip_hash: storedIp, user_agent_hash: storedUa, context_flagged_at: flaggedAt } = rows[0];
    const reqIp = hashContext(req.ip);
    const reqUa = hashContext(req.headers['user-agent']);

    const changed = [];
    if (storedIp && storedIp !== reqIp) changed.push('ip');
    if (storedUa && storedUa !== reqUa) changed.push('userAgent');

    if (changed.length > 0 && !flaggedAt) {
      logger.warn('SESSION_CONTEXT_CHANGE', {
        event   : 'SESSION_CONTEXT_CHANGE',
        userId  : payload.sub,
        sessionId,
        changed,
      });
      // Best-effort flag — a failure to record the signal must not fail the
      // request, so the flag write is fire-and-forget.
      pool.query(
        `UPDATE sessions SET context_flagged_at = NOW()
         WHERE id = $1 AND context_flagged_at IS NULL`,
        [sessionId]
      ).catch(() => {});
    }
  } catch {
    // DB unavailable — reject the request rather than failing open
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  req.user = {
    id          : payload.sub,
    roles       : payload.roles ?? [],
    departmentId: payload.departmentId,
    firstName   : payload.firstName,
    lastName    : payload.lastName,
    sessionId,
  };

  next();
}
