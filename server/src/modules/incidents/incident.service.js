import { pool }               from '../../shared/db/pool.js';
import { auditLog }           from '../../shared/middleware/audit.js';
import { createNotification } from '../../shared/services/notification.service.js';

// ---------------------------------------------------------------------------
// Report incident
// ---------------------------------------------------------------------------
export async function createIncident(
  { type, severity, description, patientId, witnessIds },
  reportedBy, io, ip
) {
  const { rows } = await pool.query(
    `INSERT INTO incidents
       (id, reported_by, patient_id, incident_type, severity, description,
        occurred_at, status, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), 'OPEN', NOW(), NOW())
     RETURNING *`,
    [reportedBy, patientId ?? null, type, severity, description]
  );
  const incident = rows[0];

  // Store witnesses
  if (witnessIds?.length) {
    const vals = witnessIds.map((wid, i) => `(gen_random_uuid(), $${i + 2}, $1)`).join(',');
    await pool.query(
      `INSERT INTO incident_witnesses (id, incident_id, user_id) VALUES ${vals}
       ON CONFLICT DO NOTHING`,
      [incident.id, ...witnessIds]
    ).catch(() => {}); // table may not exist yet — graceful fallback
  }

  await auditLog({ userId: reportedBy, action: 'CREATE', entity: 'incidents', entityId: incident.id, nextData: incident, ip });

  // Notify admins for high severity (>= 4)
  if (severity >= 4) {
    const { rows: admins } = await pool.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.revoked_at IS NULL
       WHERE ur.role IN ('ADMIN','SUPER_ADMIN') AND u.is_active = TRUE AND u.deleted_at IS NULL`
    );
    for (const admin of admins) {
      await createNotification(
        admin.id, 'EMERGENCY_ALERT',
        `High-Severity Incident Reported (${severity}/5)`,
        `Type: ${type}. ${description.slice(0, 120)}`,
        { entityType: 'incidents', entityId: incident.id },
        io
      ).catch(() => {});
    }
  }

  return incident;
}

// ---------------------------------------------------------------------------
// Get incidents (ADMIN, HR, SECURITY_OFC)
// ---------------------------------------------------------------------------
export async function getIncidents({ type, severity, status, page = 1, limit = 20 }) {
  const conditions = ['i.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (type)     { conditions.push(`i.incident_type = $${p++}`); params.push(type); }
  if (severity) { conditions.push(`i.severity = $${p++}`);      params.push(severity); }
  if (status)   { conditions.push(`i.status = $${p++}`);        params.push(status); }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT i.*,
            u.first_name AS reporter_first, u.last_name AS reporter_last,
            p.first_name AS patient_first,  p.last_name AS patient_last
     FROM incidents i
     JOIN users u ON u.id = i.reported_by
     LEFT JOIN patients p ON p.id = i.patient_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );
  return rows;
}
