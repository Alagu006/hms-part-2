-- =============================================================================
-- Migration 022: Prescription dispense columns + schema-drift reconciliation
--
-- Two related defects:
--   1. dispensePrescription() (prescription.service.js) stamps dispensed_at on
--      prescriptions AND prescription_items, but neither table has that column
--      (only pharmacy_orders does) — so dispensing ALWAYS failed with
--      "column does not exist".
--   2. createPrescription() inserts nurse_id / nurse_instructions into
--      prescriptions, but the schema.sql baseline never declared them (they
--      were added to the live DB out-of-band). Fresh environments therefore
--      could not create prescriptions at all. Reconcile the baseline.
-- =============================================================================

ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS nurse_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS nurse_instructions TEXT,
  ADD COLUMN IF NOT EXISTS dispensed_at TIMESTAMPTZ;

ALTER TABLE prescription_items
  ADD COLUMN IF NOT EXISTS dispensed_at TIMESTAMPTZ;
