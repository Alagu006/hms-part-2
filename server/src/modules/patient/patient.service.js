import crypto from 'crypto';
import argon2 from 'argon2';
import { query, withTransaction } from '../../shared/db/pool.js';
import { pgEncrypt, pgDecrypt, pgEncryptFields, pgDecryptFields } from '../../shared/db/pgcrypto.js';
import { auditLog } from '../../shared/middleware/audit.js';
import { sendTempPassword } from '../../shared/services/email.service.js';

// Fields that are encrypted at rest via pgcrypto
const ENCRYPTED_FIELDS = ['email', 'phone', 'address', 'emergency_contact'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateMRN() {
  return `MRN-${Date.now().toString().slice(-6)}`;
}

function generateTempPassword() {
  // 16-char alphanumeric + symbols
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

async function decryptPatientRow(row) {
  if (!row) return null;
  return pgDecryptFields(row, ENCRYPTED_FIELDS);
}

async function decryptPatientRows(rows) {
  return Promise.all(rows.map(decryptPatientRow));
}

// Camel → snake for DB insert/update
function toSnake(obj) {
  const map = {
    firstName       : 'first_name',
    lastName        : 'last_name',
    dateOfBirth     : 'date_of_birth',
    bloodGroup      : 'blood_group',
    emergencyContact: 'emergency_contact',
  };
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[map[k] ?? k] = v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
export async function createPatient(data, createdBy, ip, userAgent) {
  const snaked   = toSnake(data);
  const tempPass = generateTempPassword();
  const mrn      = generateMRN();

  const passHash = await argon2.hash(tempPass, {
    type       : argon2.argon2id,
    memoryCost : 65536,
    timeCost   : 3,
    parallelism: 4,
  });

  // Encrypt sensitive fields
  const encrypted = await pgEncryptFields(snaked, ENCRYPTED_FIELDS.filter(f => snaked[f] != null));

  const patient = await withTransaction(async (client) => {
    // Create portal user account for the patient
    const { rows: userRows } = await client.query(
      `INSERT INTO users
         (id, first_name, last_name, email, phone, gender, date_of_birth, password_hash, must_change_password, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
       RETURNING id`,
      [
        snaked.first_name,
        snaked.last_name,
        encrypted.email  ?? null,
        encrypted.phone  ?? null,
        snaked.gender    ?? null,
        snaked.date_of_birth ?? null,
        passHash,
      ]
    );
    const userId = userRows[0].id;

    // Assign PATIENT role
    await client.query(
      `INSERT INTO user_roles (id, user_id, role, granted_by)
       VALUES (gen_random_uuid(), $1, 'PATIENT', $2)`,
      [userId, createdBy]
    );

    // Create patient record
    const { rows: patientRows } = await client.query(
      `INSERT INTO patients
         (id, mrn, first_name, last_name, date_of_birth, gender, blood_group,
          email, phone, address, emergency_contact, user_id, created_by, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        mrn,
        snaked.first_name,
        snaked.last_name,
        snaked.date_of_birth,
        snaked.gender,
        snaked.blood_group  ?? null,
        encrypted.email     ?? null,
        encrypted.phone     ?? null,
        encrypted.address   ?? null,
        encrypted.emergency_contact ?? null,
        userId,
        createdBy,
      ]
    );

    return patientRows[0];
  });

  await auditLog({
    userId  : createdBy,
    action  : 'CREATE',
    entity  : 'patients',
    entityId: patient.id,
    nextData: { mrn: patient.mrn },
    ip,
    userAgent,
  });

  // Send temp password — non-blocking via queue
  await sendTempPassword(data.email, mrn, tempPass, 'Patient ID (MRN)');

  return decryptPatientRow(patient);
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
export async function listPatients({ status, departmentId, ward, search, doctorId, page, limit }) {
  const offset = (page - 1) * limit;
  const params = [];
  const where  = ['p.deleted_at IS NULL', '(p.user_id IS NULL OR u.deleted_at IS NULL)'];

  if (status === 'inpatient') {
    where.push('p.current_bed_id IS NOT NULL');
  } else if (status === 'outpatient') {
    where.push('p.current_bed_id IS NULL');
  }

  if (departmentId) {
    params.push(departmentId);
    where.push(`b.room_id IN (SELECT id FROM rooms WHERE department_id = $${params.length})`);
  }

  if (ward) {
    params.push(`%${ward}%`);
    where.push(`r.room_number ILIKE $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    where.push(`(p.mrn ILIKE $${idx} OR p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx})`);
  }

  if (doctorId) {
    params.push(doctorId);
    where.push(`p.id IN (
      SELECT DISTINCT a.patient_id FROM appointments a
      WHERE a.doctor_id = $${params.length} AND a.deleted_at IS NULL
    )`);
  }

  const whereClause = where.join(' AND ');

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    SELECT
      p.id, p.mrn, p.first_name, p.last_name, p.date_of_birth,
      p.gender, p.blood_group, p.email, p.phone,
      p.current_bed_id, p.created_at,
      b.bed_number, r.room_number,
      CASE WHEN p.current_bed_id IS NOT NULL THEN 'inpatient' ELSE 'outpatient' END AS status,
      COUNT(*) OVER() AS total_count
    FROM patients p
    LEFT JOIN beds  b ON b.id = p.current_bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const { rows } = await query(sql, params);
  const total    = rows[0]?.total_count ?? 0;
  const patients = await decryptPatientRows(rows.map(({ total_count, ...r }) => r));

  return { patients, total: parseInt(total, 10), page, limit };
}

// ---------------------------------------------------------------------------
// GET BY ID
// ---------------------------------------------------------------------------
export async function getPatientById(id, requestingUser) {
  const { rows } = await query(
    `SELECT
       p.*,
       b.bed_number, r.room_number, r.room_type,
       d.name AS department_name,
       CASE WHEN p.current_bed_id IS NOT NULL THEN 'inpatient' ELSE 'outpatient' END AS status
     FROM patients p
     LEFT JOIN beds        b ON b.id = p.current_bed_id
     LEFT JOIN rooms       r ON r.id = b.room_id
     LEFT JOIN departments d ON d.id = r.department_id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id]
  );

  if (!rows[0]) return null;

  // PATIENT role can only see their own record
  if (
    requestingUser.roles.includes('PATIENT') &&
    rows[0].user_id !== requestingUser.id
  ) {
    return 'FORBIDDEN';
  }

  return decryptPatientRow(rows[0]);
}

// ---------------------------------------------------------------------------
// LOOKUP BY MRN (for security check-in)
// ---------------------------------------------------------------------------
export async function getPatientByMrn(mrn) {
  const { rows } = await query(
    `SELECT p.id, p.mrn, p.first_name, p.last_name, p.date_of_birth, p.gender, p.blood_group
     FROM patients p
     WHERE UPPER(p.mrn) = UPPER($1) AND p.deleted_at IS NULL
     LIMIT 1`,
    [mrn]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------
export async function updatePatient(id, data, updatedBy, ip, userAgent) {
  const { rows: existing } = await query(
    'SELECT * FROM patients WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (!existing[0]) return null;

  const snaked    = toSnake(data);
  const encrypted = await pgEncryptFields(snaked, ENCRYPTED_FIELDS.filter(f => snaked[f] != null));

  const setClauses = [];
  const params     = [];

  const fieldMap = {
    first_name       : encrypted.first_name        ?? snaked.first_name,
    last_name        : encrypted.last_name          ?? snaked.last_name,
    date_of_birth    : snaked.date_of_birth,
    gender           : snaked.gender,
    blood_group      : snaked.blood_group,
    email            : encrypted.email,
    phone            : encrypted.phone,
    address          : encrypted.address,
    emergency_contact: encrypted.emergency_contact,
  };

  for (const [col, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) return existing[0];

  params.push(id);
  const { rows } = await query(
    `UPDATE patients SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params
  );

  const prevDecrypted = await decryptPatientRow(existing[0]);

  await auditLog({
    userId  : updatedBy,
    action  : 'UPDATE',
    entity  : 'patients',
    entityId: id,
    prevData: prevDecrypted,
    nextData: data,
    ip,
    userAgent,
  });

  return decryptPatientRow(rows[0]);
}

// ---------------------------------------------------------------------------
// TIMELINE
// ---------------------------------------------------------------------------
export async function getPatientTimeline(patientId, requestingUser, { page, limit }) {
  // PATIENT role can only see their own timeline
  if (requestingUser.roles.includes('PATIENT')) {
    const { rows } = await query(
      'SELECT id FROM patients WHERE user_id = $1 AND deleted_at IS NULL',
      [requestingUser.id]
    );
    if (!rows[0] || rows[0].id !== patientId) return 'FORBIDDEN';
  }

  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT
       'appointment'   AS type,
       a.id,
       a.scheduled_at  AS event_date,
       a.status,
       a.type          AS sub_type,
       u.first_name || ' ' || u.last_name AS doctor_name,
       NULL            AS notes,
       COUNT(*) OVER() AS total_count
     FROM appointments a
     JOIN users u ON u.id = a.doctor_id
     WHERE a.patient_id = $1 AND a.deleted_at IS NULL

     UNION ALL

     SELECT
       'medical_record' AS type,
       mr.id,
       mr.visit_date    AS event_date,
       NULL             AS status,
       NULL             AS sub_type,
       u.first_name || ' ' || u.last_name AS doctor_name,
       mr.notes,
       COUNT(*) OVER()  AS total_count
     FROM medical_records mr
     JOIN users u ON u.id = mr.attending_doctor_id
     WHERE mr.patient_id = $1 AND mr.deleted_at IS NULL

     UNION ALL

     SELECT
       'lab_order'      AS type,
       lo.id,
       lo.ordered_at    AS event_date,
       lo.status,
       lo.priority      AS sub_type,
       u.first_name || ' ' || u.last_name AS doctor_name,
       lo.notes,
       COUNT(*) OVER()  AS total_count
     FROM lab_orders lo
     JOIN users u ON u.id = lo.ordered_by
     WHERE lo.patient_id = $1 AND lo.deleted_at IS NULL

     ORDER BY event_date DESC
     LIMIT $2 OFFSET $3`,
    [patientId, limit, offset]
  );

  const total = rows[0]?.total_count ?? 0;
  const items = rows.map(({ total_count, ...r }) => r);

  return { items, total: parseInt(total, 10), page, limit };
}

// ---------------------------------------------------------------------------
// MY RECORDS (PATIENT self-service)
// ---------------------------------------------------------------------------
export async function getMyRecords(userId) {
  const { rows } = await query(
    `SELECT p.* FROM patients p WHERE p.user_id = $1 AND p.deleted_at IS NULL`,
    [userId]
  );
  if (!rows[0]) return null;
  return decryptPatientRow(rows[0]);
}

// ---------------------------------------------------------------------------
// Get single medical record by ID
// ---------------------------------------------------------------------------
export async function getMedicalRecordById(recordId) {
  const { rows } = await query(
    `SELECT mr.*,
            p.first_name || ' ' || p.last_name AS patient_name,
            u.first_name || ' ' || u.last_name AS doctor_name,
            d.name AS department_name
     FROM medical_records mr
     JOIN patients p ON p.id = mr.patient_id
     JOIN users u ON u.id = mr.attending_doctor_id
     LEFT JOIN departments d ON d.id = mr.department_id
     WHERE mr.id = $1 AND mr.deleted_at IS NULL`,
    [recordId]
  );
  return rows[0] ?? null;
}
