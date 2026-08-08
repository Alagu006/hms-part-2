import pg from 'pg';
import { logger } from '../logger.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// PgBouncer-compatible pool config
// statement_timeout and other session-level settings must be avoided when
// using PgBouncer in transaction pooling mode.
//
// The app connects as the LEAST-PRIVILEGE role hms_api (DB_USER/DB_PASSWORD) —
// DML only, no DDL, no superuser. Schema changes belong to hms_migrator and are
// applied via `npm run migrate` (src/db/migrate.js), which uses its own pool.
// ---------------------------------------------------------------------------
export const pool = new Pool({
  host              : process.env.DB_HOST,
  port              : parseInt(process.env.DB_PORT || '5555', 10),
  database          : process.env.DB_NAME,
  user              : process.env.DB_USER,
  password          : process.env.DB_PASSWORD,
  max               : parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis : 30_000,
  connectionTimeoutMillis: 5_000,
  // PgBouncer compatibility: disable prepared statements
  allowExitOnIdle   : false,
  // SSL in production
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
});

pool.on('error', (err) => {
  logger.error('[pool] Unexpected client error', { message: err.message });
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('[pool] New client connected');
  }
});

// ---------------------------------------------------------------------------
// Slow query threshold
// ---------------------------------------------------------------------------
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '500', 10);

/**
 * Parameterized query wrapper with slow-query logging.
 *
 * @param {string}  sql
 * @param {Array}   [params=[]]
 * @param {object}  [client]  — pass an existing client for transactions
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(sql, params = [], client = null) {
  const runner = client ?? (testClient ?? pool);
  const start  = Date.now();

  try {
    const result = await runner.query(sql, params);
    const elapsed = Date.now() - start;

    if (elapsed > SLOW_QUERY_MS) {
      logger.warn('[pool] Slow query', {
        elapsed,
        sql   : sql.replace(/\s+/g, ' ').trim(),
        params: JSON.stringify(params),
      });
    }

    return result;
  } catch (err) {
    logger.error('[pool] Query error', {
      message: err.message,
      sql    : sql.replace(/\s+/g, ' ').trim(),
      params : JSON.stringify(params),
    });
    throw err;
  }
}

/**
 * Run multiple queries in a transaction.
 * Automatically acquires a client, begins, commits or rolls back.
 *
 * @param {function} fn  — async (client) => any
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Integration-test hook (DB-backed test harness)
// ---------------------------------------------------------------------------
// The unit suite mocks pool.query, so it can never prove that SQL actually
// runs against the real schema — that blind spot let six production features
// ship 100% broken with green tests. The integration harness (tests/integration)
// routes every query issued through this module onto ONE client that holds a
// transaction, which is rolled back after each test.
//
// Two entry points are covered:
//   - pool.query(...) and query(...)  → routed to the test client
//   - pool.connect()                  → returns the test client (its internal
//     BEGIN/COMMIT/ROLLBACK become SAVEPOINTs so the outer test transaction
//     still owns isolation, and release() is a no-op since it is not pooled)
let testClient = null;

/** @param {import('pg').Client} client */
export function setTestClient(client) { testClient = client; }

export function clearTestClient() { testClient = null; }

export function getTestClient() { return testClient; }

// Route pool.query through the active test client when one is set.
const poolQuery = pool.query.bind(pool);
pool.query = (sql, params) => {
  if (testClient) return testClient.query(sql, params);
  return poolQuery(sql, params);
};

// pool.connect() returns the test client so transaction-owning services
// (auditLog, refundBill, ...) stay inside the same rollback-able transaction.
const poolConnect = pool.connect.bind(pool);
pool.connect = () => (testClient ? Promise.resolve(testClient) : poolConnect());
