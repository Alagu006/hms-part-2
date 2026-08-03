/**
 * Verify the least-privilege database setup end-to-end.
 *
 * Checks (all against the real database):
 *   1. hms_api is NOT a superuser and has NO DDL (no CREATE on schema public).
 *   2. hms_api has SELECT/INSERT/UPDATE/DELETE on the application tables.
 *   3. Live DML smoke against real tables (rolled back — nothing persists).
 *   4. pgcrypto functions used by the app are callable by hms_api.
 *   5. A DDL statement (CREATE TABLE, DROP TABLE) is REJECTED BY POSTGRES
 *      itself when attempted as hms_api — not just by application logic.
 *   6. hms_migrator CAN run DDL (positive control).
 *   7. hms_readonly can SELECT but cannot INSERT.
 *
 * Usage:  npm run db:verify
 */
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const base = {
  host    : process.env.DB_HOST,
  port    : parseInt(process.env.DB_PORT || '5555', 10),
  database: process.env.DB_NAME || 'hms_db',
};

const apiClient = () => new Client({
  ...base,
  user    : process.env.DB_USER || 'hms_api',
  password: process.env.DB_PASSWORD,
});
const migratorClient = () => new Client({
  ...base,
  user    : process.env.DB_MIGRATOR_USER || 'hms_migrator',
  password: process.env.DB_MIGRATOR_PASSWORD,
});
const readonlyClient = () => new Client({
  ...base,
  user    : process.env.DB_READONLY_USER || 'hms_readonly',
  password: process.env.DB_READONLY_PASSWORD,
});

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}`);
  if (!cond) failures += 1;
};

async function expectRejected(name, fn) {
  try {
    await fn();
    console.log(`  ✗ FAIL ${name} — statement unexpectedly succeeded`);
    failures += 1;
  } catch (err) {
    console.log(`  ✓ ${name} — rejected by Postgres: ${err.message.split('\n')[0]}`);
  }
}

async function withClient(make, fn) {
  const c = make();
  await c.connect();
  try { return await fn(c); }
  finally { await c.end(); }
}

// ── 1–2. Role capabilities as hms_api ────────────────────────────────────────
async function checkApiCapabilities() {
  console.log('\n[hms_api] capability checks');
  await withClient(apiClient, async (c) => {
    const { rows } = await c.query(
      `SELECT rolsuper, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = current_user`
    );
    ok('is NOT a superuser', rows[0]?.rolsuper === false);
    ok('cannot create databases', rows[0]?.rolcreatedb === false);

    const { rows: createPriv } = await c.query(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`
    );
    ok('has NO CREATE (DDL) on schema public', createPriv[0]?.can_create === false);

    // DML on every application table.
    const { rows: tables } = await c.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    let allDml = true;
    for (const t of tables) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await c.query(
          `SELECT has_table_privilege(current_user, $1, $2) AS p`,
          [t.tablename, priv]
        );
        if (r.rows[0].p !== true) { allDml = false; console.log(`    missing ${priv} on ${t.tablename}`); }
      }
    }
    ok(`DML (SELECT/INSERT/UPDATE/DELETE) on all ${tables.length} app tables`, allDml);

    const { rows: viewPriv } = await c.query(
      `SELECT has_table_privilege(current_user, 'bill_status_view', 'SELECT') AS p`
    );
    ok('can SELECT bill_status_view', viewPriv[0]?.p === true);

    // NOT owner of any table (no implicit DDL).
    const { rows: owned } = await c.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner = current_user`
    );
    ok('owns NO tables (no implicit DDL rights)', owned[0]?.n === 0);
  });
}

// ── 3–4. Live DML smoke + pgcrypto (rolled back) ─────────────────────────────
async function checkApiDml() {
  console.log('\n[hms_api] live DML smoke (rolled back)');
  await withClient(apiClient, async (c) => {
    await c.query('BEGIN');
    try {
      const ins = await c.query(
        `INSERT INTO departments (name, code, floor) VALUES ('__verify__', 'VRFY', 'Z') RETURNING id`
      );
      ok('INSERT departments', ins.rowCount === 1);

      const upd = await c.query(
        `UPDATE departments SET code = 'VRF2' WHERE id = $1`, [ins.rows[0].id]
      );
      ok('UPDATE departments', upd.rowCount === 1);

      const sel = await c.query(
        `SELECT d.name FROM departments d JOIN user_roles ur ON ur.user_id = (SELECT id FROM users LIMIT 1) LIMIT 1`
      );
      ok('SELECT across joined tables', Array.isArray(sel.rows));

      const del = await c.query(`DELETE FROM departments WHERE id = $1`, [ins.rows[0].id]);
      ok('DELETE departments', del.rowCount === 1);

      const v = await c.query(`SELECT * FROM bill_status_view LIMIT 1`);
      ok('SELECT bill_status_view (live)', Array.isArray(v.rows));

      const enc = await c.query(
        `SELECT encode(pgp_sym_encrypt('verify'::text, $1), 'hex') AS e`, [process.env.PG_CRYPTO_KEY]
      );
      ok('pgcrypto pgp_sym_encrypt callable', /^[0-9a-f]+$/i.test(enc.rows[0]?.e ?? ''));

      const audit = await c.query(
        `INSERT INTO audit_logs (user_id, action, entity) VALUES (NULL, 'VERIFY', 'verify') RETURNING id`
      );
      ok('INSERT audit_logs (audit middleware path)', audit.rowCount === 1);
      await c.query(`DELETE FROM audit_logs WHERE id = $1`, [audit.rows[0].id]);
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

// ── 5. DDL must be rejected by Postgres for hms_api ──────────────────────────
async function checkApiDdlRejected() {
  console.log('\n[hms_api] DDL rejected by Postgres');
  await withClient(apiClient, async (c) => {
    await expectRejected('CREATE TABLE rejected', async () => {
      await c.query(`CREATE TABLE __verify_priv_tmp (id int)`);
    });
    await expectRejected('DROP TABLE rejected (real table, wrapped in txn)', async () => {
      await c.query('BEGIN');
      try { await c.query(`DROP TABLE departments`); }
      finally { await c.query('ROLLBACK'); }
    });
    const exists = await c.query(
      `SELECT to_regclass('public.departments') IS NOT NULL AS e`
    );
    ok('departments table still exists after failed DROP', exists.rows[0].e === true);
  });
}

// ── 6. Migrator positive control ─────────────────────────────────────────────
async function checkMigratorDdl() {
  console.log('\n[hms_migrator] DDL positive control');
  await withClient(migratorClient, async (c) => {
    try {
      await c.query(`CREATE TABLE __mig_verify_tmp (id int PRIMARY KEY)`);
      await c.query(`INSERT INTO __mig_verify_tmp VALUES (1)`);
      await c.query(`ALTER TABLE __mig_verify_tmp ADD COLUMN note text`);
      const okRes = await c.query(`SELECT id, note FROM __mig_verify_tmp`);
      ok('CREATE + ALTER + INSERT + SELECT as migrator', okRes.rows.length === 1);
      await c.query(`DROP TABLE __mig_verify_tmp`);
      ok('DROP TABLE as migrator', true);
    } catch (err) {
      console.log(`  ✗ FAIL migrator DDL: ${err.message.split('\n')[0]}`);
      failures += 1;
    }
  });
}

// ── 7. Readonly role ─────────────────────────────────────────────────────────
async function checkReadonly() {
  console.log('\n[hms_readonly] read-only role');
  await withClient(readonlyClient, async (c) => {
    const r = await c.query(`SELECT count(*) FROM departments`);
    ok('can SELECT', true);
    await expectRejected('INSERT rejected', async () => {
      await c.query(`INSERT INTO departments (name, code, floor) VALUES ('x','Y','Z')`);
    });
    await expectRejected('DROP TABLE rejected', async () => {
      await c.query(`DROP TABLE departments`);
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
try {
  console.log('Verifying least-privilege database setup...');
  await checkApiCapabilities();
  await checkApiDml();
  await checkApiDdlRejected();
  await checkMigratorDdl();
  await checkReadonly();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('[verify-privileges] Fatal error:', err.message);
  process.exit(1);
}
