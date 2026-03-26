-- =============================================================================
-- HOSPITAL MANAGEMENT SYSTEM — PostgreSQL Schema
-- =============================================================================
--
-- ERD RELATIONSHIPS
-- =============================================================================
--
-- users ──< user_roles >── (role enum)
-- users ──< departments (head_of_department)
-- departments ──< users (department_id)
-- users ──< patients (created_by)
-- patients ──< appointments >── users (doctor_id)
-- appointments ──< medical_records
-- patients ──< medical_records
-- medical_records ──< vitals
-- medical_records ──< prescriptions ──< prescription_items >── medicines
-- medical_records ──< lab_orders ──< lab_results
-- lab_results ──< files
-- patients ──< files
-- users ──< messages >── message_groups ──< message_group_members >── users
-- users ──< notifications
-- users ──< audit_logs
-- inventory_items >── departments
-- rooms ──< beds
-- beds ──< patients (current_bed_id)
-- patients ──< bills ──< bill_items
-- bills ──< payments
-- users ──< leaves >── (leave_balances)
-- users ──< broadcasts
-- patients ──< telemedicine_sessions >── users (doctor_id)
-- prescriptions ──< pharmacy_orders
-- patients ──< blood_bank_units
-- ot_schedules >── patients, users (surgeon_id), rooms
-- patients ──< insurance_policies
-- users ──< incidents
-- visitor_logs >── patients
-- users ──< shift_schedules
-- patients ──< discharge_summaries >── medical_records
--
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- USERS
-- =============================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     TEXT UNIQUE,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    email           TEXT NOT NULL,  -- stored via pgp_sym_encrypt at app layer
    phone           TEXT,           -- stored via pgp_sym_encrypt at app layer
    password_hash   TEXT NOT NULL,  -- argon2id
    department_id   UUID,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- USER ROLES
-- =============================================================================
CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN','ADMIN','DOCTOR','NURSE','RECEPTIONIST','LAB_TECH',
    'PHARMACIST','INVENTORY','RADIOLOGIST','BILLING','HR','DIETITIAN',
    'PHYSIO','ANESTHETIST','SOCIAL_WORKER','IT_ADMIN','SECURITY_OFC',
    'ORDERLY','PATIENT'
);

CREATE TABLE user_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        user_role NOT NULL,
    granted_by  UUID REFERENCES users(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ NULL,
    UNIQUE (user_id, role)
);

-- =============================================================================
-- DEPARTMENTS
-- =============================================================================
CREATE TABLE departments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL UNIQUE,
    code                TEXT NOT NULL UNIQUE,
    head_of_department  UUID REFERENCES users(id),
    floor               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

ALTER TABLE users ADD CONSTRAINT fk_users_department
    FOREIGN KEY (department_id) REFERENCES departments(id);

-- =============================================================================
-- PATIENTS
-- =============================================================================
CREATE TABLE patients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mrn                 TEXT NOT NULL UNIQUE,   -- Medical Record Number
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    date_of_birth       DATE NOT NULL,
    gender              TEXT NOT NULL CHECK (gender IN ('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY')),
    blood_group         TEXT CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','UNKNOWN')),
    email               TEXT,   -- pgp_sym_encrypt at app layer
    phone               TEXT,   -- pgp_sym_encrypt at app layer
    address             TEXT,   -- pgp_sym_encrypt at app layer
    emergency_contact   TEXT,   -- pgp_sym_encrypt at app layer
    current_bed_id      UUID,
    user_id             UUID REFERENCES users(id),  -- if patient has portal access
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- ROOMS & BEDS
-- =============================================================================
CREATE TABLE rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_number     TEXT NOT NULL UNIQUE,
    room_type       TEXT NOT NULL CHECK (room_type IN ('GENERAL','PRIVATE','ICU','NICU','OT','EMERGENCY','ISOLATION','RECOVERY')),
    department_id   UUID REFERENCES departments(id),
    floor           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

CREATE TABLE beds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bed_number      TEXT NOT NULL,
    room_id         UUID NOT NULL REFERENCES rooms(id),
    status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL,
    UNIQUE (bed_number, room_id)
);

ALTER TABLE patients ADD CONSTRAINT fk_patients_bed
    FOREIGN KEY (current_bed_id) REFERENCES beds(id);

-- =============================================================================
-- APPOINTMENTS
-- =============================================================================
CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    doctor_id           UUID NOT NULL REFERENCES users(id),
    department_id       UUID REFERENCES departments(id),
    scheduled_at        TIMESTAMPTZ NOT NULL,
    duration_minutes    INT NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
    type                TEXT NOT NULL CHECK (type IN ('IN_PERSON','TELEMEDICINE','FOLLOW_UP','EMERGENCY')),
    status              TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),
    reason              TEXT,   -- pgp_sym_encrypt at app layer
    notes               TEXT,   -- pgp_sym_encrypt at app layer
    cancelled_by        UUID REFERENCES users(id),
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- MEDICAL RECORDS
-- =============================================================================
CREATE TABLE medical_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    appointment_id      UUID REFERENCES appointments(id),
    attending_doctor_id UUID NOT NULL REFERENCES users(id),
    visit_date          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chief_complaint     TEXT,   -- pgp_sym_encrypt at app layer
    diagnosis           TEXT,   -- pgp_sym_encrypt at app layer
    treatment_plan      TEXT,   -- pgp_sym_encrypt at app layer
    notes               TEXT,   -- pgp_sym_encrypt at app layer
    is_confidential     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- VITALS
-- =============================================================================
CREATE TABLE vitals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medical_record_id   UUID NOT NULL REFERENCES medical_records(id),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    recorded_by         UUID NOT NULL REFERENCES users(id),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature_c       NUMERIC(4,1),
    pulse_bpm           INT CHECK (pulse_bpm > 0),
    bp_systolic         INT CHECK (bp_systolic > 0),
    bp_diastolic        INT CHECK (bp_diastolic > 0),
    spo2_pct            NUMERIC(5,2) CHECK (spo2_pct BETWEEN 0 AND 100),
    respiratory_rate    INT CHECK (respiratory_rate > 0),
    weight_kg           NUMERIC(6,2) CHECK (weight_kg > 0),
    height_cm           NUMERIC(6,2) CHECK (height_cm > 0),
    bmi                 NUMERIC(5,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- MEDICINES
-- =============================================================================
CREATE TABLE medicines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    generic_name    TEXT,
    category        TEXT,
    form            TEXT CHECK (form IN ('TABLET','CAPSULE','SYRUP','INJECTION','CREAM','DROPS','INHALER','PATCH','OTHER')),
    strength        TEXT,
    manufacturer    TEXT,
    is_controlled   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- PRESCRIPTIONS
-- =============================================================================
CREATE TABLE prescriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medical_record_id   UUID NOT NULL REFERENCES medical_records(id),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    prescribed_by       UUID NOT NULL REFERENCES users(id),
    prescribed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DISPENSED','PARTIALLY_DISPENSED','CANCELLED')),
    notes               TEXT,   -- pgp_sym_encrypt at app layer
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

CREATE TABLE prescription_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id),
    medicine_id     UUID NOT NULL REFERENCES medicines(id),
    dosage          TEXT NOT NULL,
    frequency       TEXT NOT NULL,
    duration_days   INT CHECK (duration_days > 0),
    quantity        INT NOT NULL CHECK (quantity > 0),
    instructions    TEXT,   -- pgp_sym_encrypt at app layer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- LAB ORDERS & RESULTS
-- =============================================================================
CREATE TABLE lab_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medical_record_id   UUID NOT NULL REFERENCES medical_records(id),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    ordered_by          UUID NOT NULL REFERENCES users(id),
    assigned_to         UUID REFERENCES users(id),
    test_name           TEXT NOT NULL,
    test_code           TEXT,
    priority            TEXT NOT NULL DEFAULT 'ROUTINE' CHECK (priority IN ('ROUTINE','URGENT','STAT')),
    status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COLLECTED','PROCESSING','COMPLETED','CANCELLED')),
    ordered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    collected_at        TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

CREATE TABLE lab_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_order_id    UUID NOT NULL REFERENCES lab_orders(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    performed_by    UUID NOT NULL REFERENCES users(id),
    verified_by     UUID REFERENCES users(id),
    result_data     TEXT NOT NULL,  -- pgp_sym_encrypt at app layer (JSON blob)
    reference_range TEXT,
    interpretation  TEXT,           -- pgp_sym_encrypt at app layer
    is_abnormal     BOOLEAN NOT NULL DEFAULT FALSE,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- FILES
-- =============================================================================
CREATE TABLE files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name       TEXT NOT NULL,
    storage_key         TEXT NOT NULL UNIQUE,   -- path in object storage
    mime_type           TEXT NOT NULL,
    size_bytes          BIGINT NOT NULL CHECK (size_bytes > 0),
    checksum_sha256     TEXT NOT NULL,
    encryption_iv       TEXT NOT NULL,          -- AES-256-GCM IV (base64)
    entity_type         TEXT NOT NULL CHECK (entity_type IN ('MEDICAL_RECORD','LAB_RESULT','PRESCRIPTION','MESSAGE','INCIDENT','PATIENT')),
    entity_id           UUID NOT NULL,
    uploaded_by         UUID NOT NULL REFERENCES users(id),
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- MESSAGE GROUPS & MESSAGES
-- =============================================================================
CREATE TABLE message_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT,
    type        TEXT NOT NULL CHECK (type IN ('DIRECT','GROUP','DEPARTMENT','BROADCAST')),
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ NULL
);

CREATE TABLE message_group_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN','MEMBER')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at     TIMESTAMPTZ NULL,
    UNIQUE (group_id, user_id)
);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES message_groups(id),
    sender_id       UUID NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,  -- AES-256-GCM encrypted at app layer
    encryption_iv   TEXT NOT NULL,
    reply_to_id     UUID REFERENCES messages(id),
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at       TIMESTAMPTZ NULL,
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL CHECK (type IN ('APPOINTMENT','LAB_RESULT','PRESCRIPTION','MESSAGE','SYSTEM','ALERT','SHIFT','LEAVE')),
    title           TEXT NOT NULL,          -- AES-256-GCM encrypted at app layer
    body            TEXT NOT NULL,          -- AES-256-GCM encrypted at app layer
    encryption_iv   TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       UUID,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- AUDIT LOGS (hash-chain tamper evidence)
-- =============================================================================
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    entity_id   UUID,
    prev_data   JSONB,
    next_data   JSONB,
    ip_address  INET,
    user_agent  TEXT,
    prev_hash   TEXT,   -- SHA-256 of previous row for hash-chain tamper evidence
    row_hash    TEXT,   -- SHA-256 of this row's content
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INVENTORY
-- =============================================================================
CREATE TABLE inventory_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    sku                 TEXT NOT NULL UNIQUE,
    category            TEXT NOT NULL CHECK (category IN ('MEDICINE','EQUIPMENT','CONSUMABLE','LINEN','CHEMICAL','OTHER')),
    department_id       UUID REFERENCES departments(id),
    unit                TEXT NOT NULL,
    quantity_in_stock   NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_in_stock >= 0),
    reorder_level       NUMERIC(12,3) NOT NULL DEFAULT 0,
    unit_cost           NUMERIC(12,2),
    expiry_date         DATE,
    supplier            TEXT,
    location            TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- BILLING
-- =============================================================================
CREATE TABLE bills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    visit_id        UUID REFERENCES medical_records(id),
    bill_number     TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED','REFUNDED')),
    total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    issued_by       UUID REFERENCES users(id),
    issued_at       TIMESTAMPTZ,
    due_date        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

CREATE TABLE bill_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id         UUID NOT NULL REFERENCES bills(id),
    description     TEXT NOT NULL,
    item_type       TEXT NOT NULL CHECK (item_type IN ('CONSULTATION','PROCEDURE','MEDICINE','LAB','ROOM','EQUIPMENT','OTHER')),
    quantity        NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price      NUMERIC(12,2) NOT NULL,
    discount_pct    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    total_price     NUMERIC(14,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id         UUID NOT NULL REFERENCES bills(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method          TEXT NOT NULL CHECK (method IN ('CASH','CARD','INSURANCE','BANK_TRANSFER','CHEQUE','ONLINE')),
    reference_no    TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED')),
    processed_by    UUID REFERENCES users(id),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- LEAVES
-- =============================================================================
CREATE TABLE leaves (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    leave_type      TEXT NOT NULL CHECK (leave_type IN ('ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','EMERGENCY','COMPENSATORY')),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    days_count      NUMERIC(5,1) NOT NULL CHECK (days_count > 0),
    reason          TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL,
    CHECK (end_date >= start_date)
);

CREATE TABLE leave_balances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    leave_type      TEXT NOT NULL CHECK (leave_type IN ('ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','EMERGENCY','COMPENSATORY')),
    year            INT NOT NULL CHECK (year > 2000),
    total_days      NUMERIC(5,1) NOT NULL DEFAULT 0,
    used_days       NUMERIC(5,1) NOT NULL DEFAULT 0,
    pending_days    NUMERIC(5,1) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, leave_type, year)
);

-- =============================================================================
-- BROADCASTS
-- =============================================================================
CREATE TABLE broadcasts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,          -- AES-256-GCM encrypted at app layer
    encryption_iv   TEXT NOT NULL,
    target_roles    user_role[] NOT NULL,
    sent_by         UUID NOT NULL REFERENCES users(id),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TELEMEDICINE SESSIONS
-- =============================================================================
CREATE TABLE telemedicine_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id  UUID NOT NULL REFERENCES appointments(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    doctor_id       UUID NOT NULL REFERENCES users(id),
    room_token      TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','ACTIVE','COMPLETED','FAILED','CANCELLED')),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_secs   INT,
    recording_key   TEXT,   -- encrypted storage key if recorded
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PHARMACY ORDERS
-- =============================================================================
CREATE TABLE pharmacy_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    dispensed_by    UUID REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','DISPENSED','PARTIALLY_DISPENSED','CANCELLED')),
    dispensed_at    TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- BLOOD BANK
-- =============================================================================
CREATE TABLE blood_bank_units (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blood_group     TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    component       TEXT NOT NULL CHECK (component IN ('WHOLE_BLOOD','PACKED_RBC','PLASMA','PLATELETS','CRYOPRECIPITATE')),
    unit_number     TEXT NOT NULL UNIQUE,
    donor_id        UUID REFERENCES patients(id),
    collected_at    TIMESTAMPTZ NOT NULL,
    expiry_at       TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','TRANSFUSED','DISCARDED','QUARANTINE')),
    reserved_for    UUID REFERENCES patients(id),
    transfused_at   TIMESTAMPTZ,
    transfused_by   UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- OT SCHEDULES
-- =============================================================================
CREATE TABLE ot_schedules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    surgeon_id          UUID NOT NULL REFERENCES users(id),
    anesthetist_id      UUID REFERENCES users(id),
    room_id             UUID NOT NULL REFERENCES rooms(id),
    procedure_name      TEXT NOT NULL,
    scheduled_start     TIMESTAMPTZ NOT NULL,
    scheduled_end       TIMESTAMPTZ NOT NULL,
    actual_start        TIMESTAMPTZ,
    actual_end          TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','POSTPONED')),
    notes               TEXT,   -- pgp_sym_encrypt at app layer
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL,
    CHECK (scheduled_end > scheduled_start)
);

-- =============================================================================
-- INSURANCE POLICIES
-- =============================================================================
CREATE TABLE insurance_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    provider_name       TEXT NOT NULL,
    policy_number       TEXT NOT NULL,
    group_number        TEXT,
    coverage_type       TEXT NOT NULL CHECK (coverage_type IN ('INDIVIDUAL','FAMILY','GROUP')),
    coverage_start      DATE NOT NULL,
    coverage_end        DATE,
    max_coverage_amount NUMERIC(14,2),
    copay_pct           NUMERIC(5,2) CHECK (copay_pct BETWEEN 0 AND 100),
    is_primary          BOOLEAN NOT NULL DEFAULT TRUE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ NULL
);

-- =============================================================================
-- INCIDENTS
-- =============================================================================
CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reported_by     UUID NOT NULL REFERENCES users(id),
    patient_id      UUID REFERENCES patients(id),
    incident_type   TEXT NOT NULL CHECK (incident_type IN ('FALL','MEDICATION_ERROR','EQUIPMENT_FAILURE','SECURITY','FIRE','INFECTION','OTHER')),
    severity        TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    description     TEXT NOT NULL,  -- pgp_sym_encrypt at app layer
    location        TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','CLOSED')),
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL
);

-- =============================================================================
-- VISITOR LOGS
-- =============================================================================
CREATE TABLE visitor_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      UUID NOT NULL REFERENCES patients(id),
    visitor_name    TEXT NOT NULL,  -- pgp_sym_encrypt at app layer
    visitor_phone   TEXT,           -- pgp_sym_encrypt at app layer
    relationship    TEXT,
    id_type         TEXT CHECK (id_type IN ('NATIONAL_ID','PASSPORT','DRIVING_LICENSE','OTHER')),
    id_number       TEXT,           -- pgp_sym_encrypt at app layer
    purpose         TEXT,
    checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_out_at  TIMESTAMPTZ,
    badge_number    TEXT,
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SHIFT SCHEDULES
-- =============================================================================
CREATE TABLE shift_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    department_id   UUID REFERENCES departments(id),
    shift_type      TEXT NOT NULL CHECK (shift_type IN ('MORNING','AFTERNOON','NIGHT','ON_CALL','SPLIT')),
    shift_date      DATE NOT NULL,
    start_time      TIMETZ NOT NULL,
    end_time        TIMETZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CONFIRMED','COMPLETED','ABSENT','SWAPPED')),
    swapped_with    UUID REFERENCES users(id),
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL,
    UNIQUE (user_id, shift_date, shift_type)
);

-- =============================================================================
-- DISCHARGE SUMMARIES
-- =============================================================================
CREATE TABLE discharge_summaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          UUID NOT NULL REFERENCES patients(id),
    medical_record_id   UUID NOT NULL REFERENCES medical_records(id),
    discharged_by       UUID NOT NULL REFERENCES users(id),
    discharge_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    discharge_type      TEXT NOT NULL CHECK (discharge_type IN ('REGULAR','AMA','TRANSFER','DEATH','ABSCONDED')),
    final_diagnosis     TEXT NOT NULL,  -- pgp_sym_encrypt at app layer
    treatment_summary   TEXT,           -- pgp_sym_encrypt at app layer
    discharge_condition TEXT NOT NULL CHECK (discharge_condition IN ('STABLE','CRITICAL','IMPROVED','UNCHANGED','DECEASED')),
    follow_up_date      DATE,
    follow_up_notes     TEXT,           -- pgp_sym_encrypt at app layer
    medications_on_discharge TEXT,      -- pgp_sym_encrypt at app layer
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- users
CREATE INDEX idx_users_department_id     ON users(department_id);
CREATE INDEX idx_users_email             ON users(email);
CREATE INDEX idx_users_deleted_at        ON users(deleted_at) WHERE deleted_at IS NULL;

-- user_roles
CREATE INDEX idx_user_roles_user_id      ON user_roles(user_id);
CREATE INDEX idx_user_roles_role         ON user_roles(role);

-- patients
CREATE INDEX idx_patients_mrn            ON patients(mrn);
CREATE INDEX idx_patients_user_id        ON patients(user_id);
CREATE INDEX idx_patients_current_bed    ON patients(current_bed_id);
CREATE INDEX idx_patients_deleted_at     ON patients(deleted_at) WHERE deleted_at IS NULL;

-- appointments
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_id  ON appointments(doctor_id);
CREATE INDEX idx_appointments_scheduled  ON appointments(scheduled_at);
CREATE INDEX idx_appointments_status     ON appointments(status);
CREATE INDEX idx_appointments_deleted_at ON appointments(deleted_at) WHERE deleted_at IS NULL;

-- medical_records
CREATE INDEX idx_medical_records_patient ON medical_records(patient_id);
CREATE INDEX idx_medical_records_doctor  ON medical_records(attending_doctor_id);
CREATE INDEX idx_medical_records_appt    ON medical_records(appointment_id);
CREATE INDEX idx_medical_records_deleted ON medical_records(deleted_at) WHERE deleted_at IS NULL;

-- vitals
CREATE INDEX idx_vitals_medical_record   ON vitals(medical_record_id);
CREATE INDEX idx_vitals_patient_id       ON vitals(patient_id);
CREATE INDEX idx_vitals_recorded_at      ON vitals(recorded_at);

-- prescriptions
CREATE INDEX idx_prescriptions_patient   ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_record    ON prescriptions(medical_record_id);
CREATE INDEX idx_prescriptions_status    ON prescriptions(status);

-- prescription_items
CREATE INDEX idx_presc_items_presc_id    ON prescription_items(prescription_id);
CREATE INDEX idx_presc_items_medicine    ON prescription_items(medicine_id);

-- lab_orders
CREATE INDEX idx_lab_orders_patient      ON lab_orders(patient_id);
CREATE INDEX idx_lab_orders_record       ON lab_orders(medical_record_id);
CREATE INDEX idx_lab_orders_assigned     ON lab_orders(assigned_to);
CREATE INDEX idx_lab_orders_status       ON lab_orders(status);

-- lab_results
CREATE INDEX idx_lab_results_order       ON lab_results(lab_order_id);
CREATE INDEX idx_lab_results_patient     ON lab_results(patient_id);

-- files
CREATE INDEX idx_files_entity            ON files(entity_type, entity_id);
CREATE INDEX idx_files_uploaded_by       ON files(uploaded_by);

-- messages
CREATE INDEX idx_messages_group_id       ON messages(group_id);
CREATE INDEX idx_messages_sender_id      ON messages(sender_id);
CREATE INDEX idx_messages_sent_at        ON messages(sent_at);

-- message_group_members
CREATE INDEX idx_mgm_group_id            ON message_group_members(group_id);
CREATE INDEX idx_mgm_user_id             ON message_group_members(user_id);

-- notifications
CREATE INDEX idx_notifications_user_id   ON notifications(user_id);
CREATE INDEX idx_notifications_is_read   ON notifications(is_read);
CREATE INDEX idx_notifications_created   ON notifications(created_at);

-- audit_logs
CREATE INDEX idx_audit_user_id           ON audit_logs(user_id);
CREATE INDEX idx_audit_entity            ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_created_at        ON audit_logs(created_at);

-- inventory_items
CREATE INDEX idx_inventory_department    ON inventory_items(department_id);
CREATE INDEX idx_inventory_category      ON inventory_items(category);
CREATE INDEX idx_inventory_sku           ON inventory_items(sku);

-- bills
CREATE INDEX idx_bills_patient_id        ON bills(patient_id);
CREATE INDEX idx_bills_status            ON bills(status);

-- bill_items
CREATE INDEX idx_bill_items_bill_id      ON bill_items(bill_id);

-- payments
CREATE INDEX idx_payments_bill_id        ON payments(bill_id);
CREATE INDEX idx_payments_patient_id     ON payments(patient_id);

-- leaves
CREATE INDEX idx_leaves_user_id          ON leaves(user_id);
CREATE INDEX idx_leaves_status           ON leaves(status);
CREATE INDEX idx_leaves_dates            ON leaves(start_date, end_date);

-- leave_balances
CREATE INDEX idx_leave_balances_user     ON leave_balances(user_id);

-- telemedicine_sessions
CREATE INDEX idx_tele_patient_id         ON telemedicine_sessions(patient_id);
CREATE INDEX idx_tele_doctor_id          ON telemedicine_sessions(doctor_id);
CREATE INDEX idx_tele_appointment_id     ON telemedicine_sessions(appointment_id);

-- pharmacy_orders
CREATE INDEX idx_pharmacy_prescription   ON pharmacy_orders(prescription_id);
CREATE INDEX idx_pharmacy_patient        ON pharmacy_orders(patient_id);

-- blood_bank_units
CREATE INDEX idx_blood_group_status      ON blood_bank_units(blood_group, status);

-- ot_schedules
CREATE INDEX idx_ot_patient_id           ON ot_schedules(patient_id);
CREATE INDEX idx_ot_surgeon_id           ON ot_schedules(surgeon_id);
CREATE INDEX idx_ot_room_id              ON ot_schedules(room_id);
CREATE INDEX idx_ot_scheduled_start      ON ot_schedules(scheduled_start);

-- insurance_policies
CREATE INDEX idx_insurance_patient       ON insurance_policies(patient_id);

-- incidents
CREATE INDEX idx_incidents_reported_by   ON incidents(reported_by);
CREATE INDEX idx_incidents_patient_id    ON incidents(patient_id);
CREATE INDEX idx_incidents_status        ON incidents(status);

-- visitor_logs
CREATE INDEX idx_visitor_patient_id      ON visitor_logs(patient_id);
CREATE INDEX idx_visitor_checked_in      ON visitor_logs(checked_in_at);

-- shift_schedules
CREATE INDEX idx_shifts_user_id          ON shift_schedules(user_id);
CREATE INDEX idx_shifts_department_id    ON shift_schedules(department_id);
CREATE INDEX idx_shifts_date             ON shift_schedules(shift_date);

-- discharge_summaries
CREATE INDEX idx_discharge_patient       ON discharge_summaries(patient_id);
CREATE INDEX idx_discharge_record        ON discharge_summaries(medical_record_id);
CREATE INDEX idx_discharge_date          ON discharge_summaries(discharge_date);

-- rooms & beds
CREATE INDEX idx_beds_room_id            ON beds(room_id);
CREATE INDEX idx_beds_status             ON beds(status);
CREATE INDEX idx_rooms_department        ON rooms(department_id);
