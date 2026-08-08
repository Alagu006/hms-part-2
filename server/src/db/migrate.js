/**
 * Migration runner.
 *
 * -----------------------------------------------------------------------------
 * schema.sql vs. migrations/
 * -----------------------------------------------------------------------------
 *   schema.sql      The full, current baseline schema (the entire ERD). It is a
 *                   snapshot used once to bootstrap a brand-new database:
 *
 *                     createdb hms_db && psql -d hms_db -f src/db/schema.sql
 *
 *                   Editing schema.sql alone does NOT update existing databases.
 *
 *   migrations/     Incremental, ordered schema changes applied on top of an
 *                   existing baseline. Each file runs exactly once and is
 *                   recorded in the `schema_migrations` table, so re-running
 *                   the runner is a safe no-op for already-applied files.
 *
 *   Rule of thumb:  schema.sql = "how a fresh DB starts".
 *                   migrations/ = "how every database (fresh or existing) gets
 *                   to the current state". New schema changes go in a NEW
 *                   zero-padded migration file (e.g. 019_...) — never by
 *                   hand-editing schema.sql and never by editing an old
 *                   migration that has already been applied.
 *
 * -----------------------------------------------------------------------------
 * Usage:  npm run migrate   (or: node src/db/migrate.js)
 *
 * Notes:
 *   - Files are executed in lexicographic filename order, so names MUST be
 *     zero-padded and collision-free (001_, 002_, ..., 018_).
 *   - Each migration runs in its own transaction together with its
 *     `schema_migrations` insert: a failed migration applies nothing and
 *     records nothing.
 *   - Databases created before this runner existed have no `schema_migrations`
 *     rows, so their already-applied legacy migrations will be re-run once.
 *     All migration files are idempotent (IF NOT EXISTS / ON CONFLICT), so the
 *     re-run is harmless.
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg   from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated migrator connection — uses the hms_migrator role (DDL rights, owns
// the schema objects). The running API never uses this role; it uses hms_api
// via ../shared/db/pool.js (DML only). Per-field DB_MIGRATOR_* overrides fall
// back to the app DB_* values so only the role/password need to differ.
// ─────────────────────────────────────────────────────────────────────────────
const { Pool } = pg;
const migratorPool = new Pool({
  host              : process.env.DB_MIGRATOR_HOST || process.env.DB_HOST,
  port              : parseInt(process.env.DB_MIGRATOR_PORT || process.env.DB_PORT || '5555', 10),
  database          : process.env.DB_MIGRATOR_NAME || process.env.DB_NAME,
  user              : process.env.DB_MIGRATOR_USER || 'hms_migrator',
  password          : process.env.DB_MIGRATOR_PASSWORD,
  max               : 4,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle   : false,
});

// Files are sorted lexicographically — filenames are zero-padded (001_…018_) so
// lexical order == chronological order.
const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

await migratorPool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

// Load the set of already-applied migrations once.
const { rows: appliedRows } = await migratorPool.query(
  'SELECT filename FROM schema_migrations'
);
const applied = new Set(appliedRows.map(r => r.filename));

let appliedCount  = 0;
let skippedCount  = 0;

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  - ${file}  (already applied, skipping)`);
    skippedCount += 1;
    continue;
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  console.log(`  + ${file}`);

  const client = await migratorPool.connect();
  let ok = false;
  try {
    // Run the migration and record it atomically: if the SQL fails, the
    // ROLLBACK undoes both the schema change and the tracking insert.
    await client.query('BEGIN');
    // Expose PG_CRYPTO_KEY to data migrations (e.g. at-rest plaintext backfills)
    // as a transaction-local GUC, so pgp_sym_encrypt/decrypt can be re-keyed.
    if (process.env.PG_CRYPTO_KEY) {
      await client.query('SELECT set_config($1, $2, true)', ['app.pgcrypto_key', process.env.PG_CRYPTO_KEY]);
    }
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [file]
    );
    await client.query('COMMIT');
    ok = true;
    console.log(`    ✓ applied`);
    appliedCount += 1;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // best-effort rollback — original error is reported below
    console.error(`    ✗ failed: ${err.message}`);
  } finally {
    client.release();
  }

  if (!ok) {
    await migratorPool.end();
    process.exit(1);
  }
}

await migratorPool.end();
console.log(
  `Migration complete: ${appliedCount} applied, ${skippedCount} skipped, ${files.length} total.`
);
