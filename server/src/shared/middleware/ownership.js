import { query } from '../db/pool.js';

const PATIENT_ROLE = 'PATIENT';

// Administrative roles oversee every patient — never scoped to a care team.
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// Resolve the owning patient for a resource. Every query returns the patient id
// (patient_id) plus the portal user id (user_id) for the PATIENT-ownership check.
const OWNERSHIP_QUERIES = {
  patient: `
    SELECT p.id AS patient_id, p.user_id
    FROM patients p
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `,

  prescription: `
    SELECT p.id AS patient_id, p.user_id
    FROM prescriptions pr
    JOIN patients p ON p.id = pr.patient_id
    WHERE pr.id = $1 AND pr.deleted_at IS NULL
  `,

  bill: `
    SELECT p.id AS patient_id, p.user_id
    FROM bills b
    JOIN patients p ON p.id = b.patient_id
    WHERE b.id = $1 AND b.deleted_at IS NULL
  `,

  medical_record: `
    SELECT p.id AS patient_id, p.user_id
    FROM medical_records mr
    JOIN patients p ON p.id = mr.patient_id
    WHERE mr.id = $1 AND mr.deleted_at IS NULL
  `,

  lab_result: `
    SELECT p.id AS patient_id, p.user_id
    FROM lab_results lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    JOIN patients p ON p.id = lo.patient_id
    WHERE lr.id = $1 AND lr.deleted_at IS NULL
  `,

  appointment: `
    SELECT p.id AS patient_id, p.user_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.id = $1 AND a.deleted_at IS NULL
  `,
};

// Care team is DERIVED from the patient's treating relationships — no new table.
// A staff clinician belongs to a patient's care team if they are/were any of:
//   - the attending doctor on a (non-deleted) medical record
//   - the doctor on a (non-deleted) appointment
//   - the ordering clinician or assigned tech on a (non-deleted) lab order
//   - the performing or verifying clinician on a lab result
const CARE_TEAM_QUERY = `
  SELECT 1
  FROM (
    SELECT mr.attending_doctor_id AS clinician_id
      FROM medical_records mr
     WHERE mr.patient_id = $1 AND mr.deleted_at IS NULL
    UNION
    SELECT a.doctor_id AS clinician_id
      FROM appointments a
     WHERE a.patient_id = $1 AND a.deleted_at IS NULL
    UNION
    SELECT lo.ordered_by AS clinician_id
      FROM lab_orders lo
     WHERE lo.patient_id = $1 AND lo.deleted_at IS NULL
    UNION
    SELECT lo.assigned_to AS clinician_id
      FROM lab_orders lo
     WHERE lo.patient_id = $1 AND lo.deleted_at IS NULL AND lo.assigned_to IS NOT NULL
    UNION
    SELECT lr.performed_by AS clinician_id
      FROM lab_results lr
     WHERE lr.patient_id = $1
    UNION
    SELECT lr.verified_by AS clinician_id
      FROM lab_results lr
     WHERE lr.patient_id = $1 AND lr.verified_by IS NOT NULL
  ) care_team
  WHERE care_team.clinician_id = $2
  LIMIT 1
`;

// Shared care-team check — true when the staff member is/was one of the
// patient's treating clinicians (or an admin, handled by callers). Used both
// by the ownership middleware and by service-level gates (e.g. file downloads).
export async function isCareTeamMember(patientId, userId) {
  const { rows } = await query(CARE_TEAM_QUERY, [patientId, userId]);
  return rows.length > 0;
}

export function checkOwnership(entityType, paramName = 'id') {
  const sql = OWNERSHIP_QUERIES[entityType];
  if (!sql) {
    throw new Error(`Unknown entity type for ownership check: "${entityType}"`);
  }

  return async (req, res, next) => {
    const roles = req.user?.roles ?? [];

    // Administrators oversee every patient — not scoped to a care team.
    if (roles.some((r) => ADMIN_ROLES.includes(r))) {
      return next();
    }

    try {
      const { rows } = await query(sql, [req.params[paramName]]);

      if (!rows[0]) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      const { patient_id, user_id } = rows[0];

      // PATIENT can only ever touch their own record.
      if (roles.includes(PATIENT_ROLE)) {
        if (user_id !== req.user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }
        return next();
      }

      // Any other staff role must belong to the patient's care team.
      if (!(await isCareTeamMember(patient_id, req.user.id))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
