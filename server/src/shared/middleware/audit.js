import crypto from 'crypto';
import { pool } from '../db/pool.js';

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
export async function auditLog({
  userId,
  action,
  entity,
  entityId = null,
  prevData = null,
  nextData = null,
  ip       = null,
  userAgent = null,
}) {
  try {
    // Fetch the hash of the most recent audit row to build the chain
    const { rows } = await pool.query(
      `SELECT row_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1`
    );
    const prevHash = rows[0]?.row_hash ?? null;

    // Build a deterministic string to hash for this row
    const rowContent = JSON.stringify({
      userId, action, entity, entityId,
      prevData, nextData, ip, prevHash,
      ts: new Date().toISOString(),
    });
    const rowHash = crypto.createHash('sha256').update(rowContent).digest('hex');

    await pool.query(
      `INSERT INTO audit_logs
         (id, user_id, action, entity, entity_id, prev_data, next_data,
          ip_address, user_agent, prev_hash, row_hash, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        userId   || null,
        action,
        entity,
        entityId || null,
        prevData  ? JSON.stringify(prevData)  : null,
        nextData  ? JSON.stringify(nextData)  : null,
        ip        || null,
        userAgent || null,
        prevHash,
        rowHash,
      ]
    );
  } catch (err) {
    // Audit failures must never crash the main request
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Express middleware — auto-logs every mutating request after response
// ---------------------------------------------------------------------------
export function auditMiddleware(req, res, next) {
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutatingMethods.includes(req.method)) return next();

  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Fire-and-forget after response is sent
    setImmediate(() => {
      auditLog({
        userId   : req.user?.id ?? null,
        action   : req.method,
        entity   : req.baseUrl + req.path,
        ip       : req.ip,
        userAgent: req.headers['user-agent'],
        nextData : res.statusCode < 400 ? { status: res.statusCode } : null,
      });
    });
    return originalJson(body);
  };

  next();
}
