-- =============================================================================
-- Migration 012: Audit log flagging + IP blocking
-- =============================================================================

-- Add flag columns to audit_logs
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason   TEXT,
  ADD COLUMN IF NOT EXISTS flagged_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS flagged_at    TIMESTAMPTZ;

-- Blocked IPs table
CREATE TABLE IF NOT EXISTS blocked_ips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address   INET NOT NULL UNIQUE,
  reason       TEXT,
  blocked_by   UUID REFERENCES users(id),
  blocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,          -- NULL = permanent
  unblocked_at TIMESTAMPTZ,
  unblocked_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_ips_active
  ON blocked_ips(ip_address)
  WHERE unblocked_at IS NULL;
