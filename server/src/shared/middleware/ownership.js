import { query } from '../db/pool.js';

const PATIENT_ROLE = 'PATIENT';

const OWNERSHIP_QUERIES = {
  patient: `
    SELECT p.user_id
    FROM patients p
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `,

  prescription: `
    SELECT pr.patient_id
    FROM prescriptions pr
    WHERE pr.id = $1 AND pr.deleted_at IS NULL
  `,

  bill: `
    SELECT b.patient_id
    FROM bills b
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
};

export function checkOwnership(entityType) {
  const sql = OWNERSHIP_QUERIES[entityType];
  if (!sql) {
    throw new Error(`Unknown entity type for ownership check: "${entityType}"`);
  }

  return async (req, res, next) => {
    if (!req.user?.roles?.includes(PATIENT_ROLE)) {
      return next();
    }

    try {
      const { rows } = await query(sql, [req.params.id]);

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
