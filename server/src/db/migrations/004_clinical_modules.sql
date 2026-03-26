-- =============================================================================
-- Migration 004: Clinical Modules — Blood Bank, Incident Witnesses
-- =============================================================================

-- Blood bank simplified table (as per spec)
CREATE TABLE IF NOT EXISTS blood_bank (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blood_group TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    units       INT  NOT NULL CHECK (units >= 0),
    donor_name  TEXT,
    expiry_date DATE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'AVAILABLE'
                CHECK (status IN ('AVAILABLE','RESERVED','USED','EXPIRED')),
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_blood_bank_group_status ON blood_bank(blood_group, status);
CREATE INDEX IF NOT EXISTS idx_blood_bank_expiry       ON blood_bank(expiry_date);

-- Incident witnesses junction table
CREATE TABLE IF NOT EXISTS incident_witnesses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    UNIQUE (incident_id, user_id)
);

-- Extend notifications type CHECK to include new types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'APPOINTMENT','LAB_RESULT','PRESCRIPTION','MESSAGE','SYSTEM','ALERT','SHIFT','LEAVE',
        'OT_SCHEDULED','BLOOD_REQUEST','EMERGENCY_ALERT','DISCHARGE_SUMMARY','INCIDENT'
    ));

-- Extend incidents severity to numeric (1-5) if not already
-- (existing schema uses TEXT enum — add numeric column)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity INT
    CHECK (severity BETWEEN 1 AND 5);

-- Extend incidents incident_type to include new types
-- PostgreSQL doesn't support ALTER TYPE ADD VALUE in a transaction easily,
-- so we use a check constraint approach via a new column or alter the check.
-- We'll add the new types by recreating the check constraint:
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_incident_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_incident_type_check
    CHECK (incident_type IN (
        'FALL','MEDICATION_ERROR','EQUIPMENT_FAILURE','SECURITY','FIRE',
        'INFECTION','OTHER','NEAR_MISS','ADVERSE_EVENT','SECURITY_BREACH'
    ));
