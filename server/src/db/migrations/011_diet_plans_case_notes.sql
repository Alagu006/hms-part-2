-- =============================================================================
-- Migration 011: Diet Plans & Social Worker Case Notes
-- =============================================================================

-- Diet Plans
CREATE TABLE IF NOT EXISTS diet_plans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    plan_name    TEXT NOT NULL,
    calories     INT,
    protein      TEXT,
    carbs        TEXT,
    fats         TEXT,
    restrictions TEXT,
    notes        TEXT,
    start_date   DATE,
    end_date     DATE,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_diet_plans_patient ON diet_plans(patient_id);

-- Social Worker Case Notes
CREATE TABLE IF NOT EXISTS case_notes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note_type      TEXT NOT NULL DEFAULT 'ASSESSMENT'
                     CHECK (note_type IN ('ASSESSMENT','FOLLOW_UP','REFERRAL','DISCHARGE_PLAN','OTHER')),
    content        TEXT NOT NULL,
    follow_up_date DATE,
    resolved       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by     UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_case_notes_patient ON case_notes(patient_id);
