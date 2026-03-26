/**
 * Seed default staff messaging groups.
 * Run once on system init: node src/shared/db/seeds/messagingGroups.js
 */
import { pool, query } from '../pool.js';

const SYSTEM_GROUPS = [
  { name: 'Common Staff',  type: 'GROUP', roles: null },   // all staff
  { name: 'Doctors',       type: 'GROUP', roles: ['DOCTOR', 'ANESTHETIST', 'RADIOLOGIST'] },
  { name: 'Nurses',        type: 'GROUP', roles: ['NURSE'] },
  { name: 'Lab',           type: 'GROUP', roles: ['LAB_TECH'] },
  { name: 'Pharmacy',      type: 'GROUP', roles: ['PHARMACIST'] },
  { name: 'Inventory',     type: 'GROUP', roles: ['INVENTORY'] },
  { name: 'Admin',         type: 'GROUP', roles: ['ADMIN', 'SUPER_ADMIN', 'HR'] },
  { name: 'Reception',     type: 'GROUP', roles: ['RECEPTIONIST'] },
];

async function seed() {
  console.log('[seed] Creating default messaging groups…');

  for (const grp of SYSTEM_GROUPS) {
    // Skip if already exists
    const { rows: existing } = await query(
      `SELECT id FROM message_groups WHERE name = $1 AND type = 'GROUP' AND deleted_at IS NULL`,
      [grp.name]
    );
    if (existing.length) {
      console.log(`  [skip] "${grp.name}" already exists`);
      continue;
    }

    // Create group (no created_by for system groups)
    const { rows } = await query(
      `INSERT INTO message_groups (id, name, type, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, NULL, NOW(), NOW()) RETURNING id`,
      [grp.name, grp.type]
    );
    const groupId = rows[0].id;

    // Add members by role
    let memberQuery;
    if (!grp.roles) {
      // All non-patient users
      memberQuery = `SELECT id FROM users WHERE deleted_at IS NULL AND is_active = TRUE
                     AND id NOT IN (SELECT user_id FROM user_roles WHERE role = 'PATIENT')`;
    } else {
      memberQuery = `SELECT DISTINCT u.id FROM users u
                     JOIN user_roles ur ON ur.user_id = u.id
                     WHERE ur.role = ANY($1::user_role[])
                       AND ur.revoked_at IS NULL
                       AND u.deleted_at IS NULL AND u.is_active = TRUE`;
    }

    const { rows: members } = grp.roles
      ? await query(memberQuery, [grp.roles])
      : await query(memberQuery);

    for (const { id: uid } of members) {
      await query(
        `INSERT INTO message_group_members (id, group_id, user_id, role, joined_at)
         VALUES (gen_random_uuid(), $1, $2, 'MEMBER', NOW())
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, uid]
      );
    }

    console.log(`  [ok] "${grp.name}" — ${members.length} members`);
  }

  console.log('[seed] Done.');
  await pool.end();
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
