-- Migration 018: Add blood_glucose_mmol column to vitals table
-- Date: 2026-06-01
-- Description: Fixes silent data loss bug where blood glucose readings were not being stored

ALTER TABLE vitals ADD COLUMN IF NOT EXISTS blood_glucose_mmol NUMERIC(5,1) CHECK (blood_glucose_mmol > 0);

-- Add comment for documentation
COMMENT ON COLUMN vitals.blood_glucose_mmol IS 'Blood glucose level in mmol/L';
