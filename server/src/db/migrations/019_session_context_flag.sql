-- Migration 019: Add context_flagged_at to sessions
-- Date: 2026-08-02
-- Description: Zero-trust session context signal. The authenticate middleware
--   compares each request's IP/user-agent hash against the values recorded at
--   login and flags the session (non-blocking) when they differ — a possible
--   token-theft / account-sharing indicator. Logging happens in the middleware;
--   this column records that the signal already fired for a session so it is
--   only flagged (and logged) once.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS context_flagged_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN sessions.context_flagged_at IS
  'Set once when a session is observed from a different IP or user-agent than at login (best-effort, non-blocking zero-trust signal).';
