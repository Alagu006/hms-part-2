import { pool } from '../../shared/db/pool.js';

export async function listDietPlans({ patientId, page = 1, limit = 50 }) {
  const conditions = ['dp.deleted_at IS NULL'];
  const params = [];
  let p = 1;

  if (patientId) { conditions.push(`dp.patient_id = $${p++}`); params.push(patientId); }

  const offset = (page - 1) * limit;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT dp.*,
            pt.first_name AS patient_first_name, pt.last_name AS patient_last_name, pt.mrn,
            u.first_name  AS dietitian_first_name, u.last_name AS dietitian_last_name
     FROM diet_plans dp
     JOIN patients pt ON pt.id = dp.patient_id
     LEFT JOIN users u ON u.id = dp.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY dp.created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    params
  );
  return rows;
}

export async function createDietPlan(data, userId) {
  const { patientId, planName, calories, protein, carbs, fats, restrictions, notes, startDate, endDate } = data;
  const { rows } = await pool.query(
    `INSERT INTO diet_plans
       (patient_id, plan_name, calories, protein, carbs, fats, restrictions, notes, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [patientId, planName, calories ?? null, protein ?? null, carbs ?? null,
     fats ?? null, restrictions ?? null, notes ?? null,
     startDate ?? null, endDate ?? null, userId]
  );
  return rows[0];
}

export async function updateDietPlan(id, data) {
  const fields = [];
  const params = [];
  let p = 1;

  const allowed = ['plan_name','calories','protein','carbs','fats','restrictions','notes','start_date','end_date','is_active'];
  const map = {
    planName: 'plan_name', calories: 'calories', protein: 'protein',
    carbs: 'carbs', fats: 'fats', restrictions: 'restrictions',
    notes: 'notes', startDate: 'start_date', endDate: 'end_date', isActive: 'is_active',
  };

  for (const [key, col] of Object.entries(map)) {
    if (data[key] !== undefined) {
      fields.push(`${col} = $${p++}`);
      params.push(data[key]);
    }
  }

  if (!fields.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE diet_plans SET ${fields.join(', ')} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!rows.length) throw Object.assign(new Error('Diet plan not found'), { status: 404 });
  return rows[0];
}
