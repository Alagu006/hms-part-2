// Vitest globalSetup — provisions an isolated, throwaway `hms_test` database
// for the DB-backed integration suite (tests/integration).
//
// What it does:
//   1. Connects to the maintenance `postgres` DB as DB_SUPERUSER.
//   2. Drops + recreates the test DB (clean slate every run).
//   3. Bootstraps it exactly like a fresh environment: schema.sql baseline,
//      then every migration in order (recorded in schema_migrations), using
//      the hms_migrator role (DDL rights).
//
// It FAILS LOUDLY if the database cannot be provisioned — the integration
// suite is meaningless without a real Postgres. Unit tests do not require it.
//
// Env overrides (all default to the app DB_* values):
//   TEST_DB_NAME, TEST_DB_SUPERUSER, TEST_DB_SUPERUSER_PASSWORD,
//   TEST_MIGRATOR_USER, TEST_MIGRATOR_PASSWORD

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg   from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, '..');

const {
  DB_HOST, DB_PORT = '5555',
  DB_NAME,
  DB_SUPERUSER, DB_SUPERUSER_PASSWORD,
  DB_MIGRATOR_USER = 'hms_migrator', DB_MIGRATOR_PASSWORD,
} = process.env;

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'hms_test';

const superHost = process.env.TEST_DB_SUPERUSER_HOST || DB_HOST;
const superPort = process.env.TEST_DB_SUPERUSER_PORT || DB_PORT;
const superUser = process.env.TEST_DB_SUPERUSER || DB_SUPERUSER;
const superPass = process.env.TEST_DB_SUPERUSER_PASSWORD || DB_SUPERUSER_PASSWORD;

function adminPool() {
  return new pg.Pool({
    host              : superHost,
    port              : parseInt(superPort, 10),
    database          : 'postgres',
    user              : superUser,
    password          : superPass,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle   : false,
  });
}

async function terminateAndDrop(pool, dbName) {
  const { rows } = await pool.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName]
  );
  await pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
  return rows.length;
}

function quoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

export async function setup() {
  const started = Date.now();
  const admin = adminPool();

  // 1. Drop + recreate the test DB.
  await terminateAndDrop(admin, TEST_DB_NAME);
  await admin.query(`CREATE DATABASE ${quoteIdent(TEST_DB_NAME)}`);

  // 2. Provision role privileges on the fresh DB (mirrors setup-roles.js):
  //    migrator gets DDL (CREATE on DB), hms_api gets CONNECT.
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdent(TEST_DB_NAME)} TO hms_api, hms_migrator, hms_readonly`);
  await admin.query(`GRANT CREATE ON DATABASE ${quoteIdent(TEST_DB_NAME)} TO hms_migrator`);
  await admin.end();

  // Schema-level grants MUST run against the test DB itself (not the `postgres`
  // maintenance DB). In PG15+ a new DB's public schema is owned by
  // pg_database_owner, so hms_migrator needs CREATE granted here.
  const dbAdmin = adminPool();
  dbAdmin.options.database = TEST_DB_NAME;
  await dbAdmin.query(`GRANT USAGE, CREATE ON SCHEMA public TO hms_migrator`);
  await dbAdmin.query(`GRANT USAGE ON SCHEMA public TO hms_api, hms_readonly`);
  await dbAdmin.end();

  // 3. Bootstrap schema.sql + migrations via the migrator role.
  const migrator = new pg.Pool({
    host              : process.env.TEST_MIGRATOR_HOST || DB_HOST,
    port              : parseInt(process.env.TEST_MIGRATOR_PORT || DB_PORT, 10),
    database          : TEST_DB_NAME,
    user              : process.env.TEST_MIGRATOR_USER || DB_MIGRATOR_USER,
    password          : process.env.TEST_MIGRATOR_PASSWORD || DB_MIGRATOR_PASSWORD,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle   : false,
  });

  // schema.sql baseline
  const baseline = fs.readFileSync(path.join(SERVER_ROOT, 'src/db/schema.sql'), 'utf8');
  await migrator.query(baseline);

  // schema_migrations tracking table (migrate.js creates it too)
  await migrator.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // migrations in lexicographic order
  const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'src/db/migrations');
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await migrator.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[global-setup] migration ${file} FAILED: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  await migrator.end();

  // 4. Grant DML to the API role on everything the migrator just created
  //    (mirrors setup-roles.js) so the suite exercises the real least-privilege
  //    role, exactly like production.
  const grants = adminPool();
  grants.options.database = TEST_DB_NAME;
  await grants.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hms_api`);
  await grants.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hms_api`);

  // Audit-chain + migration-ledger hardening (mirrors setup-roles.js): the app
  // role may INSERT audit rows and UPDATE only the flag columns, never DELETE
  // or rewrite data columns; schema_migrations is migrator-only.
  await grants.query(`REVOKE UPDATE, DELETE ON audit_logs FROM hms_api`);
  await grants.query(`GRANT UPDATE (flagged, flag_reason, flagged_by, flagged_at) ON audit_logs TO hms_api`);
  await grants.query(`REVOKE ALL ON schema_migrations FROM hms_api, hms_readonly`);
  await grants.end();

  console.log(`[global-setup] provisioned ${TEST_DB_NAME}: ${files.length} migrations (${applied} new) in ${Date.now() - started}ms`);
}

export async function teardown() {
  // Best-effort: leave no test DB behind so runs are repeatable.
  try {
    const admin = adminPool();
    await terminateAndDrop(admin, TEST_DB_NAME);
    await admin.end();
    console.log(`[global-setup] dropped ${TEST_DB_NAME}`);
  } catch (err) {
    console.warn(`[global-setup] teardown warning (test DB left in place): ${err.message}`);
  }
}
