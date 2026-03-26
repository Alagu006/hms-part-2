import { query } from '../../shared/db/pool.js';

export async function getMyAssignmentsToday(nurseId, date) {
  const targetDate = date ?? new Date().toISOString().split('T')[0];

  const { rows } = await query(
    `SELECT
       pna.id AS assignment_id,
       pna.shift_type,
       p.id         AS patient_id,
       p.mrn,
       p.first_name,
       p.last_name,
       b.bed_number,
       r.room_number,
       r.room_type,
       d.name       AS department_name,
       lv.id        AS last_vitals_id,
       lv.recorded_at AS last_vitals_at,
       EXTRACT(EPOCH FROM (NOW() - lv.recorded_at)) / 3600 AS hours_since_vitals
     FROM patient_nurse_assignments pna
     JOIN patients p ON p.id = pna.patient_id
     LEFT JOIN beds b ON b.id = p.current_bed_id
     LEFT JOIN rooms r ON r.id = b.room_id
     LEFT JOIN departments d ON d.id = r.department_id
     LEFT JOIN LATERAL (
       SELECT id, recorded_at
       FROM vitals
       WHERE patient_id = p.id
       ORDER BY recorded_at DESC
       LIMIT 1
     ) lv ON TRUE
     WHERE pna.nurse_id = $1
       AND pna.shift_date = $2
       AND p.deleted_at IS NULL
     ORDER BY r.room_number, b.bed_number`,
    [nurseId, targetDate]
  );

  return rows.map((r) => ({
    assignmentId  : r.assignment_id,
    shiftType    : r.shift_type,
    patientId    : r.patient_id,
    mrn          : r.mrn,
    firstName    : r.first_name,
    lastName     : r.last_name,
    bedNumber    : r.bed_number,
    roomNumber   : r.room_number,
    roomType    : r.room_type,
    departmentName: r.department_name,
    lastVitalsAt: r.last_vitals_at,
    hoursSinceVitals: r.hours_since_vitals ? parseFloat(r.hours_since_vitals.toFixed(2)) : null,
    isOverdue   : r.hours_since_vitals !== null && r.hours_since_vitals > 4,
  }));
}
