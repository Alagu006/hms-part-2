/**
 * Database seed — runs once on first startup.
 *
 * Idempotent: skips everything if users table already has rows.
 * Safe to run multiple times.
 *
 * Required env vars:
 *   SUPER_ADMIN_EMAIL     — email for the super admin account
 *   SUPER_ADMIN_PASSWORD  — plain-text password (hashed with Argon2id)
 *   PG_CRYPTO_KEY        — pgcrypto symmetric key (same as app layer)
 *
 * Run: node server/src/db/seed.js
 */

import 'dotenv/config';
import argon2 from 'argon2';
import { pool } from '../shared/db/pool.js';

// ---------------------------------------------------------------------------
// Departments to seed
// ---------------------------------------------------------------------------
const DEPARTMENTS = [
  { name: 'Emergency',        code: 'EMRG',  floor: 'G'  },
  { name: 'Cardiology',       code: 'CARD',  floor: '2'  },
  { name: 'Neurology',        code: 'NEUR',  floor: '3'  },
  { name: 'Orthopedics',      code: 'ORTH',  floor: '4'  },
  { name: 'Pediatrics',       code: 'PEDS',  floor: '5'  },
  { name: 'Radiology',        code: 'RAD',   floor: '1'  },
  { name: 'Pathology',       code: 'PATH',  floor: 'B1' },
  { name: 'Pharmacy',        code: 'PHARM', floor: 'G'  },
  { name: 'General Medicine', code: 'GENM',  floor: '1'  },
  { name: 'Surgery',         code: 'SURG',  floor: '3'  },
];

// ---------------------------------------------------------------------------
// One message group per RBAC role
// ---------------------------------------------------------------------------
const RBAC_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST',
  'LAB_TECH', 'PHARMACIST', 'INVENTORY', 'RADIOLOGIST', 'BILLING',
  'HR', 'DIETITIAN', 'PHYSIO', 'ANESTHETIST', 'SOCIAL_WORKER',
  'IT_ADMIN', 'SECURITY_OFC', 'ORDERLY',
];

// ---------------------------------------------------------------------------
// Leave balances for the super admin user
// ---------------------------------------------------------------------------
const LEAVE_BALANCES= [
  { type: 'ANNUAL', days: 21 },
  { type: 'SICK', days: 14 },
  { type: 'MATERNITY', days: 180 },
  { type: 'PATERNITY', days: 15 },
  { type: 'UNPAID', days: 30 },
  { type: 'EMERGENCY', days: 5 },
  { type: 'COMPENSATORY', days: 10 }
]
// ---------------------------------------------------------------------------
// Encrypt a value using pgcrypto (same key as app layer)
// ---------------------------------------------------------------------------
async function pgEncrypt(value) {
  if (value == null) return null;
  const { rows } = await pool.query(
    `SELECT encode(pgp_sym_encrypt($1::text, $2), 'hex') AS encrypted`,
    [String(value), process.env.PG_CRYPTO_KEY]
  );
  return rows[0].encrypted;
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------
async function seedDepartments(client) {
  console.log('  Seeding departments…');
  for (const dept of DEPARTMENTS) {
    await client.query(
      `INSERT INTO departments (name, code, floor, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (name) DO UPDATE SET code = EXCLUDED.code, updated_at = NOW()`,
      [dept.name, dept.code, dept.floor]
    );
  }
}

async function seedSuperAdmin(client) {
  console.log('  Seeding SUPER_ADMIN user…');

  const missing = [];
  if (!process.env.SUPER_ADMIN_EMAIL)    missing.push('SUPER_ADMIN_EMAIL');
  if (!process.env.SUPER_ADMIN_PASSWORD) missing.push('SUPER_ADMIN_PASSWORD');
  if (!process.env.PG_CRYPTO_KEY)        missing.push('PG_CRYPTO_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const hash = await argon2.hash(process.env.SUPER_ADMIN_PASSWORD, {
    type       : argon2.argon2id,
    memoryCost : 65536,
    timeCost   : 3,
    parallelism: 4,
  });

  const emailEncrypted = await pgEncrypt(process.env.SUPER_ADMIN_EMAIL);
  const phoneEncrypted = await pgEncrypt('+0000000000');

  const { rows } = await client.query(
    `INSERT INTO users
       (employee_id, first_name, last_name, email, phone, password_hash, must_change_password, created_at, updated_at)
     VALUES ('ADMIN001', 'Super', 'Admin', $1, $2, $3, FALSE, NOW(), NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [emailEncrypted, phoneEncrypted, hash]
  );

  if (!rows[0]) {
    console.warn('  SUPER_ADMIN user already exists — skipping user creation.');
    const { rows: existing } = await client.query(
      `SELECT id FROM users LIMIT 1 OFFSET 0`
    );
    return existing[0]?.id ?? null;
  }

  const userId = rows[0].id;

  await client.query(
    `INSERT INTO user_roles (user_id, role, granted_at)
     VALUES ($1, 'SUPER_ADMIN', NOW())
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId]
  );

  console.log(`  SUPER_ADMIN created: ${process.env.SUPER_ADMIN_EMAIL}`);
  return userId;
}

async function seedMessageGroups(client, adminId) {
  if (!adminId) return;
  console.log('  Seeding role-based message groups…');

  for (const role of RBAC_ROLES) {
    const { rows } = await client.query(
      `INSERT INTO message_groups (name, type, created_by, created_at, updated_at)
       VALUES ($1, 'GROUP', $2, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [`${role} Group`, adminId]
    );

    if (rows[0]) {
      await client.query(
        `INSERT INTO message_group_members (group_id, user_id, role, joined_at)
         VALUES ($1, $2, 'ADMIN', NOW())
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [rows[0].id, adminId]
      );
    }
  }

  console.log('  Seeding department-based message groups…');
  const { rows: depts } = await client.query(`SELECT id, name FROM departments`);
  for (const dept of depts) {
    const { rows } = await client.query(
      `INSERT INTO message_groups (name, type, created_by, created_at, updated_at)
       VALUES ($1, 'DEPARTMENT', $2, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [`${dept.name}`, adminId]
    );

    if (rows[0]) {
      await client.query(
        `INSERT INTO message_group_members (group_id, user_id, role, joined_at)
         VALUES ($1, $2, 'ADMIN', NOW())
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [rows[0].id, adminId]
      );
    }
  }
}

async function seedLeaveBalances(client, adminId) {
  if (!adminId) return;
  console.log('  Seeding leave balances…');
  const year = parseInt(process.env.LEAVE_YEAR || String(new Date().getFullYear()), 10);

  for (const lb of LEAVE_BALANCES) {
    await client.query(
      `INSERT INTO leave_balances (user_id, leave_type, year, total_days, used_days, pending_days, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, NOW())
       ON CONFLICT (user_id, leave_type, year) DO NOTHING`,
      [adminId, lb.type, year, lb.days]
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  console.log('[seed] Starting database seed...\n');

  const client = await pool.connect();
  try {
    // ── Idempotency guard: skip entirely if users already exist ───────────
    const { rows: existing } = await client.query(
      `SELECT 1 FROM users WHERE deleted_at IS NULL LIMIT 1`
    );
    if (existing.length > 0) {
      console.log('[seed] users table already has rows — skipping seed.');
      return;
    }

    await client.query('BEGIN');

    await seedDepartments(client);
    const adminId = await seedSuperAdmin(client);
    await seedMessageGroups(client, adminId);
    await seedLeaveBalances(client, adminId);

    await client.query('COMMIT');
    console.log('\n[seed] ✓ Seed complete.');
    if (adminId) {
      console.log(`  SUPER_ADMIN email:    ${process.env.SUPER_ADMIN_EMAIL}`);
      console.log(`  SUPER_ADMIN password: (use value from SUPER_ADMIN_PASSWORD env var)`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n[seed] ✗ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
