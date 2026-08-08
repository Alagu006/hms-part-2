import { pool }               from '../../shared/db/pool.js';
import { auditLog }           from '../../shared/middleware/audit.js';
import { createNotification } from '../../shared/services/notification.service.js';

const LOW_STOCK_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Create blood unit record
// ---------------------------------------------------------------------------
export async function createBloodUnit({ bloodGroup, units, donorName, expiryDate, status }, userId, ip) {
  const { rows } = await pool.query(
    `INSERT INTO blood_bank
       (id, blood_group, units, donor_name, expiry_date, status, created_by, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [bloodGroup, units, donorName ?? null, expiryDate, status ?? 'AVAILABLE', userId]
  );
  await auditLog({ userId, action: 'CREATE', entity: 'blood_bank', entityId: rows[0].id, nextData: rows[0], ip });
  await checkLowStock(bloodGroup, null, null);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Get all blood units (with optional filters)
// ---------------------------------------------------------------------------
export async function getBloodUnits({ bloodGroup, status, page = 1, limit = 50 }) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  let p = 1;
  if (bloodGroup) { conditions.push(`blood_group = $${p++}`); params.push(bloodGroup); }
  if (status)     { conditions.push(`status = $${p++}`);      params.push(status); }
  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const limitIdx  = p++;
  const offsetIdx = p++;
  const { rows } = await pool.query(
    `SELECT * FROM blood_bank
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Get single blood unit
// ---------------------------------------------------------------------------
export async function getBloodUnit(id) {
  const { rows } = await pool.query(
    `SELECT * FROM blood_bank WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) { const e = new Error('Blood unit not found'); e.status = 404; throw e; }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Update blood unit
// ---------------------------------------------------------------------------
export async function updateBloodUnit(id, updates, userId, ip) {
  const prev = await getBloodUnit(id);
  const fields = [];
  const params = [];
  let p = 1;

  const allowed = ['blood_group','units','donor_name','expiry_date','status'];
  const map = { bloodGroup: 'blood_group', donorName: 'donor_name', expiryDate: 'expiry_date' };

  for (const [key, val] of Object.entries(updates)) {
    const col = map[key] ?? key;
    if (allowed.includes(col) && val !== undefined) {
      fields.push(`${col} = $${p++}`);
      params.push(val);
    }
  }
  if (!fields.length) return prev;

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE blood_bank SET ${fields.join(', ')} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!rows[0]) { const e = new Error('Blood unit not found'); e.status = 404; throw e; }
  await auditLog({ userId, action: 'UPDATE', entity: 'blood_bank', entityId: id, prevData: prev, nextData: rows[0], ip });
  await checkLowStock(rows[0].blood_group, null, null);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Delete blood unit (soft)
// ---------------------------------------------------------------------------
export async function deleteBloodUnit(id, userId, ip) {
  const { rows } = await pool.query(
    `UPDATE blood_bank SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (!rows[0]) { const e = new Error('Blood unit not found'); e.status = 404; throw e; }
  await auditLog({ userId, action: 'DELETE', entity: 'blood_bank', entityId: id, ip });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Request blood for patient
// ---------------------------------------------------------------------------
export async function requestBlood({ patientId, bloodGroup, units, reason }, doctorId, io, ip) {
  const client = await pool.connect();
  try {
    // Availability check + reservation must be atomic AND serialised. Two
    // concurrent requests for the same blood group used to both read
    // availability outside any lock, then both reserve — over-reserving stock.
    // Locking the matching AVAILABLE rows FOR UPDATE means the second request
    // blocks until the first commits; it then re-reads the row versions, and
    // rows it locked but that are now RESERVED no longer satisfy the WHERE, so
    // they are excluded and the availability recheck is correct.
    await client.query('BEGIN');
    const { rows: avail } = await client.query(
      `SELECT id, units FROM blood_bank
       WHERE blood_group = $1 AND status = 'AVAILABLE' AND deleted_at IS NULL
       ORDER BY expiry_date ASC
       FOR UPDATE`,
      [bloodGroup]
    );
    const totalAvail = avail.reduce((s, r) => s + parseInt(r.units, 10), 0);
    if (totalAvail < units) {
      const e = new Error(`Insufficient ${bloodGroup} units. Available: ${totalAvail}, Requested: ${units}`);
      e.status = 422;
      throw e;
    }

    // Reserve units (FIFO by expiry)
    let remaining = units;
    for (const row of avail) {
      if (remaining <= 0) break;
      const rowUnits = parseInt(row.units, 10);
      if (rowUnits <= remaining) {
        await client.query(
          `UPDATE blood_bank SET status = 'RESERVED', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        remaining -= rowUnits;
      } else {
        // Split: mark partial as reserved, create new row for remainder
        await client.query(
          `UPDATE blood_bank SET units = $1, status = 'RESERVED', updated_at = NOW() WHERE id = $2`,
          [remaining, row.id]
        );
        await client.query(
          `INSERT INTO blood_bank (id, blood_group, units, donor_name, expiry_date, status, created_by, created_at, updated_at)
           SELECT gen_random_uuid(), blood_group, $1, donor_name, expiry_date, 'AVAILABLE', created_by, NOW(), NOW()
           FROM blood_bank WHERE id = $2`,
          [rowUnits - remaining, row.id]
        );
        remaining = 0;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Notify admins about blood request
  const { rows: admins } = await pool.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
     WHERE ur.role IN ('ADMIN','SUPER_ADMIN') AND u.is_active = TRUE AND u.deleted_at IS NULL`
  );
  for (const admin of admins) {
    await createNotification(
      admin.id, 'BLOOD_REQUEST',
      'Blood Request',
      `${units} unit(s) of ${bloodGroup} requested for patient. Reason: ${reason ?? 'N/A'}`,
      { entityType: 'blood_bank', patientId },
      io
    );
  }

  await auditLog({ userId: doctorId, action: 'BLOOD_REQUEST', entity: 'blood_bank', nextData: { patientId, bloodGroup, units, reason }, ip });
  await checkLowStock(bloodGroup, io, admins);
  return { ok: true, reserved: units };
}

// ---------------------------------------------------------------------------
// Availability grouped by blood group
// ---------------------------------------------------------------------------
export async function getAvailability() {
  const { rows } = await pool.query(
    `SELECT blood_group,
            SUM(units) FILTER (WHERE status = 'AVAILABLE') AS available,
            SUM(units) FILTER (WHERE status = 'RESERVED')  AS reserved,
            SUM(units) AS total
     FROM blood_bank
     WHERE deleted_at IS NULL AND expiry_date > NOW()
     GROUP BY blood_group
     ORDER BY blood_group`
  );
  return rows.map(r => ({
    bloodGroup: r.blood_group,
    available : parseInt(r.available ?? 0, 10),
    reserved  : parseInt(r.reserved  ?? 0, 10),
    total     : parseInt(r.total     ?? 0, 10),
    lowStock  : parseInt(r.available ?? 0, 10) < LOW_STOCK_THRESHOLD,
  }));
}

// ---------------------------------------------------------------------------
// Internal: alert admins when a blood group drops below threshold
// ---------------------------------------------------------------------------
async function checkLowStock(bloodGroup, io, admins) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(units), 0) AS total
     FROM blood_bank
     WHERE blood_group = $1 AND status = 'AVAILABLE' AND deleted_at IS NULL AND expiry_date > NOW()`,
    [bloodGroup]
  );
  const total = parseInt(rows[0].total, 10);
  if (total >= LOW_STOCK_THRESHOLD) return;

  // Fetch admins if not provided
  let targets = admins;
  if (!targets) {
    const { rows: a } = await pool.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
       WHERE ur.role IN ('ADMIN','SUPER_ADMIN') AND u.is_active = TRUE AND u.deleted_at IS NULL`
    );
    targets = a;
  }

  for (const admin of targets) {
    await createNotification(
      admin.id, 'BLOOD_REQUEST',
      `Low Blood Stock: ${bloodGroup}`,
      `${bloodGroup} blood units are critically low (${total} available). Immediate restocking required.`,
      { entityType: 'blood_bank', bloodGroup },
      io
    ).catch(() => {}); // best-effort alert — a notification failure must not fail stock checks
  }
}
