-- =============================================================================
-- Migration 004: Report Jobs table for history tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       TEXT NOT NULL UNIQUE,
    user_id      UUID NOT NULL REFERENCES users(id),
    type         TEXT NOT NULL CHECK (type IN ('patient','financial','staff')),
    format       TEXT NOT NULL CHECK (format IN ('pdf','csv')),
    period       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','completed','failed')),
    download_key TEXT,
    filename     TEXT,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_user_id    ON report_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_report_jobs_created_at ON report_jobs(created_at);
