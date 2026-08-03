-- =============================================================================
-- Migration 015: Payroll module — salary structures, monthly runs, payslips
-- =============================================================================

-- Salary structure assigned to each employee
CREATE TABLE IF NOT EXISTS salary_structures (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    basic_salary    NUMERIC(12,2) NOT NULL CHECK (basic_salary >= 0),
    hra_pct         NUMERIC(5,2)  NOT NULL DEFAULT 0  CHECK (hra_pct BETWEEN 0 AND 100),
    transport_allow NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (transport_allow >= 0),
    medical_allow   NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (medical_allow >= 0),
    other_allow     NUMERIC(10,2) NOT NULL DEFAULT 0  CHECK (other_allow >= 0),
    tax_pct         NUMERIC(5,2)  NOT NULL DEFAULT 0  CHECK (tax_pct BETWEEN 0 AND 100),
    pf_pct          NUMERIC(5,2)  NOT NULL DEFAULT 12 CHECK (pf_pct BETWEEN 0 AND 100),
    effective_from  DATE          NOT NULL DEFAULT CURRENT_DATE,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL,
    UNIQUE (user_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_user ON salary_structures(user_id) WHERE deleted_at IS NULL;

-- Monthly payroll run (one per month)
CREATE TABLE IF NOT EXISTS payroll_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_year     INT  NOT NULL CHECK (period_year >= 2000),
    period_month    INT  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    status          TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','PROCESSING','PROCESSED','ERROR')),
    processed_by    UUID REFERENCES users(id),
    processed_at    TIMESTAMPTZ,
    total_gross     NUMERIC(14,2),
    total_deductions NUMERIC(14,2),
    total_net       NUMERIC(14,2),
    error_count     INT  NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (period_year, period_month)
);

-- Per-employee payslip within a run
CREATE TABLE IF NOT EXISTS payroll_details (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    salary_structure_id UUID REFERENCES salary_structures(id),
    working_days        INT  NOT NULL DEFAULT 0,
    present_days        NUMERIC(6,2) NOT NULL DEFAULT 0,
    leave_days          NUMERIC(6,2) NOT NULL DEFAULT 0,
    absent_days         NUMERIC(6,2) NOT NULL DEFAULT 0,
    basic_salary        NUMERIC(12,2) NOT NULL DEFAULT 0,
    hra                 NUMERIC(10,2) NOT NULL DEFAULT 0,
    transport_allow     NUMERIC(10,2) NOT NULL DEFAULT 0,
    medical_allow       NUMERIC(10,2) NOT NULL DEFAULT 0,
    other_allow         NUMERIC(10,2) NOT NULL DEFAULT 0,
    gross_salary        NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_deduction       NUMERIC(10,2) NOT NULL DEFAULT 0,
    pf_deduction        NUMERIC(10,2) NOT NULL DEFAULT 0,
    other_deductions    NUMERIC(10,2) NOT NULL DEFAULT 0,
    net_salary          NUMERIC(12,2) NOT NULL DEFAULT 0,
    has_error           BOOLEAN NOT NULL DEFAULT FALSE,
    error_reason        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_details_run    ON payroll_details(run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_details_user   ON payroll_details(user_id);
