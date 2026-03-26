import pg from 'pg';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// PgBouncer-compatible pool config
// statement_timeout and other session-level settings must be avoided when
// using PgBouncer in transaction pooling mode.
// ---------------------------------------------------------------------------
export const pool = new Pool({
  host              : process.env.DB_HOST,
  port              : parseInt(process.env.DB_PORT || '5432', 10),
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
  console.error('[pool] Unexpected client error:', err.message);
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[pool] New client connected');
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
  const runner = client ?? pool;
  const start  = Date.now();

  try {
    const result = await runner.query(sql, params);
    const elapsed = Date.now() - start;

    if (elapsed > SLOW_QUERY_MS) {
      console.warn(
        `[pool] Slow query (${elapsed}ms):\n  SQL: ${sql.replace(/\s+/g, ' ').trim()}\n  Params: ${JSON.stringify(params)}`
      );
    }

    return result;
  } catch (err) {
    console.error(
      `[pool] Query error: ${err.message}\n  SQL: ${sql.replace(/\s+/g, ' ').trim()}\n  Params: ${JSON.stringify(params)}`
    );
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
