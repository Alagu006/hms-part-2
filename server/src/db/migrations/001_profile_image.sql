-- Migration 001: add profile_image_file_id to users
-- Run once against the database

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_image_file_id UUID REFERENCES files(id) ON DELETE SET NULL;

-- Also add missing columns that createUser inserts but schema.sql didn't declare
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth     DATE,
  ADD COLUMN IF NOT EXISTS gender            TEXT CHECK (gender IN ('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY')),
  ADD COLUMN IF NOT EXISTS blood_group       TEXT CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','UNKNOWN')),
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE;

-- Allow USER_PROFILE as an entity_type for profile images
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_entity_type_check;
ALTER TABLE files ADD CONSTRAINT files_entity_type_check
  CHECK (entity_type IN ('MEDICAL_RECORD','LAB_RESULT','PRESCRIPTION','MESSAGE','INCIDENT','PATIENT','USER_PROFILE'));
