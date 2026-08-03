import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Core audit log writer — call this directly from service/controller layers
// ---------------------------------------------------------------------------

/**
 * Writes a tamper-evident audit log entry.
 *
 * @param {object} opts
 * @param {string}  opts.userId    - Acting user UUID (null for system actions)
 * @param {string}  opts.action    - e.g. 'CREATE', 'UPDATE', 'DELETE', 'LOGIN'
 * @param {string}  opts.entity    - Table/entity name e.g. 'users', 'appointments'
 * @param {string}  [opts.entityId]  - UUID of the affected row
 * @param {object}  [opts.prevData]  - State before mutation
 * @param {object}  [opts.nextData]  - State after mutation
 * @param {string}  [opts.ip]        - Client IP
 * @param {string}  [opts.userAgent] - Client user-agent
 */
export async function auditLog(userIdOrOpts, action, entity, entityId, prevData, nextData, ip, userAgent) {
  // Support both calling styles:
  // auditLog({ userId, action, entity, ... })  — named object
  // auditLog(userId, action, entity, ...)       — positional args (legacy)
  let opts;
  if (userIdOrOpts && typeof userIdOrOpts === 'object' && !Array.isArray(userIdOrOpts)) {
    opts = userIdOrOpts;
  } else {
    opts = { userId: userIdOrOpts, action, entity, entityId, prevData, nextData, ip, userAgent };
  }

  const {
    userId    = null,
    action:   act,
    entity:   ent,
    entityId: eid  = null,
    prevData: prev = null,
    nextData: next = null,
    ip:       ipAddr = null,
    userAgent: ua    = null,
  } = opts;

  if (!act || !ent) {
    logger.error('[audit] Skipping log — missing action or entity', { action: act, entity: ent });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize all audit writes with a single advisory lock
      await client.query('SELECT pg_advisory_xact_lock(7891234)');

      const { rows } = await client.query(
        `SELECT row_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1`
      );
      const prevHash = rows[0]?.row_hash ?? null;

      const rowContent = [userId, act, ent, eid, ipAddr, prevHash, Date.now()].join('|');
      const rowHash = crypto.createHash('sha256').update(rowContent).digest('hex');

      await client.query(
        `INSERT INTO audit_logs
           (id, user_id, action, entity, entity_id, prev_data, next_data,
            ip_address, user_agent, prev_hash, row_hash, created_at)
         VALUES
           (gen_random_uuid(), $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, clock_timestamp())`,
        [
          userId    || null,
          act,
          ent,
          eid       || null,
          prev      ? JSON.stringify(prev)  : null,
          next      ? JSON.stringify(next)  : null,
          ipAddr    || null,
          ua        || null,
          prevHash,
          rowHash,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('[audit] Failed to write audit log:', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Express middleware — auto-logs every request after response
// ---------------------------------------------------------------------------
export function auditMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    const method    = req.method;
    const baseUrl   = req.baseUrl;
    const path      = req.path;
    const userId    = req.user?.id ?? null;
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'];
    const status    = res.statusCode;

    setImmediate(() => {
      if (!method) return; // safety guard
      const action = method === 'GET' ? 'VIEW' : method;
      auditLog({
        userId,
        action,
        entity   : baseUrl + path,
        ip,
        userAgent,
        nextData : status < 400 ? { status } : null,
      });
    });
    return originalJson(body);
  };

  next();
}
