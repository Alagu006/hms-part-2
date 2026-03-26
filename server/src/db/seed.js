/**
 * HMS Database Seed Script
 *
 * Run: node server/src/db/seed.js
 *
 * Creates:
 *  - Departments
 *  - Default message groups
 *  - Default leave balances config
 *  - One SUPER_ADMIN user
 *  - Sample medicines (from OpenFDA)
 */

import 'dotenv/config';
import argon2  from 'argon2';
import { pool } from '../shared/db/pool.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPER_ADMIN = {
  employee_id: 'SA001',
  first_name : 'System',
  last_name  : 'Admin',
  email      : 'admin@hospital.local',
  password   : process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345!',
};

const DEPARTMENTS = [
  { name: 'Emergency',          code: 'ER',   floor: 'G' },
  { name: 'Cardiology',         code: 'CARD', floor: '2' },
  { name: 'Neurology',          code: 'NEUR', floor: '3' },
  { name: 'Orthopedics',        code: 'ORTH', floor: '4' },
  { name: 'Pediatrics',         code: 'PED',  floor: '5' },
  { name: 'Obstetrics',         code: 'OBS',  floor: '6' },
  { name: 'Oncology',           code: 'ONC',  floor: '7' },
  { name: 'Radiology',          code: 'RAD',  floor: '1' },
  { name: 'Pathology',          code: 'PATH', floor: 'B1' },
  { name: 'Pharmacy',           code: 'PHRM', floor: 'G' },
  { name: 'ICU',                code: 'ICU',  floor: '2' },
  { name: 'Surgery',            code: 'SURG', floor: '3' },
  { name: 'Administration',     code: 'ADMN', floor: 'G' },
  { name: 'Human Resources',    code: 'HR',   floor: 'G' },
  { name: 'Information Technology', code: 'IT', floor: 'B1' },
];

const DEFAULT_GROUPS = [
  { name: 'All Staff',          type: 'BROADCAST' },
  { name: 'Doctors Lounge',     type: 'GROUP' },
  { name: 'Nursing Team',       type: 'GROUP' },
  { name: 'Emergency Response', type: 'GROUP' },
  { name: 'Admin & HR',         type: 'GROUP' },
];

// Leave balance defaults (days per year per type)
const LEAVE_TYPES = [
  { type: 'ANNUAL',    days: 21 },
  { type: 'SICK',      days: 14 },
  { type: 'MATERNITY', days: 90 },
  { type: 'PATERNITY', days: 14 },
  { type: 'EMERGENCY', days: 5  },
];

// ---------------------------------------------------------------------------
// Fetch sample medicines from OpenFDA
// ---------------------------------------------------------------------------
async function fetchMedicines() {
  try {
    console.log('  Fetching medicines from OpenFDA…');
    const url = 'https://api.fda.gov/drug/label.json?limit=50&skip=0';
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`OpenFDA responded ${res.status}`);
    const json = await res.json();

    return (json.results ?? [])
      .filter((r) => r.openfda?.brand_name?.[0] && r.openfda?.generic_name?.[0])
      .slice(0, 50)
      .map((r) => ({
        name        : r.openfda.brand_name[0].slice(0, 200),
        generic_name: r.openfda.generic_name[0].slice(0, 200),
        manufacturer: (r.openfda.manufacturer_name?.[0] ?? 'Unknown').slice(0, 200),
        dosage_form : (r.dosage_forms_and_strengths?.[0] ?? r.openfda.dosage_form?.[0] ?? 'N/A').slice(0, 200),
      }));
  } catch (err) {
    console.warn(`  OpenFDA fetch failed (${err.message}). Using fallback list.`);
    return FALLBACK_MEDICINES;
  }
}

const FALLBACK_MEDICINES = [
  { name: 'Paracetamol 500mg',  generic_name: 'Acetaminophen',  manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Amoxicillin 250mg',  generic_name: 'Amoxicillin',    manufacturer: 'Generic',  dosage_form: 'Capsule' },
  { name: 'Ibuprofen 400mg',    generic_name: 'Ibuprofen',      manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Metformin 500mg',    generic_name: 'Metformin HCl',  manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Atorvastatin 10mg',  generic_name: 'Atorvastatin',   manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Omeprazole 20mg',    generic_name: 'Omeprazole',     manufacturer: 'Generic',  dosage_form: 'Capsule' },
  { name: 'Amlodipine 5mg',     generic_name: 'Amlodipine',     manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Lisinopril 10mg',    generic_name: 'Lisinopril',     manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Azithromycin 500mg', generic_name: 'Azithromycin',   manufacturer: 'Generic',  dosage_form: 'Tablet' },
  { name: 'Cetirizine 10mg',    generic_name: 'Cetirizine HCl', manufacturer: 'Generic',  dosage_form: 'Tablet' },
];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedDepartments(client) {
  console.log('  Seeding departments…');
  const ids = {};
  for (const dept of DEPARTMENTS) {
    const { rows } = await client.query(
      `INSERT INTO departments (name, code, floor)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, code`,
      [dept.name, dept.code, dept.floor]
    );
    ids[rows[0].code] = rows[0].id;
  }
  return ids;
}

async function seedSuperAdmin(client) {
  console.log('  Seeding SUPER_ADMIN user…');
  const hash = await argon2.hash(SUPER_ADMIN.password, {
    type       : argon2.argon2id,
    memoryCost : 65536,
    timeCost   : 3,
    parallelism: 4,
  });

  const { rows } = await client.query(
    `INSERT INTO users (employee_id, first_name, last_name, email, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [SUPER_ADMIN.employee_id, SUPER_ADMIN.first_name, SUPER_ADMIN.last_name,
     SUPER_ADMIN.email, hash]
  );

  const userId = rows[0].id;

  await client.query(
    `INSERT INTO user_roles (user_id, role)
     VALUES ($1, 'SUPER_ADMIN')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId]
  );

  return userId;
}

async function seedMessageGroups(client, adminId) {
  console.log('  Seeding default message groups…');
  for (const g of DEFAULT_GROUPS) {
    const { rows } = await client.query(
      `INSERT INTO message_groups (name, type, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [g.name, g.type, adminId]
    );
    if (rows[0]) {
      // Add admin as first member
      await client.query(
        `INSERT INTO message_group_members (group_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [rows[0].id, adminId]
      );
    }
  }
}

async function seedLeaveBalances(client, adminId) {
  console.log('  Seeding default leave balances for SUPER_ADMIN…');
  const year = new Date().getFullYear();
  for (const lb of LEAVE_TYPES) {
    await client.query(
      `INSERT INTO leave_balances (user_id, leave_type, year, total_days, used_days)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id, leave_type, year) DO NOTHING`,
      [adminId, lb.type, year, lb.days]
    );
  }
}

async function seedMedicines(client) {
  const medicines = await fetchMedicines();
  console.log(`  Seeding ${medicines.length} medicines…`);
  for (const m of medicines) {
    await client.query(
      `INSERT INTO medicines (name, generic_name, manufacturer, dosage_form)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING`,
      [m.name, m.generic_name, m.manufacturer, m.dosage_form]
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await seedDepartments(client);
    const adminId = await seedSuperAdmin(client);
    await seedMessageGroups(client, adminId);
    await seedLeaveBalances(client, adminId);
    await seedMedicines(client);

    await client.query('COMMIT');
    console.log('\n✓ Seed complete.');
    console.log(`  SUPER_ADMIN login: ${SUPER_ADMIN.employee_id} / ${SUPER_ADMIN.password}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
