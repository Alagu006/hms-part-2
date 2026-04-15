import { query, withTransaction } from '../../shared/db/pool.js';
import { pgEncrypt, pgDecrypt }   from '../../shared/db/pgcrypto.js';
import { redis }                  from '../../shared/services/redis.service.js';
import { auditLog }               from '../../shared/middleware/audit.js';
import { notificationQueue }      from '../../shared/jobs/queue.js';
import { checkInteractions, checkAllergies } from './interactions.js';

const MEDICINE_CACHE_TTL = 60 * 60; // 1 hour

const DOSES_PER_DAY = { '1x': 1, '2x': 2, '3x': 3, 'SOS': 1 };

function calcQuantity(frequency, durationDays) {
  return (DOSES_PER_DAY[frequency] ?? 1) * durationDays;
}

// ---------------------------------------------------------------------------
// OpenFDA helpers
// ---------------------------------------------------------------------------
function mapOpenFdaResult(item) {
  const openfda  = item.openfda ?? {};
  const brand    = (openfda.brand_name ?? [])[0] ?? null;
  const generic  = (openfda.generic_name ?? [])[0] ?? null;
  const routes  = (openfda.route ?? [])[0] ?? null;

  if (!brand && !generic) return null;

  return {
    id        : null,
    name      : brand ?? generic,
    genericName: generic ?? null,
    form      : routes ?? null,
    source    : 'openfda',
  };
}

async function fetchFromOpenFda(q) {
  try {
    const url     = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(q)}"&limit=5`;
    const controller = new AbortController();
    const timer    = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.error(`[openfda] Non-200 response: ${res.status} for query "${q}"`);
      return [];
    }

    const data = await res.json();
    const results = (data.results ?? [])
      .map(mapOpenFdaResult)
      .filter(Boolean);

    return results;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[openfda] Timeout fetching results for "${q}"`);
    } else {
      console.error(`[openfda] Error fetching results for "${q}":`, err.message);
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Medicine search — local DB + OpenFDA merge, Redis-cached
// ---------------------------------------------------------------------------
export async function searchMedicines(q) {
  const cacheKey = `medicine:search:${q.toLowerCase()}`;
  const cached   = await redis.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  const [localRows, openfdaResults] = await Promise.all([
    query(
      `SELECT id, name, generic_name AS "genericName", form, strength, category, is_controlled
       FROM medicines
       WHERE deleted_at IS NULL
         AND is_active = TRUE
         AND (name ILIKE $1 OR generic_name ILIKE $1)
       ORDER BY name
       LIMIT 10`,
      [`%${q}%`]
    ),
    fetchFromOpenFda(q),
  ]);

  const local = localRows.rows.map((r) => ({ ...r, source: 'local' }));

  const seen = new Set(local.map((r) => r.name.toLowerCase()));
  const merged = [...local];
  for (const item of openfdaResults) {
    if (!seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      merged.push(item);
      if (merged.length >= 10) break;
    }
  }

  const result = merged.slice(0, 10);
  await redis.setex(cacheKey, MEDICINE_CACHE_TTL, JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// Import medicines from OpenFDA into local DB (ADMIN only)
// ---------------------------------------------------------------------------
export async function importOpenFdaMedicines(queryStr) {
  let openfdaResults;
  try {
    const url      = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(queryStr)}"&limit=20`;
    const controller = new AbortController();
    const timer    = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`OpenFDA returned ${res.status}`);
    const data = await res.json();
    openfdaResults = (data.results ?? []).map(mapOpenFdaResult).filter(Boolean);
  } catch (err) {
    console.error(`[openfda] Import failed for "${queryStr}":`, err.message);
    throw Object.assign(new Error(`OpenFDA import failed: ${err.message}`), { status: 502 });
  }

  if (!openfdaResults.length) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped  = 0;

  for (const med of openfdaResults) {
    try {
      const { rows: [existing] } = await query(
        `SELECT id FROM medicines WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [med.name]
      );
      if (existing) { skipped++; continue; }

      await query(
        `INSERT INTO medicines (name, generic_name, form, category, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, 'GENERAL', TRUE, NOW(), NOW())`,
        [med.name, med.genericName ?? med.name, med.form ?? 'ORAL']
      );
      imported++;
    } catch (err) {
      console.warn(`[openfda] Skipped "${med.name}":`, err.message);
      skipped++;
    }
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// Create prescription
// ---------------------------------------------------------------------------
export async function createPrescription(data, doctorId, ip, userAgent) {
  const { patientId, diagnosisCodes, notes, items, nurseId, nurseInstructions } = data;

  // 1. Fetch patient (need allergies for check)
  const { rows: patRows } = await query(
    `SELECT id, first_name, last_name, allergies, user_id FROM patients
     WHERE id = $1 AND deleted_at IS NULL`,
    [patientId]
  );
  if (!patRows[0]) throw Object.assign(new Error('Patient not found'), { status: 404 });

  const patient      = patRows[0];
  const medicineNames = items.map((i) => i.medicineName);

  // 2. Drug interaction check
  const interactions = checkInteractions(medicineNames);
  const contraindicated = interactions.filter((i) => i.severity === 'CONTRAINDICATED');
  if (contraindicated.length) {
    const msg = contraindicated.map((i) => `${i.drug1} + ${i.drug2}: ${i.description}`).join('; ');
    throw Object.assign(new Error(`Contraindicated combination: ${msg}`), { status: 422 });
  }

  // 3. Allergy check
  const allergyHits = checkAllergies(patient.allergies ?? [], medicineNames);

  // 4. Encrypt notes
  const encryptedNotes = notes ? await pgEncrypt(notes) : null;

  const prescription = await withTransaction(async (client) => {
    // Insert prescription header
    const { rows: pRows } = await client.query(
      `INSERT INTO prescriptions
         (id, medical_record_id, patient_id, prescribed_by, nurse_id, nurse_instructions, status, notes, created_at, updated_at)
       VALUES
         (gen_random_uuid(),
          (SELECT id FROM medical_records WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1),
          $1, $2, $3, $4, 'PENDING', $5, NOW(), NOW())
       RETURNING *`,
      [patientId, doctorId, nurseId ?? null, nurseInstructions ? await pgEncrypt(nurseInstructions) : null, encryptedNotes]
    );
    const presc = pRows[0];

    // Insert items
    for (const item of items) {
      const qty          = calcQuantity(item.frequency, item.durationDays);
      const encInstr     = item.instructions ? await pgEncrypt(item.instructions) : null;

      await client.query(
        `INSERT INTO prescription_items
           (id, prescription_id, medicine_id, dosage, frequency, duration_days,
            quantity, instructions, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          presc.id,
          item.medicineId,
          item.dosage,
          item.frequency,
          item.durationDays,
          qty,
          encInstr,
        ]
      );
    }

    // Store diagnosis codes in notes JSON (no separate table in schema)
    await client.query(
      `UPDATE prescriptions SET notes = $1 WHERE id = $2`,
      [
        await pgEncrypt(JSON.stringify({ diagnosisCodes, freeNotes: notes ?? '' })),
        presc.id,
      ]
    );

    return presc;
  });

  // 5. Audit
  await auditLog({
    userId  : doctorId,
    action  : 'CREATE',
    entity  : 'prescriptions',
    entityId: prescription.id,
    nextData: { patientId, diagnosisCodes, itemCount: items.length },
    ip,
    userAgent,
  });

  // 6. Notify pharmacists (broadcast to role queue)
  await notificationQueue.add('push', {
    targetRole: 'PHARMACIST',
    type      : 'PRESCRIPTION',
    title     : 'New prescription issued',
    body      : `Prescription for patient ${patient.first_name} ${patient.last_name} is ready for dispensing.`,
    entityId  : prescription.id,
  });

  // 7. Notify patient (if they have a portal account)
  if (patient.user_id) {
    await notificationQueue.add('push', {
      userId  : patient.user_id,
      type    : 'PRESCRIPTION',
      title   : 'New prescription',
      body    : 'Your doctor has issued a new prescription. Visit the pharmacy to collect your medicines.',
      entityId: prescription.id,
    });
  }

  // 8. Notify assigned nurse
  if (nurseId) {
    await notificationQueue.add('push', {
      userId  : nurseId,
      type    : 'PRESCRIPTION',
      title   : 'Nurse medication assignment',
      body    : `You have been assigned to administer medication for ${patient.first_name} ${patient.last_name}.${nurseInstructions ? ' Instructions: ' + nurseInstructions : ''}`,
      entityId: prescription.id,
    });
  }

  return {
    ...prescription,
    interactions: interactions.filter((i) => i.severity !== 'CONTRAINDICATED'),
    allergyWarnings: allergyHits,
  };
}

// ---------------------------------------------------------------------------
// Get prescription by ID
// ---------------------------------------------------------------------------
export async function getPrescriptionById(id, requestingUser) {
  const { rows } = await query(
    `SELECT
       p.*,
       pat.first_name AS patient_first, pat.last_name AS patient_last, pat.user_id AS patient_user_id,
       u.first_name   AS doctor_first,  u.last_name   AS doctor_last
     FROM prescriptions p
     JOIN patients pat ON pat.id = p.patient_id
     JOIN users    u   ON u.id   = p.prescribed_by
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) return null;

  const presc = rows[0];

  // PATIENT can only see their own
  if (
    requestingUser.roles.includes('PATIENT') &&
    presc.patient_user_id !== requestingUser.id
  ) return 'FORBIDDEN';

  // Decrypt notes
  if (presc.notes) {
    try {
      const raw = await pgDecrypt(presc.notes);
      presc.notes = JSON.parse(raw);
    } catch {
      presc.notes = null;
    }
  }

  // Fetch items
  const { rows: itemRows } = await query(
    `SELECT pi.*, m.name AS medicine_name, m.form, m.strength, m.generic_name
     FROM prescription_items pi
     JOIN medicines m ON m.id = pi.medicine_id
     WHERE pi.prescription_id = $1`,
    [id]
  );

  // Decrypt item instructions
  const items = await Promise.all(
    itemRows.map(async (item) => {
      if (item.instructions) {
        try { item.instructions = await pgDecrypt(item.instructions); } catch { item.instructions = null; }
      }
      return item;
    })
  );

  return { ...presc, items };
}

// ---------------------------------------------------------------------------
// Patient prescription history
// ---------------------------------------------------------------------------
export async function getPatientPrescriptions(patientId, { page, limit }) {
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT
       p.id, p.status, p.created_at, p.updated_at,
       u.first_name || ' ' || u.last_name AS doctor_name,
       COUNT(pi.id) AS item_count,
       COUNT(*) OVER() AS total_count
     FROM prescriptions p
     JOIN users u ON u.id = p.prescribed_by
     LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
     WHERE p.patient_id = $1 AND p.deleted_at IS NULL
     GROUP BY p.id, u.first_name, u.last_name
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [patientId, limit, offset]
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    prescriptions: rows.map(({ total_count, ...r }) => r),
    total        : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// List prescriptions (for pharmacist queue)
// ---------------------------------------------------------------------------
export async function listPrescriptions({ status, date, page, limit }) {
  const offset     = (page - 1) * limit;
  const params    = [];
  const where     = ['p.deleted_at IS NULL'];

  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }

  if (date) {
    params.push(date);
    where.push(`DATE(p.created_at) = $${params.length}`);
  }

  params.push(limit, offset);

  const { rows } = await query(
    `SELECT
       p.id, p.status, p.created_at, p.updated_at,
       pat.id   AS patient_id,
       pat.first_name  AS patient_first,
       pat.last_name   AS patient_last,
       pat.mrn AS patient_mrn,
       u.id    AS doctor_id,
       u.first_name  AS doctor_first,
       u.last_name   AS doctor_last,
       COUNT(pi.id) AS item_count,
       COUNT(*) OVER() AS total_count
     FROM prescriptions p
     JOIN patients    pat ON pat.id = p.patient_id
     JOIN users       u   ON u.id   = p.prescribed_by
     LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
     WHERE ${where.join(' AND ')}
     GROUP BY p.id, pat.id, u.id
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  return {
    prescriptions: rows.map(({ total_count, ...r }) => r),
    total        : parseInt(total, 10),
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Dispense
// ---------------------------------------------------------------------------
export async function dispensePrescription(id, { dispensedItems, notes }, pharmacistId, ip, userAgent) {
  const { rows } = await query(
    `SELECT * FROM prescriptions WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!rows[0]) return null;
  if (rows[0].status === 'DISPENSED') {
    throw Object.assign(new Error('Prescription already fully dispensed'), { status: 409 });
  }

  const prev = rows[0];

  // Update each item's dispensed state
  for (const { itemId, dispensed } of dispensedItems) {
    if (dispensed) {
      await query(
        `UPDATE prescription_items SET quantity = quantity WHERE id = $1 AND prescription_id = $2`,
        [itemId, id]
      );
    }
  }

  // Determine new status
  const { rows: allItems } = await query(
    `SELECT id FROM prescription_items WHERE prescription_id = $1`,
    [id]
  );
  const dispensedIds = dispensedItems.filter((i) => i.dispensed).map((i) => i.itemId);
  const allDispensed = allItems.every((i) => dispensedIds.includes(i.id));
  const newStatus    = allDispensed ? 'DISPENSED' : 'PARTIALLY_DISPENSED';

  const { rows: updated } = await query(
    `UPDATE prescriptions SET status = $1, dispensed_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newStatus, id]
  );

  // Create pharmacy order record
  await query(
    `INSERT INTO pharmacy_orders
       (id, prescription_id, patient_id, dispensed_by, status, dispensed_at, notes, created_at, updated_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, NOW(), $5, NOW(), NOW())`,
    [id, prev.patient_id, pharmacistId, newStatus === 'DISPENSED' ? 'DISPENSED' : 'PARTIALLY_DISPENSED', notes ?? null]
  );

  await auditLog({
    userId  : pharmacistId,
    action  : 'DISPENSE',
    entity  : 'prescriptions',
    entityId: id,
    prevData: { status: prev.status },
    nextData: { status: newStatus, dispensedItems },
    ip,
    userAgent,
  });

  return updated[0];
}

export async function countPrescriptions({ status, patientId }, doctorId) {
  const params   = [];
  const where    = ['pr.deleted_at IS NULL'];

  if (status) {
    params.push(status);
    where.push(`pr.status = $${params.length}`);
  }
  if (patientId) {
    params.push(patientId);
    where.push(`pr.patient_id = $${params.length}`);
  } else if (doctorId) {
    params.push(doctorId);
    where.push(`pr.prescribed_by = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT COUNT(*) AS count FROM prescriptions pr WHERE ${where.join(' AND ')}`,
    params
  );

  return parseInt(rows[0]?.count ?? 0, 10);
}
