/**
 * Provision the least-privilege PostgreSQL roles used by the HMS server.
 *
 *   hms_api       — the role the running API uses day-to-day. SELECT/INSERT/
 *                   UPDATE/DELETE only on application tables. NO DDL, NO
 *                   superuser. Set as DB_USER/DB_PASSWORD in .env.
 *
 *   hms_migrator   — used ONLY by `npm run migrate`. Owns the schema objects so
 *                   it can run DDL (ALTER/CREATE/DROP) against them. NEVER used
 *                   by the running API.
 *
 *   hms_readonly   — (optional) SELECT-only role for analytics/reporting jobs
 *                   that don't need write access.
 *
 * Connects as the database superuser (DB_SUPERUSER / DB_SUPERUSER_PASSWORD).
 * Idempotent and safe to re-run: existing objects are re-granted and default
 * privileges ensure any table hms_migrator creates later is auto-granted to
 * hms_api / hms_readonly.
 *
 * Usage:  npm run db:setup-roles
 */
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const dbName = process.env.DB_NAME || 'hms_db';

const superUser = {
  host     : process.env.DB_HOST,
  port     : parseInt(process.env.DB_PORT || '5555', 10),
  database : 'postgres',          // connect to the maintenance DB — roles are cluster-wide
  user     : process.env.DB_SUPERUSER || 'postgres',
  password : process.env.DB_SUPERUSER_PASSWORD,
};

// Role names are fixed by convention; passwords come from .env.
const apiPass      = process.env.DB_PASSWORD;
const migratorPass = process.env.DB_MIGRATOR_PASSWORD;
const readonlyPass = process.env.DB_READONLY_PASSWORD;

// Build a safe SQL string literal (single-quoted, escapes embedded quotes).
// Double quotes would be parsed as an identifier by Postgres.
const lit = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;

const statements = [];

// ── 1. Create the roles (cluster-wide, idempotent) ───────────────────────────
statements.push(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hms_api') THEN
    CREATE ROLE hms_api LOGIN PASSWORD ${lit(apiPass)};
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hms_migrator') THEN
    CREATE ROLE hms_migrator LOGIN PASSWORD ${lit(migratorPass)};
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hms_readonly') THEN
    CREATE ROLE hms_readonly LOGIN PASSWORD ${lit(readonlyPass)};
  END IF;
END $$;
`);

// ── 2. Database + schema access ──────────────────────────────────────────────
statements.push(`
GRANT CONNECT ON DATABASE ${dbName} TO hms_api, hms_migrator, hms_readonly;
`);

// ── 3. Connect to the target database for the rest (schema-scoped DDL) ───────
async function run(db) {
  const client = new Client({ ...superUser, database: db });
  await client.connect();
  try {
    for (const sql of statements) await client.query(sql);
  } finally {
    await client.end();
  }
}

async function provisionTargetDb() {
  const client = new Client({ ...superUser, database: dbName });
  await client.connect();
  try {
    // USAGE on public schema (required in PG15+; CREATE is migrator-only so the
    // API role can never create objects — that is exactly the DDL boundary).
    await client.query(`GRANT USAGE ON SCHEMA public TO hms_api, hms_migrator, hms_readonly;`);
    await client.query(`GRANT CREATE ON SCHEMA public TO hms_migrator;`);
    // CREATE ON DATABASE lets hms_migrator install trusted extensions
    // (e.g. pgcrypto) when bootstrapping a fresh database from schema.sql.
    await client.query(`GRANT CREATE ON DATABASE ${dbName} TO hms_migrator;`);

    // Make hms_migrator the OWNER of every existing app table/view/sequence in
    // public. Ownership is what grants DDL rights in Postgres (there is no
    // "GRANT ALTER TABLE"), so the migrator can run future migrations.
    // Extension functions are deliberately left owned by the superuser.
    await client.query(`
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m','S','f')
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'hms_migrator')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO hms_migrator',
      CASE r.relkind
        WHEN 'r' THEN 'TABLE'
        WHEN 'p' THEN 'TABLE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'f' THEN 'FOREIGN TABLE'
      END,
      r.nspname, r.relname
    );
  END LOOP;
END $$;
`);

    // DML for the API role — no DDL grants anywhere.
    await client.query(`
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hms_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hms_api;
`);

    // ── Audit-chain integrity ──────────────────────────────────────────────
    // audit_logs carries the tamper-evidence hash chain. The app role may
    // INSERT (audit middleware) and UPDATE only the flag columns (admin
    // flag/unflag), but must never DELETE rows or rewrite data columns —
    // otherwise the chain is editable at the DB role level.
    await client.query(`REVOKE UPDATE, DELETE ON audit_logs FROM hms_api;`);
    await client.query(`
GRANT UPDATE (flagged, flag_reason, flagged_by, flagged_at) ON audit_logs TO hms_api;
`);
    // The migration ledger is written only by hms_migrator.
    await client.query(`REVOKE ALL ON schema_migrations FROM hms_api, hms_readonly;`);

    // Read-only role for analytics/reporting.
    await client.query(`
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hms_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hms_readonly;
`);

    // Future-proofing: any table hms_migrator creates is auto-granted.
    await client.query(`
ALTER DEFAULT PRIVILEGES FOR ROLE hms_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_api;
ALTER DEFAULT PRIVILEGES FOR ROLE hms_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hms_api;
ALTER DEFAULT PRIVILEGES FOR ROLE hms_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO hms_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE hms_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hms_readonly;
`);
  } finally {
    await client.end();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  await run('postgres');
  console.log('  ✓ roles ensured (hms_api, hms_migrator, hms_readonly)');
  await provisionTargetDb();
  console.log(`  ✓ privileges applied on database "${dbName}"`);
  console.log('\nDone. Now set in .env: DB_USER=hms_api and DB_MIGRATOR_* for migrate.js.');
} catch (err) {
  console.error('[setup-roles] Fatal error:', err.message);
  process.exit(1);
}
