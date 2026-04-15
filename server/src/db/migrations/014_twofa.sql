-- =============================================================================
-- Migration 014: Optional email-based 2FA per user
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
