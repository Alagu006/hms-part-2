-- =============================================================================
-- Migration 021: Allow payments.method = 'REFUND'
--
-- refundBill() (billing.service.js) records the refund as a payment row with
-- method 'REFUND', but the payments.method CHECK only allowed CASH/CARD/
-- INSURANCE/BANK_TRANSFER/CHEQUE/ONLINE — so every refund failed on the
-- constraint. Extend the CHECK to include 'REFUND'.
-- =============================================================================

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('CASH','CARD','INSURANCE','BANK_TRANSFER','CHEQUE','ONLINE','REFUND'));
