-- =============================================================================
-- Migration 023: Backfill at-rest encryption for legacy plaintext fields.
--
-- schema.sql has long commented these columns as `pgp_sym_encrypt at app layer`,
-- but appointments/incidents/discharge_summaries were written as plaintext, so
-- existing rows would break the new decrypt-on-read path (pgp_sym_decrypt would
-- throw on non-ciphertext and the services would surface nulls).
--
-- This backfill encrypts any legacy plaintext in place. Detection heuristic:
-- try to decrypt the value; if that succeeds it is already ciphertext (skip),
-- if it raises it is legacy plaintext (encrypt). Idempotent by construction.
--
-- The encryption key comes from the `app.pgcrypto_key` GUC, which migrate.js
-- sets from PG_CRYPTO_KEY for the duration of each migration transaction. If it
-- is not set (e.g. the throwaway test DB with no rows), the backfill is skipped
-- with a NOTICE.
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

  -- appointments.reason / appointments.notes
  FOR r IN SELECT id, reason FROM appointments WHERE reason IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.reason, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE appointments
         SET reason = encode(pgp_sym_encrypt(r.reason, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  FOR r IN SELECT id, notes FROM appointments WHERE notes IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.notes, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE appointments
         SET notes = encode(pgp_sym_encrypt(r.notes, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- incidents.description
  FOR r IN SELECT id, description FROM incidents WHERE description IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.description, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE incidents
         SET description = encode(pgp_sym_encrypt(r.description, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- discharge_summaries.final_diagnosis
  FOR r IN SELECT id, final_diagnosis FROM discharge_summaries WHERE final_diagnosis IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.final_diagnosis, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE discharge_summaries
         SET final_diagnosis = encode(pgp_sym_encrypt(r.final_diagnosis, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- discharge_summaries.treatment_summary
  FOR r IN SELECT id, treatment_summary FROM discharge_summaries WHERE treatment_summary IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.treatment_summary, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE discharge_summaries
         SET treatment_summary = encode(pgp_sym_encrypt(r.treatment_summary, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- discharge_summaries.follow_up_notes
  FOR r IN SELECT id, follow_up_notes FROM discharge_summaries WHERE follow_up_notes IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.follow_up_notes, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE discharge_summaries
         SET follow_up_notes = encode(pgp_sym_encrypt(r.follow_up_notes, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;

  -- discharge_summaries.medications_on_discharge
  FOR r IN SELECT id, medications_on_discharge FROM discharge_summaries WHERE medications_on_discharge IS NOT NULL LOOP
    BEGIN
      PERFORM pgp_sym_decrypt(decode(r.medications_on_discharge, 'hex'), enc_key);
    EXCEPTION WHEN OTHERS THEN
      UPDATE discharge_summaries
         SET medications_on_discharge = encode(pgp_sym_encrypt(r.medications_on_discharge, enc_key), 'hex'),
             updated_at = NOW()
       WHERE id = r.id;
    END;
  END LOOP;
END $$;
