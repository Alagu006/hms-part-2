CREATE TABLE handover_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_nurse_id UUID NOT NULL REFERENCES users(id),
    to_nurse_id   UUID REFERENCES users(id),
    to_shift_type TEXT CHECK (to_shift_type IN ('MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT')),
    patient_id  UUID NOT NULL REFERENCES patients(id),
    priority    TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
    note        TEXT NOT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_handover_to_nurse   ON handover_notes(to_nurse_id, is_read);
CREATE INDEX idx_handover_to_shift   ON handover_notes(to_shift_type, is_read);
CREATE INDEX idx_handover_patient     ON handover_notes(patient_id);
