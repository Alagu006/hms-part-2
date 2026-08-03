-- =============================================================================
-- Migration 014: CDS Tables (Clinical Decision Support)
-- =============================================================================

-- CDS (Clinical Decision Support) Alerts
CREATE TABLE IF NOT EXISTS cds_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  triggered_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  type                VARCHAR(50)  NOT NULL DEFAULT 'GENERAL',
  severity            VARCHAR(10)  NOT NULL CHECK (severity IN ('high','medium','low')),
  message             TEXT         NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','acknowledged','dismissed')),
  acknowledged_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at     TIMESTAMPTZ,
  acknowledge_reason  TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Prevent exact duplicate active alerts per patient
  UNIQUE (patient_id, message, status)
);

CREATE INDEX IF NOT EXISTS idx_cds_alerts_patient   ON cds_alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_cds_alerts_status    ON cds_alerts(status);
CREATE INDEX IF NOT EXISTS idx_cds_alerts_severity  ON cds_alerts(severity);

-- Patient Allergies
CREATE TABLE IF NOT EXISTS patient_allergies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen        VARCHAR(200) NOT NULL,
  type            VARCHAR(20)  NOT NULL DEFAULT 'DRUG'
                    CHECK (type IN ('DRUG','FOOD','ENVIRONMENTAL','OTHER')),
  severity        VARCHAR(10)  NOT NULL DEFAULT 'MODERATE'
                    CHECK (severity IN ('MILD','MODERATE','SEVERE')),
  reaction        TEXT,
  notes           TEXT,
  recorded_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient ON patient_allergies(patient_id);
