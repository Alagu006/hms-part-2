/**
 * Drug interaction checker.
 *
 * Primary source: OpenFDA Drug Interaction API (RxNorm-based).
 * Fallback: local curated table of clinically critical interactions.
 *
 * The local table is intentionally kept as a safety net for the most
 * dangerous combinations. It is NOT a substitute for a full clinical
 * drug interaction database in a real production system.
 */

import { redis } from '../../shared/services/redis.service.js';
import { logger } from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Local fallback table — expanded from 12 to 30 critical interactions
// ---------------------------------------------------------------------------
const LOCAL_INTERACTIONS = [
  // ── Anticoagulants ────────────────────────────────────────────────────────
  { drugs: ['warfarin', 'aspirin'],        severity: 'HIGH',            description: 'Increased bleeding risk. Concurrent use significantly raises haemorrhage risk.' },
  { drugs: ['warfarin', 'ibuprofen'],      severity: 'HIGH',            description: 'NSAIDs inhibit platelet function and potentiate anticoagulant effect of warfarin.' },
  { drugs: ['warfarin', 'naproxen'],       severity: 'HIGH',            description: 'NSAIDs potentiate warfarin anticoagulation and increase GI bleeding risk.' },
  { drugs: ['warfarin', 'fluconazole'],    severity: 'HIGH',            description: 'Fluconazole inhibits CYP2C9, markedly increasing warfarin levels.' },
  { drugs: ['warfarin', 'metronidazole'],  severity: 'HIGH',            description: 'Metronidazole inhibits warfarin metabolism, increasing INR significantly.' },
  // ── Serotonin syndrome ────────────────────────────────────────────────────
  { drugs: ['ssri', 'tramadol'],           severity: 'HIGH',            description: 'Risk of serotonin syndrome. Avoid concurrent use.' },
  { drugs: ['fluoxetine', 'tramadol'],     severity: 'HIGH',            description: 'Serotonin syndrome risk. Fluoxetine inhibits CYP2D6, raising tramadol levels.' },
  { drugs: ['sertraline', 'tramadol'],     severity: 'HIGH',            description: 'Serotonin syndrome risk with concurrent SSRI and tramadol.' },
  { drugs: ['linezolid', 'ssri'],          severity: 'CONTRAINDICATED', description: 'Linezolid is a MAO inhibitor. Concurrent SSRI use causes serotonin syndrome.' },
  { drugs: ['linezolid', 'venlafaxine'],   severity: 'CONTRAINDICATED', description: 'Serotonin syndrome risk — linezolid (MAO inhibitor) + SNRI.' },
  // ── Statins ───────────────────────────────────────────────────────────────
  { drugs: ['simvastatin', 'clarithromycin'], severity: 'HIGH',         description: 'Clarithromycin inhibits CYP3A4, causing dangerous elevation of simvastatin and myopathy risk.' },
  { drugs: ['simvastatin', 'amiodarone'],  severity: 'HIGH',            description: 'Amiodarone inhibits CYP3A4, increasing simvastatin levels and myopathy risk.' },
  { drugs: ['atorvastatin', 'clarithromycin'], severity: 'HIGH',        description: 'CYP3A4 inhibition raises atorvastatin levels, increasing myopathy risk.' },
  // ── Cardiac ───────────────────────────────────────────────────────────────
  { drugs: ['digoxin', 'amiodarone'],      severity: 'HIGH',            description: 'Amiodarone inhibits P-glycoprotein, raising digoxin levels and toxicity risk.' },
  { drugs: ['digoxin', 'clarithromycin'],  severity: 'HIGH',            description: 'Clarithromycin inhibits P-gp, increasing digoxin levels.' },
  { drugs: ['sildenafil', 'nitrate'],      severity: 'CONTRAINDICATED', description: 'Concurrent use causes severe hypotension. Absolutely contraindicated.' },
  { drugs: ['tadalafil', 'nitrate'],       severity: 'CONTRAINDICATED', description: 'PDE5 inhibitor + nitrate causes severe hypotension. Contraindicated.' },
  // ── Antibiotics ───────────────────────────────────────────────────────────
  { drugs: ['ciprofloxacin', 'antacid'],   severity: 'MODERATE',        description: 'Antacids reduce ciprofloxacin absorption. Separate administration by 2 hours.' },
  { drugs: ['metronidazole', 'alcohol'],   severity: 'HIGH',            description: 'Disulfiram-like reaction: flushing, nausea, vomiting. Avoid alcohol during and 48h after.' },
  // ── Immunosuppressants / Oncology ─────────────────────────────────────────
  { drugs: ['methotrexate', 'nsaid'],      severity: 'HIGH',            description: 'NSAIDs reduce renal clearance of methotrexate, increasing toxicity risk.' },
  { drugs: ['methotrexate', 'trimethoprim'], severity: 'HIGH',          description: 'Additive folate antagonism increases methotrexate toxicity.' },
  { drugs: ['cyclosporine', 'nsaid'],      severity: 'HIGH',            description: 'NSAIDs increase nephrotoxicity risk with cyclosporine.' },
  // ── Diabetes ─────────────────────────────────────────────────────────────
  { drugs: ['metformin', 'alcohol'],       severity: 'MODERATE',        description: 'Alcohol increases risk of lactic acidosis with metformin.' },
  { drugs: ['metformin', 'contrast'],      severity: 'HIGH',            description: 'Iodinated contrast media can cause acute kidney injury, increasing metformin-associated lactic acidosis risk.' },
  // ── Psychiatric ───────────────────────────────────────────────────────────
  { drugs: ['lithium', 'ibuprofen'],       severity: 'MODERATE',        description: 'NSAIDs reduce renal lithium clearance, increasing lithium toxicity risk.' },
  { drugs: ['lithium', 'diuretic'],        severity: 'HIGH',            description: 'Diuretics reduce renal lithium clearance, increasing toxicity risk.' },
  { drugs: ['clozapine', 'ciprofloxacin'], severity: 'HIGH',            description: 'Ciprofloxacin inhibits CYP1A2, markedly increasing clozapine levels.' },
  // ── GI ───────────────────────────────────────────────────────────────────
  { drugs: ['clopidogrel', 'omeprazole'],  severity: 'MODERATE',        description: 'Omeprazole inhibits CYP2C19, reducing clopidogrel antiplatelet effect.' },
  // ── Antiretrovirals ───────────────────────────────────────────────────────
  { drugs: ['ritonavir', 'simvastatin'],   severity: 'CONTRAINDICATED', description: 'Ritonavir markedly increases simvastatin levels, causing rhabdomyolysis risk.' },
  { drugs: ['ritonavir', 'sildenafil'],    severity: 'CONTRAINDICATED', description: 'Ritonavir dramatically increases sildenafil exposure, causing severe hypotension.' },
];

// ---------------------------------------------------------------------------
// OpenFDA RxNorm interaction API
// ---------------------------------------------------------------------------
const OPENFDA_INTERACTION_CACHE_TTL = 60 * 60 * 6; // 6 hours

/**
 * Query OpenFDA for drug interactions between a list of drug names.
 * Returns an array of interaction objects or empty array on failure.
 *
 * @param {string[]} drugNames
 * @returns {Promise<Array>}
 */
async function fetchOpenFdaInteractions(drugNames) {
  if (!drugNames.length) return [];

  const cacheKey = `drug:interactions:${drugNames.map(n => n.toLowerCase()).sort().join(',')}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* Redis unavailable — continue */ }

  const results = [];

  try {
    // Query each drug pair against the OpenFDA drug label endpoint
    // The drug_interactions field contains free-text interaction warnings
    for (const name of drugNames) {
      const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(name)}"&limit=1`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) continue;

        const data = await res.json();
        const label = data.results?.[0];
        if (!label?.drug_interactions) continue;

        const interactionText = Array.isArray(label.drug_interactions)
          ? label.drug_interactions.join(' ')
          : label.drug_interactions;

        // Check if any of the other drugs are mentioned in the interaction text
        for (const otherName of drugNames) {
          if (otherName.toLowerCase() === name.toLowerCase()) continue;
          if (interactionText.toLowerCase().includes(otherName.toLowerCase())) {
            results.push({
              drug1      : name,
              drug2      : otherName,
              severity   : 'MODERATE', // OpenFDA doesn't provide severity — default to MODERATE
              description: `FDA label for ${name} mentions interaction with ${otherName}. Review full prescribing information.`,
              source     : 'openfda',
            });
          }
        }
      } catch (fetchErr) {
        clearTimeout(timer);
        if (fetchErr.name !== 'AbortError') {
          logger.warn('[interactions] OpenFDA fetch error', { drug: name, message: fetchErr.message });
        }
      }
    }

    // Cache the result
    try {
      await redis.setex(cacheKey, OPENFDA_INTERACTION_CACHE_TTL, JSON.stringify(results));
    } catch { /* Redis unavailable */ }
  } catch (err) {
    logger.error('[interactions] OpenFDA interaction check failed', { message: err.message });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Local interaction check (synchronous, always runs)
// ---------------------------------------------------------------------------
function checkLocalInteractions(medicineNames) {
  const lower = medicineNames.map((n) => n.toLowerCase());
  const found = [];

  for (const rule of LOCAL_INTERACTIONS) {
    const [a, b] = rule.drugs;
    const matchA = lower.some((n) => n.includes(a));
    const matchB = lower.some((n) => n.includes(b));

    if (matchA && matchB) {
      const nameA = lower.find((n) => n.includes(a)) ?? a;
      const nameB = lower.find((n) => n.includes(b)) ?? b;
      found.push({
        drug1      : nameA,
        drug2      : nameB,
        severity   : rule.severity,
        description: rule.description,
        source     : 'local',
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a list of medicine names for known interactions.
 * Combines local table (synchronous, always runs) with OpenFDA API (async, best-effort).
 *
 * @param {string[]} medicineNames
 * @returns {Promise<{ drug1, drug2, severity, description, source }[]>}
 */
export async function checkInteractions(medicineNames) {
  if (!medicineNames?.length) return [];

  // Always run local check first — it's synchronous and catches the most critical cases
  const localResults = checkLocalInteractions(medicineNames);

  // Attempt OpenFDA enrichment (non-blocking — failures don't block prescription)
  let openFdaResults = [];
  try {
    openFdaResults = await fetchOpenFdaInteractions(medicineNames);
  } catch (err) {
    logger.warn('[interactions] OpenFDA check skipped', { message: err.message });
  }

  // Merge: deduplicate by drug pair (local takes precedence for same pair)
  const seen = new Set(localResults.map(r => `${r.drug1}|${r.drug2}`));
  const merged = [...localResults];

  for (const r of openFdaResults) {
    const key = `${r.drug1}|${r.drug2}`;
    const reverseKey = `${r.drug2}|${r.drug1}`;
    if (!seen.has(key) && !seen.has(reverseKey)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return merged;
}

/**
 * Check patient allergy list against prescribed medicine names.
 *
 * @param {string[]} allergies      — patient allergy strings
 * @param {string[]} medicineNames
 * @returns {{ medicine: string, allergen: string }[]}
 */
export function checkAllergies(allergies, medicineNames) {
  if (!allergies?.length) return [];
  const lower = medicineNames.map((n) => n.toLowerCase());
  const found = [];

  for (const allergen of allergies) {
    const al = allergen.toLowerCase();
    for (const name of lower) {
      if (name.includes(al) || al.includes(name)) {
        found.push({ medicine: name, allergen });
      }
    }
  }

  return found;
}
