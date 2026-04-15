import * as svc from './file.service.js';

export async function uploadFile(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { entityType, entityId } = req.body;
    if (!entityType || !entityId) {
      return res.status(422).json({ error: 'entityType and entityId are required' });
    }

    const ALLOWED_ENTITY_TYPES = [
      'MEDICAL_RECORD', 'LAB_RESULT', 'PRESCRIPTION',
      'MESSAGE', 'INCIDENT', 'PATIENT',
    ];
    if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
      return res.status(422).json({ error: `Invalid entityType: ${entityType}` });
    }

    const result = await svc.uploadFile(
      {
        buffer        : req.file.buffer,
        originalName  : req.file.originalname,
        entityType,
        entityId,
        clientEncrypted: req.headers['x-client-encrypted'] === 'true',
        declaredMime  : req.headers['x-original-mime'] ?? null,
      },
      req.user.id,
      req.ip,
      req.headers['user-agent']
    );

    return res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

export async function updateIv(req, res, next) {
  try {
    const { iv } = req.body;
    if (!iv) return res.status(422).json({ error: 'iv is required' });

    const result = await svc.updateFileIv(req.params.id, iv, req.user.id);
    if (!result) return res.status(404).json({ error: 'File not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function updateEntity(req, res, next) {
  try {
    const { entityType, entityId } = req.body;
    if (!entityType || !entityId) {
      return res.status(422).json({ error: 'entityType and entityId are required' });
    }
    const result = await svc.updateFileEntity(req.params.id, entityType, entityId, req.user.id);
    if (!result) return res.status(404).json({ error: 'File not found' });
    return res.status(200).json({ data: result });
  } catch (err) { next(err); }
}

export async function downloadFile(req, res, next) {
  try {
    const result = await svc.downloadFile(req.params.id, req.user);
    if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Access denied' });
    if (!result)                return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Type',        result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.originalName)}"`);
    res.setHeader('X-Encryption-IV',     result.encryptionIv);
    res.setHeader('X-Checksum-SHA256',   result.checksumSha256);
    res.setHeader('X-Encrypted',         'true');

    return res.send(result.buffer);
  } catch (err) { next(err); }
}

export async function deleteFile(req, res, next) {
  try {
    const result = await svc.deleteFile(
      req.params.id, req.user.id, req.ip, req.headers['user-agent']
    );
    if (!result) return res.status(404).json({ error: 'File not found' });
    return res.status(200).json({ message: 'File deleted' });
  } catch (err) { next(err); }
}
