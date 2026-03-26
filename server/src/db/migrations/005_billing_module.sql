-- =============================================================================
-- Migration 005: Billing module enhancements
-- Adds insurance claim columns to bills, discount approval tracking,
-- and reference tracking on bill_items
-- =============================================================================

-- Add insurance claim fields to bills
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS insurance_policy_id    UUID REFERENCES insurance_policies(id),
  ADD COLUMN IF NOT EXISTS insurance_claim_ref    TEXT,
  ADD COLUMN IF NOT EXISTS insurance_claim_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS insurance_notes        TEXT,
  ADD COLUMN IF NOT EXISTS discount_approved      BOOLEAN,
  ADD COLUMN IF NOT EXISTS discount_approved_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS discount_note          TEXT;

-- Add reference tracking to bill_items for auto-population
ALTER TABLE bill_items
  ADD COLUMN IF NOT EXISTS reference_type TEXT CHECK (reference_type IN ('APPOINTMENT','LAB_ORDER','PRESCRIPTION_ITEM','ROOM','MANUAL')),
  ADD COLUMN IF NOT EXISTS reference_id   UUID;

-- Fix status check to match spec (PENDING | PARTIAL | PAID | REFUNDED)
-- The existing schema uses DRAFT/ISSUED/PARTIALLY_PAID/PAID/CANCELLED/REFUNDED
-- We keep existing and add PARTIAL as alias via a view
CREATE OR REPLACE VIEW bill_status_view AS
  SELECT *,
    CASE status
      WHEN 'ISSUED'        THEN 'PENDING'
      WHEN 'PARTIALLY_PAID' THEN 'PARTIAL'
      ELSE status
    END AS display_status
  FROM bills;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bills_patient_id        ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_status            ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_insurance_policy  ON bills(insurance_policy_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill_id        ON payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_processed_at   ON payments(processed_at);
CREATE INDEX IF NOT EXISTS idx_insurance_patient_id    ON insurance_policies(patient_id);
