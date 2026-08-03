-- Migration 017: Add diagnoses tables and vitals columns for CDS
-- Date: 2026-05-20

-- Add missing columns to vitals table for CDS sepsis screening
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS temperature NUMERIC(4,1);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS heart_rate INT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS systolic_bp INT;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS wbc_count INT;

-- Create diagnoses reference table
CREATE TABLE IF NOT EXISTS diagnoses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,  -- ICD-10 code
    name            TEXT NOT NULL,
    category        TEXT,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create patient_diagnoses junction table
CREATE TABLE IF NOT EXISTS patient_diagnoses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    diagnosis_id    UUID NOT NULL REFERENCES diagnoses(id) ON DELETE CASCADE,
    diagnosed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    diagnosed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','chronic')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, diagnosis_id, status)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_patient_diagnoses_patient ON patient_diagnoses(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_diagnoses_diagnosis ON patient_diagnoses(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_patient_diagnoses_status ON patient_diagnoses(status);

-- Insert some common diagnoses for testing
INSERT INTO diagnoses (code, name, category, description) VALUES
    ('E11', 'Type 2 Diabetes Mellitus', 'Endocrine', 'Non-insulin-dependent diabetes mellitus'),
    ('I10', 'Essential Hypertension', 'Cardiovascular', 'High blood pressure'),
    ('J45', 'Asthma', 'Respiratory', 'Chronic inflammatory airway disease'),
    ('E78.5', 'Hyperlipidemia', 'Endocrine', 'Elevated blood lipids'),
    ('M79.3', 'Chronic Pain', 'Musculoskeletal', 'Persistent pain condition')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE diagnoses IS 'Reference table for ICD-10 diagnosis codes';
COMMENT ON TABLE patient_diagnoses IS 'Junction table linking patients to their diagnoses';
COMMENT ON COLUMN vitals.temperature IS 'Body temperature in Celsius (alternative to temperature_c)';
COMMENT ON COLUMN vitals.heart_rate IS 'Heart rate in beats per minute (alternative to pulse_bpm)';
COMMENT ON COLUMN vitals.systolic_bp IS 'Systolic blood pressure (alternative to bp_systolic)';
COMMENT ON COLUMN vitals.wbc_count IS 'White blood cell count for sepsis screening';
