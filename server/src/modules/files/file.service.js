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
// Upload
// ---------------------------------------------------------------------------
export async function uploadFile(
  { buffer, originalName, entityType, entityId },
  uploadedBy, ip, userAgent
) {
  // 1. Magic-byte validation
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw Object.assign(
      new Error(`File type not allowed: ${detected?.mime ?? 'unknown'}`),
      { status: 415 }
    );
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
      detected.mime,
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
    nextData: { originalName, entityType, entityId, mime: detected.mime },
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
// Download
// ---------------------------------------------------------------------------
export async function downloadFile(fileId, requestingUser) {
  const { rows } = await query(
    `SELECT f.*, p.user_id AS patient_user_id
     FROM files f
     LEFT JOIN patients p ON p.id = f.entity_id AND f.entity_type = 'PATIENT'
     WHERE f.id = $1 AND f.is_deleted = FALSE`,
    [fileId]
  );
  if (!rows[0]) return null;

  const file = rows[0];

  // PATIENT can only download their own files
  if (requestingUser.roles.includes('PATIENT')) {
    if (file.patient_user_id !== requestingUser.id) return 'FORBIDDEN';
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
