/**
 * Clinical Decision Support (CDS) Service
 *
 * Analyses patient data in real-time and surfaces actionable alerts:
 *  - Drug interaction warnings
 *  - Allergy cross-checks
 *  - Abnormal vitals pattern detection (sepsis, deterioration)
 *  - Duplicate lab order prevention
 *  - Overdue guideline reminders (HbA1c, BP checks, etc.)
 */

import { pool, query } from '../../shared/db/pool.js';
import { v4 as uuidv4 } from 'uuid';

// ── Known drug interaction pairs (simplified reference table) ─────────────────
// In production this would be a full drug-interaction database (e.g. DrugBank API)
const DRUG_INTERACTIONS = [
  { drugs: ['warfarin', 'aspirin'],       severity: 'high',   message: 'Warfarin + Aspirin: increased bleeding risk.' },
  { drugs: ['warfarin', 'ibuprofen'],     severity: 'high',   message: 'Warfarin + Ibuprofen: increased bleeding risk.' },
  { drugs: ['metformin', 'contrast'],     severity: 'high',   message: 'Metformin should be held before contrast procedures.' },
  { drugs: ['ssri', 'tramadol'],          severity: 'high',   message: 'SSRI + Tramadol: serotonin syndrome risk.' },
  { drugs: ['ace inhibitor', 'potassium'],severity: 'medium', message: 'ACE inhibitor + Potassium supplement: hyperkalemia risk.' },
  { drugs: ['digoxin', 'amiodarone'],     severity: 'high',   message: 'Digoxin + Amiodarone: digoxin toxicity risk.' },
  { drugs: ['statin', 'clarithromycin'],  severity: 'medium', message: 'Statin + Clarithromycin: myopathy risk.' },
  { drugs: ['lithium', 'nsaid'],          severity: 'high',   message: 'Lithium + NSAID: lithium toxicity risk.' },
  { drugs: ['methotrexate', 'nsaid'],     severity: 'high',   message: 'Methotrexate + NSAID: methotrexate toxicity risk.' },
  { drugs: ['clopidogrel', 'omeprazole'], severity: 'medium', message: 'Clopidogrel + Omeprazole: reduced antiplatelet effect.' },
];

// ── Sepsis screening criteria (SIRS-based) ────────────────────────────────────
function checkSepsisRisk(vitals) {
  if (!vitals || vitals.length < 2) return null;
  const latest = vitals[0];
  const { temperature, heart_rate, respiratory_rate, systolic_bp, wbc_count } = latest;

  let sirsCriteria = 0;
  if (temperature && (temperature > 38.3 || temperature < 36)) sirsCriteria++;
  if (heart_rate && heart_rate > 90) sirsCriteria++;
  if (respiratory_rate && respiratory_rate > 20) sirsCriteria++;
  if (wbc_count && (wbc_count > 12000 || wbc_count < 4000)) sirsCriteria++;

  // Check for deteriorating trend
  const prev = vitals[1];
  const deteriorating =
    prev &&
    systolic_bp &&
    prev.systolic_bp &&
    systolic_bp < prev.systolic_bp - 20;

  if (sirsCriteria >= 2) {
    return {
      severity: sirsCriteria >= 3 || deteriorating ? 'high' : 'medium',
      message : `Sepsis screening: ${sirsCriteria} SIRS criteria met.${deteriorating ? ' BP trending down.' : ''} Consider sepsis workup.`,
    };
  }
  return null;
}

// ── Duplicate lab order check ─────────────────────────────────────────────────
function checkDuplicateOrders(labOrders) {
  const alerts = [];
  const recent = labOrders.filter(o => {
    const hoursAgo = (Date.now() - new Date(o.ordered_at).getTime()) / 3600000;
    return hoursAgo < 24;
  });

  const seen = {};
  for (const order of recent) {
    const key = order.test_name?.toLowerCase();
    if (!key) continue;
    if (seen[key]) {
      alerts.push({
        severity: 'medium',
        message : `Duplicate order: "${order.test_name}" was already ordered in the last 24 hours.`,
      });
    }
    seen[key] = true;
  }
  return alerts;
}

// ── Allergy cross-check ───────────────────────────────────────────────────────
function checkAllergyConflicts(allergies, activeMeds) {
  const alerts = [];
  if (!allergies?.length || !activeMeds?.length) return alerts;

  for (const allergy of allergies) {
    const allergen = allergy.allergen?.toLowerCase() ?? '';
    for (const med of activeMeds) {
      const medName = med.medication_name?.toLowerCase() ?? '';
      if (allergen && medName && medName.includes(allergen)) {
        alerts.push({
          severity: 'high',
          message : `Allergy alert: Patient is allergic to "${allergy.allergen}" — conflicts with prescribed "${med.medication_name}".`,
        });
      }
    }
  }
  return alerts;
}

// ── Drug interaction check ────────────────────────────────────────────────────
function checkDrugInteractions(activeMeds) {
  const alerts = [];
  if (!activeMeds?.length) return alerts;

  const medNames = activeMeds.map(m => m.medication_name?.toLowerCase() ?? '');

  for (const interaction of DRUG_INTERACTIONS) {
    const [drugA, drugB] = interaction.drugs;
    const hasA = medNames.some(n => n.includes(drugA));
    const hasB = medNames.some(n => n.includes(drugB));
    if (hasA && hasB) {
      alerts.push({
        severity: interaction.severity,
        message : interaction.message,
      });
    }
  }
  return alerts;
}

// ── Guideline reminders ───────────────────────────────────────────────────────
function checkGuidelineReminders(patient, labOrders) {
  const alerts = [];
  const conditions = (patient.conditions ?? '').toLowerCase();

  // HbA1c for diabetics — every 90 days
  if (conditions.includes('diabetes') || conditions.includes('diabetic')) {
    const lastHba1c = labOrders.find(o => o.test_name?.toLowerCase().includes('hba1c'));
    if (!lastHba1c) {
      alerts.push({
        severity: 'low',
        message : 'Guideline reminder: Diabetic patient — no HbA1c on record. Consider ordering.',
      });
    } else {
      const daysSince = (Date.now() - new Date(lastHba1c.ordered_at).getTime()) / 86400000;
      if (daysSince > 90) {
        alerts.push({
          severity: 'low',
          message : `Guideline reminder: Last HbA1c was ${Math.round(daysSince)} days ago. Consider re-ordering (recommended every 90 days).`,
        });
      }
    }
  }

  // BP check for hypertensives
  if (conditions.includes('hypertension') || conditions.includes('hypertensive')) {
    const lastBp = labOrders.find(o => o.test_name?.toLowerCase().includes('blood pressure'));
    if (!lastBp) {
      alerts.push({
        severity: 'low',
        message : 'Guideline reminder: Hypertensive patient — no recent BP monitoring order found.',
      });
    }
  }

  return alerts;
}

// ── Persist alerts to DB ──────────────────────────────────────────────────────
async function persistAlerts(patientId, doctorId, rawAlerts) {
  if (!rawAlerts.length) return [];

  const client = await pool.connect();
  try {
    const results = [];
    for (const alert of rawAlerts) {
      const id = uuidv4();
      await client.query(
        `INSERT INTO cds_alerts
           (id, patient_id, triggered_by, severity, message, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW())
         ON CONFLICT DO NOTHING`,
        [id, patientId, doctorId, alert.severity, alert.message]
      );
      results.push({ id, ...alert, status: 'active', created_at: new Date().toISOString() });
    }
    return results;
  } finally {
    client.release();
  }
}

// ── Main: getInsights ─────────────────────────────────────────────────────────
export async function getInsights(patientId, doctorId) {
  const client = await pool.connect();
  try {
    // Fetch all relevant patient data in parallel
    const [
      patientRes,
      vitalsRes,
      medsRes,
      allergiesRes,
      labOrdersRes,
      existingAlertsRes,
    ] = await Promise.all([
      client.query(
        `SELECT p.*, STRING_AGG(DISTINCT d.name, ', ') AS conditions
         FROM patients p
         LEFT JOIN patient_diagnoses pd ON pd.patient_id = p.id
         LEFT JOIN diagnoses d ON d.id = pd.diagnosis_id
         WHERE p.id = $1
         GROUP BY p.id`,
        [patientId]
      ),
      client.query(
        `SELECT * FROM vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 5`,
        [patientId]
      ),
      client.query(
        `SELECT * FROM prescription_items pi
         JOIN prescriptions pr ON pr.id = pi.prescription_id
         WHERE pr.patient_id = $1 AND pr.status = 'active'
         ORDER BY pr.created_at DESC`,
        [patientId]
      ),
      client.query(
        `SELECT * FROM patient_allergies WHERE patient_id = $1`,
        [patientId]
      ),
      client.query(
        `SELECT * FROM lab_orders WHERE patient_id = $1 ORDER BY ordered_at DESC LIMIT 20`,
        [patientId]
      ),
      client.query(
        `SELECT * FROM cds_alerts
         WHERE patient_id = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [patientId]
      ),
    ]);

    const patient   = patientRes.rows[0];
    const vitals    = vitalsRes.rows;
    const activeMeds = medsRes.rows;
    const allergies  = allergiesRes.rows;
    const labOrders  = labOrdersRes.rows;

    if (!patient) {
      const err = new Error('Patient not found'); err.status = 404; throw err;
    }

    // Run all checks
    const rawAlerts = [];

    const sepsisAlert = checkSepsisRisk(vitals);
    if (sepsisAlert) rawAlerts.push({ type: 'SEPSIS_RISK', ...sepsisAlert });

    const allergyAlerts = checkAllergyConflicts(allergies, activeMeds);
    allergyAlerts.forEach(a => rawAlerts.push({ type: 'ALLERGY_CONFLICT', ...a }));

    const interactionAlerts = checkDrugInteractions(activeMeds);
    interactionAlerts.forEach(a => rawAlerts.push({ type: 'DRUG_INTERACTION', ...a }));

    const duplicateAlerts = checkDuplicateOrders(labOrders);
    duplicateAlerts.forEach(a => rawAlerts.push({ type: 'DUPLICATE_ORDER', ...a }));

    const guidelineAlerts = checkGuidelineReminders(patient, labOrders);
    guidelineAlerts.forEach(a => rawAlerts.push({ type: 'GUIDELINE_REMINDER', ...a }));

    // Deduplicate against existing active alerts (by message)
    const existingMessages = new Set(existingAlertsRes.rows.map(r => r.message));
    const newAlerts = rawAlerts.filter(a => !existingMessages.has(a.message));

    // Persist new alerts
    const persisted = await persistAlerts(patientId, doctorId, newAlerts);

    // Return all active alerts (existing + new)
    const allAlerts = [
      ...persisted,
      ...existingAlertsRes.rows.map(r => ({
        id       : r.id,
        type     : r.type ?? 'GENERAL',
        severity : r.severity,
        message  : r.message,
        status   : r.status,
        created_at: r.created_at,
      })),
    ];

    // Sort: high → medium → low
    const order = { high: 0, medium: 1, low: 2 };
    allAlerts.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

    return {
      patientId,
      alerts: allAlerts,
      summary: {
        total : allAlerts.length,
        high  : allAlerts.filter(a => a.severity === 'high').length,
        medium: allAlerts.filter(a => a.severity === 'medium').length,
        low   : allAlerts.filter(a => a.severity === 'low').length,
      },
    };
  } finally {
    client.release();
  }
}

// ── Acknowledge alert ─────────────────────────────────────────────────────────
export async function acknowledgeAlert(alertId, userId, reason) {
  await pool.query(
    `UPDATE cds_alerts
     SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), acknowledge_reason = $3
     WHERE id = $1`,
    [alertId, userId, reason ?? null]
  );
}

// ── Dismiss alert ─────────────────────────────────────────────────────────────
export async function dismissAlert(alertId, userId, reason) {
  await pool.query(
    `UPDATE cds_alerts
     SET status = 'dismissed', acknowledged_by = $2, acknowledged_at = NOW(), acknowledge_reason = $3
     WHERE id = $1`,
    [alertId, userId, reason ?? null]
  );
}
