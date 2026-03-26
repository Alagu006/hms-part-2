/**
 * Hardcoded drug interaction table for college project.
 * Each entry: pair of generic name substrings (lowercase) + severity + description.
 * In production this would be replaced by a clinical API (e.g. NLM RxNorm).
 */
const INTERACTIONS = [
  {
    drugs      : ['warfarin', 'aspirin'],
    severity   : 'HIGH',
    description: 'Increased bleeding risk. Concurrent use of warfarin and aspirin significantly raises haemorrhage risk.',
  },
  {
    drugs      : ['warfarin', 'ibuprofen'],
    severity   : 'HIGH',
    description: 'NSAIDs inhibit platelet function and may potentiate anticoagulant effect of warfarin.',
  },
  {
    drugs      : ['metformin', 'alcohol'],
    severity   : 'MODERATE',
    description: 'Alcohol increases risk of lactic acidosis with metformin.',
  },
  {
    drugs      : ['ssri', 'tramadol'],
    severity   : 'HIGH',
    description: 'Risk of serotonin syndrome. Avoid concurrent use.',
  },
  {
    drugs      : ['fluoxetine', 'tramadol'],
    severity   : 'HIGH',
    description: 'Serotonin syndrome risk. Fluoxetine inhibits CYP2D6, raising tramadol levels.',
  },
  {
    drugs      : ['ciprofloxacin', 'antacid'],
    severity   : 'MODERATE',
    description: 'Antacids reduce ciprofloxacin absorption. Separate administration by 2 hours.',
  },
  {
    drugs      : ['simvastatin', 'clarithromycin'],
    severity   : 'HIGH',
    description: 'Clarithromycin inhibits CYP3A4, causing dangerous elevation of simvastatin levels and myopathy risk.',
  },
  {
    drugs      : ['methotrexate', 'nsaid'],
    severity   : 'HIGH',
    description: 'NSAIDs reduce renal clearance of methotrexate, increasing toxicity risk.',
  },
  {
    drugs      : ['digoxin', 'amiodarone'],
    severity   : 'HIGH',
    description: 'Amiodarone inhibits P-glycoprotein, raising digoxin levels and risk of toxicity.',
  },
  {
    drugs      : ['lithium', 'ibuprofen'],
    severity   : 'MODERATE',
    description: 'NSAIDs reduce renal lithium clearance, increasing lithium toxicity risk.',
  },
  {
    drugs      : ['sildenafil', 'nitrate'],
    severity   : 'CONTRAINDICATED',
    description: 'Concurrent use causes severe hypotension. Absolutely contraindicated.',
  },
  {
    drugs      : ['clopidogrel', 'omeprazole'],
    severity   : 'MODERATE',
    description: 'Omeprazole inhibits CYP2C19, reducing clopidogrel antiplatelet effect.',
  },
];

/**
 * Check a list of medicine names for known interactions.
 *
 * @param {string[]} medicineNames  — generic/brand names (will be lowercased)
 * @returns {{ drug1: string, drug2: string, severity: string, description: string }[]}
 */
export function checkInteractions(medicineNames) {
  const lower   = medicineNames.map((n) => n.toLowerCase());
  const found   = [];

  for (const rule of INTERACTIONS) {
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
      });
    }
  }

  return found;
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
