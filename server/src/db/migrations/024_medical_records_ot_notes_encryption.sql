-- =============================================================================
-- Migration 024: Backfill at-rest encryption for medical_records free-text and
-- ot_schedules.notes.
--
-- schema.sql annotates these columns `pgp_sym_encrypt at app layer`:
--   medical_records.chief_complaint / .diagnosis / .treatment_plan / .notes
--   ot_schedules.notes
-- The application write path did not encrypt them (telemedicine wrote notes as
-- plaintext), so existing rows would break the new decrypt-on-read path. Same
-- in-place backfill heuristic as 023: try to decrypt; if that raises it is
-- legacy plaintext (encrypt). Idempotent by construction.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  enc_key TEXT;
BEGIN
  enc_key := current_setting('app.pgcrypto_key', true);
  IF enc_key IS NULL THEN
    RAISE NOTICE 'app.pgcrypto_key not set — skipping at-rest plaintext backfill';
    RETURN;
  END IF;

  -- medical_records.chief_complaint
  FOR r IN SELECT id, chief_complaint FROM medical_records WHERE chief_complaint IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.chief_complaint, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE medical_records
         SET chief_complaint = encode(pgp_sym_encrypt(r.chief_complaint, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- medical_records.diagnosis
  FOR r IN SELECT id, diagnosis FROM medical_records WHERE diagnosis IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.diagnosis, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE medical_records
         SET diagnosis = encode(pgp_sym_encrypt(r.diagnosis, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- medical_records.treatment_plan
  FOR r IN SELECT id, treatment_plan FROM medical_records WHERE treatment_plan IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.treatment_plan, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE medical_records
         SET treatment_plan = encode(pgp_sym_encrypt(r.treatment_plan, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- medical_records.notes
  FOR r IN SELECT id, notes FROM medical_records WHERE notes IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.notes, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE medical_records
         SET notes = encode(pgp_sym_encrypt(r.notes, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- ot_schedules.notes
  FOR r IN SELECT id, notes FROM ot_schedules WHERE notes IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.notes, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE ot_schedules
         SET notes = encode(pgp_sym_encrypt(r.notes, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;
END $$;
