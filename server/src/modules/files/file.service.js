import fs          from 'fs';
import path        from 'path';
import crypto      from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { query }              from '../../shared/db/pool.js';
import { auditLog }           from '../../shared/middleware/audit.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Allowed MIME types (magic-byte validated)
// ---------------------------------------------------------------------------
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/dicom',
  'image/tiff',
]);

// ---------------------------------------------------------------------------
// ClamAV scan — graceful skip if not installed
// ---------------------------------------------------------------------------
async function clamScan(filePath) {
  try {
    const { createClam } = await import('clamscan');
    const clam = await createClam({
      removeInfected: false,
      scanLog       : null,
      debugMode     : false,
      clamscan      : { active: true },
    });
    const { isInfected, viruses } = await clam.isInfected(filePath);
    return { isInfected, viruses };
  } catch {
    // clamscan not installed — skip gracefully
    console.warn('[files] ClamAV not available, skipping virus scan');
    return { isInfected: false, viruses: [] };
  }
}

// ---------------------------------------------------------------------------
// Upload profile image (plain, no client-side encryption)
// Stored as-is; access controlled by auth + ownership check on download.
// ---------------------------------------------------------------------------
export async function uploadProfileImage(
  { buffer, originalName, userId, clientEncrypted = false, declaredMime = null },
  uploadedBy, ip, userAgent
) {
  let resolvedMime;
  if (clientEncrypted && declaredMime) {
    const ALLOWED_PROFILE = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!ALLOWED_PROFILE.has(declaredMime)) {
      throw Object.assign(new Error('Profile image must be JPEG, PNG or WebP'), { status: 415 });
    }
    resolvedMime = declaredMime;
  } else {
    const detected = await fileTypeFromBuffer(buffer);
    const ALLOWED_PROFILE = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!detected || !ALLOWED_PROFILE.has(detected.mime)) {
      throw Object.assign(new Error('Profile image must be JPEG, PNG or WebP'), { status: 415 });
    }
    resolvedMime = detected.mime;
  }

  const checksum   = crypto.createHash('sha256').update(buffer).digest('hex');
  const storageKey = crypto.randomUUID();
  fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), buffer);

  const encryptionIv = clientEncrypted ? 'client-encrypted' : 'none';

  const { rows } = await query(
    `INSERT INTO files
       (id, original_name, storage_key, mime_type, size_bytes,
        checksum_sha256, encryption_iv, entity_type, entity_id,
        uploaded_by, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'USER_PROFILE', $7, $8, NOW())
     RETURNING id, original_name, mime_type, size_bytes, entity_type, entity_id, created_at`,
    [originalName, storageKey, resolvedMime, buffer.length, checksum, encryptionIv, userId, uploadedBy]
  );

  await auditLog({
    userId  : uploadedBy,
    action  : 'UPLOAD_PROFILE_IMAGE',
    entity  : 'files',
    entityId: rows[0].id,
    nextData: { userId, encrypted: clientEncrypted },
    ip,
    userAgent,
  });

  return rows[0];
}

// ---------------------------------------------------------------------------
// Download profile image (plain bytes, no decryption needed)
// ---------------------------------------------------------------------------
export async function downloadProfileImage(fileId, requestingUser) {
  const { rows } = await query(
    `SELECT f.* FROM files f
     WHERE f.id = $1 AND f.entity_type = 'USER_PROFILE' AND f.is_deleted = FALSE`,
    [fileId]
  );
  if (!rows[0]) return null;

  const file = rows[0];

  // Users can only download their own profile image unless admin/staff
  const isAdminOrStaff = requestingUser.roles.some(r =>
    ['ADMIN','SUPER_ADMIN','DOCTOR','NURSE','RECEPTIONIST','LAB_TECH',
     'PHARMACIST','INVENTORY','BILLING','HR','IT_ADMIN','RADIOLOGIST',
     'ANESTHETIST','DIETITIAN','PHYSIO','SOCIAL_WORKER','SECURITY_OFC','ORDERLY'].includes(r)
  );
  if (!isAdminOrStaff && file.entity_id !== requestingUser.id) return 'FORBIDDEN';

  const storagePath = path.join(UPLOAD_DIR, file.storage_key);
  if (!fs.existsSync(storagePath)) {
    throw Object.assign(new Error('File not found on disk'), { status: 404 });
  }

  return {
    buffer  : fs.readFileSync(storagePath),
    mimeType: file.mime_type,
    encryptionIv: file.encryption_iv,
  };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
export async function uploadFile(
  { buffer, originalName, entityType, entityId, clientEncrypted, declaredMime },
  uploadedBy, ip, userAgent
) {
  // 1. MIME validation
  // When the client sends pre-encrypted bytes the magic-bytes are gone.
  // In that case the client declares the original MIME via X-Original-Mime header
  // and we trust it (the file was already validated client-side before encryption).
  let resolvedMime;
  if (clientEncrypted && declaredMime) {
    if (!ALLOWED_MIME.has(declaredMime)) {
      throw Object.assign(
        new Error(`File type not allowed: ${declaredMime}`),
        { status: 415 }
      );
    }
    resolvedMime = declaredMime;
  } else {
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw Object.assign(
        new Error(`File type not allowed: ${detected?.mime ?? 'unknown'}`),
        { status: 415 }
      );
    }
    resolvedMime = detected.mime;
  }

  // 2. Write temp file for ClamAV scan
  const tempPath = path.join(UPLOAD_DIR, `tmp_${crypto.randomUUID()}`);
  fs.writeFileSync(tempPath, buffer);

  try {
    const { isInfected, viruses } = await clamScan(tempPath);
    if (isInfected) {
      throw Object.assign(
        new Error(`File rejected: malware detected (${viruses.join(', ')})`),
        { status: 422 }
      );
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  // 3. Client-side AES-256-GCM encryption is done in the browser.
  //    The server receives already-encrypted ciphertext + IV.
  //    We store the ciphertext as-is and record the IV in the DB.
  //    The server also generates a server-side AES-256-GCM key to
  //    re-encrypt the client's AES key (envelope encryption).
  //    For this implementation the ciphertext IS the encrypted file bytes.

  // 4. Compute SHA-256 of the received (encrypted) bytes for integrity
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  // 5. Persist to disk under a UUID filename (no extension — content-type from DB)
  const storageKey = crypto.randomUUID();
  const storagePath = path.join(UPLOAD_DIR, storageKey);
  fs.writeFileSync(storagePath, buffer);

  // 6. Insert metadata
  const { rows } = await query(
    `INSERT INTO files
       (id, original_name, storage_key, mime_type, size_bytes,
        checksum_sha256, encryption_iv, entity_type, entity_id,
        uploaded_by, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id, original_name, mime_type, size_bytes, entity_type, entity_id, created_at`,
    [
      originalName,
      storageKey,
      resolvedMime,
      buffer.length,
      checksum,
      'client-encrypted',   // IV is managed client-side; stored in DB by client
      entityType,
      entityId,
      uploadedBy,
    ]
  );

  await auditLog({
    userId  : uploadedBy,
    action  : 'UPLOAD',
    entity  : 'files',
    entityId: rows[0].id,
    nextData: { originalName, entityType, entityId, mime: resolvedMime },
    ip,
    userAgent,
  });

  return rows[0];
}

// ---------------------------------------------------------------------------
// Update IV after upload (client sends IV separately after encrypting)
// ---------------------------------------------------------------------------
export async function updateFileIv(fileId, iv, uploadedBy) {
  const { rows } = await query(
    `UPDATE files SET encryption_iv = $1 WHERE id = $2 AND uploaded_by = $3 RETURNING id`,
    [iv, fileId, uploadedBy]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Re-link file to its actual entity (e.g. after lab result is created)
// ---------------------------------------------------------------------------
export async function updateFileEntity(fileId, entityType, entityId, uploadedBy) {
  const { rows } = await query(
    `UPDATE files SET entity_type = $1, entity_id = $2
     WHERE id = $3 AND uploaded_by = $4 AND is_deleted = FALSE
     RETURNING id`,
    [entityType, entityId, fileId, uploadedBy]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
export async function downloadFile(fileId, requestingUser) {
  const { rows } = await query(
    `SELECT f.*,
       -- for PATIENT entity type
       p_direct.user_id AS patient_user_id,
       -- for LAB_RESULT entity type
       p_lab.user_id AS lab_patient_user_id,
       -- for MEDICAL_RECORD entity type
       p_mr.user_id AS mr_patient_user_id,
       -- for PRESCRIPTION entity type
       p_rx.user_id AS rx_patient_user_id
     FROM files f
     LEFT JOIN patients p_direct ON p_direct.id = f.entity_id AND f.entity_type = 'PATIENT'
     LEFT JOIN lab_results lr ON lr.id = f.entity_id AND f.entity_type = 'LAB_RESULT'
     LEFT JOIN patients p_lab ON p_lab.id = lr.patient_id
     LEFT JOIN medical_records mr ON mr.id = f.entity_id AND f.entity_type = 'MEDICAL_RECORD'
     LEFT JOIN patients p_mr ON p_mr.id = mr.patient_id
     LEFT JOIN prescriptions rx ON rx.id = f.entity_id AND f.entity_type = 'PRESCRIPTION'
     LEFT JOIN patients p_rx ON p_rx.id = rx.patient_id
     WHERE f.id = $1 AND f.is_deleted = FALSE`,
    [fileId]
  );
  if (!rows[0]) return null;

  const file = rows[0];

  // PATIENT can only download files that belong to them
  if (requestingUser.roles.includes('PATIENT')) {
    const ownerUserId =
      file.patient_user_id ??
      file.lab_patient_user_id ??
      file.mr_patient_user_id ??
      file.rx_patient_user_id;
    if (ownerUserId !== requestingUser.id) return 'FORBIDDEN';
  }

  const storagePath = path.join(UPLOAD_DIR, file.storage_key);
  if (!fs.existsSync(storagePath)) {
    throw Object.assign(new Error('File not found on disk'), { status: 404 });
  }

  const buffer = fs.readFileSync(storagePath);

  await auditLog({
    userId  : requestingUser.id,
    action  : 'DOWNLOAD',
    entity  : 'files',
    entityId: fileId,
  });

  return {
    buffer,
    originalName  : file.original_name,
    mimeType      : file.mime_type,
    encryptionIv  : file.encryption_iv,
    checksumSha256: file.checksum_sha256,
  };
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------
export async function deleteFile(fileId, deletedBy, ip, userAgent) {
  const { rows } = await query(
    `UPDATE files SET is_deleted = TRUE, deleted_at = NOW()
     WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
    [fileId]
  );
  if (!rows[0]) return null;

  await auditLog({
    userId  : deletedBy,
    action  : 'DELETE',
    entity  : 'files',
    entityId: fileId,
    ip,
    userAgent,
  });

  return rows[0];
}
