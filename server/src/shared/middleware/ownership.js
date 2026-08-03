import { query } from '../db/pool.js';

const PATIENT_ROLE = 'PATIENT';

const OWNERSHIP_QUERIES = {
  patient: `
    SELECT p.user_id
    FROM patients p
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `,

  prescription: `
    SELECT p.user_id
    FROM prescriptions pr
    JOIN patients p ON p.id = pr.patient_id
    WHERE pr.id = $1 AND pr.deleted_at IS NULL
  `,

  bill: `
    SELECT p.user_id
    FROM bills b
    JOIN patients p ON p.id = b.patient_id
    WHERE b.id = $1 AND b.deleted_at IS NULL
  `,

  medical_record: `
    SELECT p.user_id
    FROM medical_records mr
    JOIN patients p ON p.id = mr.patient_id
    WHERE mr.id = $1 AND mr.deleted_at IS NULL
  `,

  lab_result: `
    SELECT p.user_id
    FROM lab_results lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    JOIN patients p ON p.id = lo.patient_id
    WHERE lr.id = $1 AND lr.deleted_at IS NULL
  `,

  appointment: `
    SELECT p.user_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.id = $1 AND a.deleted_at IS NULL
  `,
};

export function checkOwnership(entityType, paramName = 'id') {
  const sql = OWNERSHIP_QUERIES[entityType];
  if (!sql) {
    throw new Error(`Unknown entity type for ownership check: "${entityType}"`);
  }

  return async (req, res, next) => {
    if (!req.user?.roles?.includes(PATIENT_ROLE)) {
      return next();
    }

    try {
      const { rows } = await query(sql, [req.params[paramName]]);

      if (!rows[0]) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
