// DB-backed integration test for the incidents module.
//
// This is the proof-of-concept for the integration harness: it exercises
// createIncident() against the REAL schema. Before the P0-1 schema fix, the
// live incidents.severity column is TEXT CHECK(LOW/MEDIUM/HIGH/CRITICAL) while
// the service inserts integer severities — so this test FAILS. After the fix
// (severity becomes INT CHECK 1..5) it PASSES.

import { describe, it, expect } from 'vitest';
import { useTestDb, run } from '../../test-setup/testDb.js';
import { createIncident } from '../../src/modules/incidents/incident.service.js';

useTestDb();

async function seedUser(overrides = {}) {
  const { rows } = await run(
    `INSERT INTO users (id, employee_id, first_name, last_name, email, password_hash)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [
      overrides.employeeId ?? 'E-INT-001',
      overrides.firstName  ?? 'Integration',
      overrides.lastName   ?? 'User',
      overrides.email      ?? 'integration@example.com',
      overrides.passwordHash ?? 'x'.repeat(60),
    ]
  );
  return rows[0].id;
}

describe('incidents — createIncident against the real schema', () => {
  it('creates an incident with an integer severity (1-5)', async () => {
    const reportedBy = await seedUser();

    const incident = await createIncident(
      { type: 'FALL', severity: 2, description: 'patient slipped in corridor' },
      reportedBy,
      null,
      '127.0.0.1'
    );

    expect(incident.id).toBeTruthy();
    expect(incident.status).toBe('OPEN');

    const { rows } = await run(
      `SELECT severity, status FROM incidents WHERE id = $1`,
      [incident.id]
    );
    expect(rows[0].severity).toBe(2);
    expect(rows[0].status).toBe('OPEN');
  });

  it('accepts severity 5 (critical) and persists it', async () => {
    const reportedBy = await seedUser();

    const incident = await createIncident(
      { type: 'MEDICATION_ERROR', severity: 5, description: 'wrong drug administered' },
      reportedBy,
      null,
      '127.0.0.1'
    );

    const { rows } = await run(
      `SELECT severity FROM incidents WHERE id = $1`,
      [incident.id]
    );
    expect(rows[0].severity).toBe(5);
  });

  it('lists incidents via getIncidents with a severity filter', async () => {
    const reportedBy = await seedUser();
    await createIncident({ type: 'FALL', severity: 3, description: 'slip' }, reportedBy, null, '127.0.0.1');

    const list = await (await import('../../src/modules/incidents/incident.service.js')).getIncidents({ severity: 3 });
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.severity === 3)).toBe(true);
  });
});
