-- Patient to nurse shift assignments
CREATE TABLE patient_nurse_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    nurse_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_type  TEXT NOT NULL CHECK (shift_type IN ('MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, nurse_id, shift_date)
);

CREATE INDEX idx_assignments_nurse_date ON patient_nurse_assignments(nurse_id, shift_date);
CREATE INDEX idx_assignments_patient   ON patient_nurse_assignments(patient_id);
