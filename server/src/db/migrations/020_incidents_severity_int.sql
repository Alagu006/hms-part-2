-- =============================================================================
-- Migration 020: Incidents severity → INTEGER (1-5)
--
-- Baseline schema.sql declared incidents.severity as TEXT with
-- CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), but the app
-- (incident.schema.js) writes integer 1-5 and the frontend renders
-- "1 = minor, 5 = critical". Migration 002 attempted to fix this with
-- `ADD COLUMN IF NOT EXISTS severity INT`, which silently no-ops when the
-- column already exists — so incident reporting always failed on the CHECK.
--
-- This migration converts the column to INTEGER, backfilling legacy TEXT
-- values (LOW→1, MEDIUM→2, HIGH→3, CRITICAL→4). It is idempotent and safe to
-- run against both a legacy TEXT column and a fresh INTEGER column.
-- =============================================================================

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_severity_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'incidents'
       AND column_name  = 'severity'
       AND data_type IN ('text', 'character varying')
  ) THEN
    -- The old CHECK must be dropped before backfilling numeric values.
    UPDATE incidents
       SET severity = CASE severity
                        WHEN 'LOW'      THEN 1
                        WHEN 'MEDIUM'   THEN 2
                        WHEN 'HIGH'     THEN 3
                        WHEN 'CRITICAL' THEN 4
                      END
     WHERE severity IN ('LOW','MEDIUM','HIGH','CRITICAL');

    ALTER TABLE incidents
      ALTER COLUMN severity TYPE INTEGER USING severity::integer;
  END IF;
END $$;

ALTER TABLE incidents ADD CONSTRAINT incidents_severity_check
  CHECK (severity BETWEEN 1 AND 5);
