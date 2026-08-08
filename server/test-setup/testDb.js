// Integration-test helper — transaction-wrapped access to the throwaway test
// database provisioned by global-setup.js.
//
// usage (in a tests/integration/*.test.js file):
//
//   import { useTestDb } from '../../test-setup/testDb.js';
//   describe('...', () => {
//     useTestDb();          // beforeAll/beforeEach/afterEach hooks
//     it('...', async () => { ... });   // runs inside a rolled-back txn
//   });

import 'dotenv/config';
import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import { setTestClient, clearTestClient } from '../src/shared/db/pool.js';

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'hms_test';

let rawClient = null;
let outerRollback = null;

// Wrap a pg.Client so that internal BEGIN/COMMIT/ROLLBACK calls from services
// (auditLog, refundBill, ...) become SAVEPOINT operations. The outer test
// transaction stays open and is rolled back in afterEach, so every write the
// code under test makes is discarded — even writes committed by services that
// manage their own transactions.
function wrapClient(client) {
  let depth = 0;

  const rewrite = (text) => {
    const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
    if (t === 'BEGIN')        { depth += 1; return `SAVEPOINT hms_sp_${depth}`; }
    if (t === 'COMMIT')       { return `RELEASE SAVEPOINT hms_sp_${depth--}`; }
    if (t === 'ROLLBACK') {
      if (depth === 0) { return 'ROLLBACK'; } // no service txn open — pass through
      return `ROLLBACK TO SAVEPOINT hms_sp_${depth--}`;
    }
    return text;
  };

  const origQuery = client.query.bind(client);
  client.query = (text, values) => {
    if (text && typeof text === 'object' && typeof text.text === 'string') {
      const cfg = { ...text, text: rewrite(text.text) };
      return origQuery(cfg);
    }
    return origQuery(rewrite(text), values);
  };

  // Not pooled — release() must be a no-op (auditLog etc. call it).
  client.release = () => {};
  return client;
}

async function connectRaw() {
  const client = new pg.Client({
    host    : process.env.TEST_DB_HOST || process.env.DB_HOST,
    port    : parseInt(process.env.TEST_DB_PORT || process.env.DB_PORT || '5555', 10),
    database: TEST_DB_NAME,
    user    : process.env.TEST_DB_USER || process.env.DB_USER,
    password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD,
  });
  await client.connect();
  return client;
}

// Register the harness hooks for a test file. Every `it()` inside any describe
// in that file runs inside its own transaction that is rolled back afterwards.
export function useTestDb() {
  beforeAll(async () => {
    rawClient = await connectRaw();
    // Real outer transaction — must be opened BEFORE wrapping so the wrapper's
    // BEGIN->SAVEPOINT rewrite nests inside it.
    outerRollback = rawClient.query.bind(rawClient);
    await rawClient.query('BEGIN');
    setTestClient(wrapClient(rawClient));
  });

  beforeEach(async () => {
    await rawClient.query('BEGIN'); // rewritten to SAVEPOINT (inside outer txn)
  });

  afterEach(async () => {
    await rawClient.query('ROLLBACK'); // rewritten to ROLLBACK TO SAVEPOINT
  });

  afterAll(async () => {
    clearTestClient();
    if (rawClient) {
      await outerRollback('ROLLBACK'); // real rollback of the outer txn
      await rawClient.end();
      rawClient = null;
    }
  });
}

// Low-level escape hatch: run SQL directly against the same test client that
// the code under test uses (e.g. to seed fixtures inside the test transaction).
export function run(sql, params = []) {
  return rawClient.query(sql, params);
}
