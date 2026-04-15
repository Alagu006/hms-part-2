import crypto                from 'crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { query, withTransaction } from '../../shared/db/pool.js';
import { auditLog }               from '../../shared/middleware/audit.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';

// ---------------------------------------------------------------------------
// QR code signing secret
// ---------------------------------------------------------------------------
const QR_SECRET = process.env.INVENTORY_QR_SECRET || 'change-me-qr-secret';

function signQrPayload(itemId) {
  const sig = crypto
    .createHmac('sha256', QR_SECRET)
    .update(itemId)
    .digest('hex')
    .slice(0, 12);
  return `INV-${itemId.replace(/-/g, '')}-${sig}`;
}

function verifyQrCode(code) {
  // code format: INV-{uuidNoHyphens}-{sig12}
  const match = code.match(/^INV-([a-f0-9]{32})-([a-f0-9]{12})$/i);
  if (!match) return null;
  const rawId = match[1];
  const sig   = match[2];
  // Reconstruct UUID with hyphens
  const itemId = [
    rawId.slice(0, 8),
    rawId.slice(8, 12),
    rawId.slice(12, 16),
    rawId.slice(16, 20),
    rawId.slice(20),
  ].join('-');
  const expected = crypto
    .createHmac('sha256', QR_SECRET)
    .update(itemId)
    .digest('hex')
    .slice(0, 12);
  if (!crypto.timingSafeEqual(Buffer.from(sig.toLowerCase()), Buffer.from(expected))) return null;
  return itemId;
}

// ---------------------------------------------------------------------------
// CRUD — inventory items
// ---------------------------------------------------------------------------
export async function createItem(data, userId, ip, userAgent) {
  const {
    name, sku, category, departmentId, unit,
    quantityInStock, reorderLevel, unitCost,
    expiryDate, supplier, location,
  } = data;

  const { rows } = await query(
    `INSERT INTO inventory_items
       (id, name, sku, category, department_id, unit, quantity_in_stock,
        reorder_level, unit_cost, expiry_date, supplier, location, created_at, updated_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
     RETURNING *`,
    [
      name, sku, category, departmentId ?? null, unit,
      quantityInStock, reorderLevel, unitCost ?? null,
      expiryDate ?? null, supplier ?? null, location ?? null,
    ]
  );

  await auditLog({
    userId, action: 'CREATE', entity: 'inventory_items',
    entityId: rows[0].id, nextData: data, ip, userAgent,
  });

  return rows[0];
}

export async function listItems({ page, limit, category, departmentId, search, lowStock }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where  = ['i.deleted_at IS NULL', 'i.is_active = TRUE'];

  if (category) {
    params.push(category);
    where.push(`i.category = $${params.length}`);
  }
  if (departmentId) {
    params.push(departmentId);
    where.push(`i.department_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(i.name ILIKE $${params.length} OR i.sku ILIKE $${params.length})`);
  }
  if (lowStock) {
    where.push('i.quantity_in_stock <= i.reorder_level');
  }

  params.push(limit, offset);

  const { rows } = await query(
    `SELECT i.*, d.name AS department_name, COUNT(*) OVER() AS total_count
     FROM inventory_items i
     LEFT JOIN departments d ON d.id = i.department_id
     WHERE ${where.join(' AND ')}
     ORDER BY i.name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    items: rows.map(({ total_count, ...r }) => r),
    total: parseInt(total, 10),
    page,
    limit,
  };
}

export async function getItemById(id) {
  const { rows } = await query(
    `SELECT i.*, d.name AS department_name
     FROM inventory_items i
     LEFT JOIN departments d ON d.id = i.department_id
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateItem(id, data, userId, ip, userAgent) {
  const existing = await getItemById(id);
  if (!existing) return null;

  const fieldMap = {
    name            : data.name,
    category        : data.category,
    department_id   : data.departmentId,
    unit            : data.unit,
    quantity_in_stock: data.quantityInStock,
    reorder_level   : data.reorderLevel,
    unit_cost       : data.unitCost,
    expiry_date     : data.expiryDate,
    supplier        : data.supplier,
    location        : data.location,
  };

  const setClauses = [];
  const params     = [];

  for (const [col, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  if (!setClauses.length) return existing;

  params.push(id);
  const { rows } = await query(
    `UPDATE inventory_items
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params
  );

  await auditLog({
    userId, action: 'UPDATE', entity: 'inventory_items',
    entityId: id, prevData: existing, nextData: data, ip, userAgent,
  });

  return rows[0];
}

export async function deleteItem(id, userId, ip, userAgent) {
  const { rows } = await query(
    `UPDATE inventory_items SET deleted_at = NOW(), is_active = FALSE
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (!rows[0]) return null;

  await auditLog({
    userId, action: 'DELETE', entity: 'inventory_items',
    entityId: id, ip, userAgent,
  });

  return rows[0];
}

// ---------------------------------------------------------------------------
// Quantity adjustment (separate from full update — for QR scan workflow)
// ---------------------------------------------------------------------------
export async function adjustQuantity(id, adjustment, reason, userId, ip, userAgent, io) {
  const { rows } = await query(
    `UPDATE inventory_items
     SET quantity_in_stock = quantity_in_stock + $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [adjustment, id]
  );
  if (!rows[0]) return null;

  const item = rows[0];

  await auditLog({
    userId, action: 'ADJUST_QUANTITY', entity: 'inventory_items',
    entityId: id,
    prevData: { quantity_in_stock: item.quantity_in_stock - adjustment },
    nextData: { quantity_in_stock: item.quantity_in_stock, adjustment, reason },
    ip, userAgent,
  });

  // Fire LOW_STOCK notification if now at or below reorder level
  if (item.quantity_in_stock <= item.reorder_level && io) {
    const { rows: invUsers } = await query(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role IN ('INVENTORY','ADMIN','SUPER_ADMIN')
         AND ur.revoked_at IS NULL AND u.deleted_at IS NULL
       LIMIT 5`
    );
    await Promise.allSettled(
      invUsers.map((u) =>
        createNotification(
          u.id,
          NotificationType.LOW_STOCK,
          'Low stock alert',
          `${item.name} (SKU: ${item.sku}) is at ${item.quantity_in_stock} ${item.unit} — below reorder level of ${item.reorder_level}.`,
          { entityType: 'INVENTORY', entityId: id },
          io
        )
      )
    );
  }

  return item;
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------
export async function getBedMatrix() {
  const { rows } = await query(
    `SELECT
       r.id AS room_id, r.room_number, r.room_type, r.floor,
       d.name AS department_name,
       b.id AS bed_id, b.bed_number, b.status,
       p.first_name AS patient_first, p.last_name AS patient_last, p.mrn
     FROM rooms r
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN beds b ON b.room_id = r.id AND b.deleted_at IS NULL
     LEFT JOIN patients p ON p.current_bed_id = b.id AND p.deleted_at IS NULL
     WHERE r.deleted_at IS NULL AND r.is_active = TRUE
     ORDER BY r.floor ASC, r.room_number ASC, b.bed_number ASC`
  );

  // Group by room
  const roomMap = new Map();
  for (const row of rows) {
    if (!roomMap.has(row.room_id)) {
      roomMap.set(row.room_id, {
        id            : row.room_id,
        roomNumber    : row.room_number,
        roomType      : row.room_type,
        floor         : row.floor,
        departmentName: row.department_name,
        beds          : [],
      });
    }
    if (row.bed_id) {
      roomMap.get(row.room_id).beds.push({
        id         : row.bed_id,
        bedNumber  : row.bed_number,
        status     : row.status,
        patient    : row.patient_first
          ? { firstName: row.patient_first, lastName: row.patient_last, mrn: row.mrn }
          : null,
      });
    }
  }

  return Array.from(roomMap.values());
}

export async function updateBedStatus(id, { status, notes }, userId, ip, userAgent) {
  const { rows: prev } = await query(
    `SELECT * FROM beds WHERE id = $1 AND deleted_at IS NULL`, [id]
  );
  if (!prev[0]) return null;

  const { rows } = await query(
    `UPDATE beds SET status = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [status, id]
  );

  await auditLog({
    userId, action: 'UPDATE_BED', entity: 'beds',
    entityId: id,
    prevData: { status: prev[0].status },
    nextData: { status, notes },
    ip, userAgent,
  });

  return rows[0];
}

// ---------------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------------
export async function generateQrData(itemId, userId, ip, userAgent) {
  const item = await getItemById(itemId);
  if (!item) return null;

  const code = signQrPayload(itemId);

  await auditLog({
    userId, action: 'GENERATE_QR', entity: 'inventory_items',
    entityId: itemId, nextData: { code }, ip, userAgent,
  });

  return { code, item };
}

export async function lookupByQrCode(code) {
  const itemId = verifyQrCode(code);
  if (!itemId) return null;
  return getItemById(itemId);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export async function getAlerts() {
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const { rows: lowStock } = await query(
    `SELECT i.*, d.name AS department_name
     FROM inventory_items i
     LEFT JOIN departments d ON d.id = i.department_id
     WHERE i.deleted_at IS NULL
       AND i.is_active = TRUE
       AND i.quantity_in_stock <= i.reorder_level
     ORDER BY (i.quantity_in_stock / NULLIF(i.reorder_level, 0)) ASC
     LIMIT 50`
  );

  const { rows: expiring } = await query(
    `SELECT i.*, d.name AS department_name
     FROM inventory_items i
     LEFT JOIN departments d ON d.id = i.department_id
     WHERE i.deleted_at IS NULL
       AND i.is_active = TRUE
       AND i.expiry_date IS NOT NULL
       AND i.expiry_date <= $1
     ORDER BY i.expiry_date ASC
     LIMIT 50`,
    [thirtyDaysOut]
  );

  return { lowStock, expiring };
}

// ---------------------------------------------------------------------------
// Stats (for dashboard cards)
// ---------------------------------------------------------------------------
export async function getStats() {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE category = 'MEDICINE')   AS total_medicines,
       COUNT(*) FILTER (WHERE category = 'EQUIPMENT')  AS total_equipment,
       COUNT(*) FILTER (WHERE quantity_in_stock <= reorder_level) AS low_stock_count
     FROM inventory_items
     WHERE deleted_at IS NULL AND is_active = TRUE`
  );

  const { rows: bedRows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available,
       COUNT(*)                                      AS total
     FROM beds WHERE deleted_at IS NULL`
  );

  return {
    totalMedicines : parseInt(rows[0].total_medicines, 10),
    totalEquipment : parseInt(rows[0].total_equipment, 10),
    lowStockCount  : parseInt(rows[0].low_stock_count, 10),
    bedsAvailable  : parseInt(bedRows[0].available, 10),
    bedsTotal      : parseInt(bedRows[0].total, 10),
  };
}

// ---------------------------------------------------------------------------
// CSV bulk import
// ---------------------------------------------------------------------------
export async function importFromCsv(buffer, userId, ip, userAgent) {
  const records = csvParse(buffer, {
    columns         : true,
    skip_empty_lines: true,
    trim            : true,
  });

  const results = { created: 0, skipped: 0, errors: [] };

  for (const [i, row] of records.entries()) {
    try {
      const name     = row.name?.trim();
      const sku      = row.sku?.trim();
      const category = row.category?.trim().toUpperCase();
      const unit     = row.unit?.trim();

      if (!name || !sku || !category || !unit) {
        results.errors.push({ row: i + 2, error: 'Missing required fields: name, sku, category, unit' });
        results.skipped++;
        continue;
      }

      const validCategories = ['MEDICINE', 'EQUIPMENT', 'CONSUMABLE', 'LINEN', 'CHEMICAL', 'OTHER'];
      if (!validCategories.includes(category)) {
        results.errors.push({ row: i + 2, error: `Invalid category: ${category}` });
        results.skipped++;
        continue;
      }

      // Upsert by SKU
      await query(
        `INSERT INTO inventory_items
           (id, name, sku, category, unit, quantity_in_stock, reorder_level,
            unit_cost, expiry_date, supplier, location, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (sku) DO UPDATE SET
           name             = EXCLUDED.name,
           category         = EXCLUDED.category,
           unit             = EXCLUDED.unit,
           quantity_in_stock= EXCLUDED.quantity_in_stock,
           reorder_level    = EXCLUDED.reorder_level,
           unit_cost        = EXCLUDED.unit_cost,
           expiry_date      = EXCLUDED.expiry_date,
           supplier         = EXCLUDED.supplier,
           location         = EXCLUDED.location,
           updated_at       = NOW()`,
        [
          name, sku, category, unit,
          parseFloat(row.quantity_in_stock) || 0,
          parseFloat(row.reorder_level)     || 0,
          row.unit_cost   ? parseFloat(row.unit_cost)   : null,
          row.expiry_date ? row.expiry_date             : null,
          row.supplier    || null,
          row.location    || null,
        ]
      );

      results.created++;
    } catch (err) {
      results.errors.push({ row: i + 2, error: err.message });
      results.skipped++;
    }
  }

  await auditLog({
    userId, action: 'CSV_IMPORT', entity: 'inventory_items',
    nextData: { created: results.created, skipped: results.skipped },
    ip, userAgent,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Rooms & Beds — create
// ---------------------------------------------------------------------------
export async function createRoom({ roomNumber, roomType, floor, departmentId }, userId, ip, userAgent) {
  const { rows } = await query(
    `INSERT INTO rooms (room_number, room_type, floor, department_id, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
     RETURNING *`,
    [roomNumber, roomType, floor, departmentId ?? null]
  );
  await auditLog({
    userId, action: 'CREATE', entity: 'rooms',
    entityId: rows[0].id,
    prevData: null, nextData: rows[0],
    ip, userAgent,
  });
  return rows[0];
}

export async function createBed({ roomId, bedNumber }, userId, ip, userAgent) {
  // verify room exists
  const { rows: roomRows } = await query(
    `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL`, [roomId]
  );
  if (!roomRows[0]) return null;

  const { rows } = await query(
    `INSERT INTO beds (room_id, bed_number, status, created_at, updated_at)
     VALUES ($1, $2, 'AVAILABLE', NOW(), NOW())
     RETURNING *`,
    [roomId, bedNumber]
  );
  await auditLog({
    userId, action: 'CREATE', entity: 'beds',
    entityId: rows[0].id,
    prevData: null, nextData: rows[0],
    ip, userAgent,
  });
  return rows[0];
}
