-- Migration 010: Per-group shared encryption key, stored per-member
-- The group_key is the AES-256-GCM key (base64), stored as plaintext server-side.
-- In a zero-trust system you'd wrap this with each user's public key,
-- but for this internal hospital system the server is trusted.

CREATE TABLE IF NOT EXISTS message_group_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
    group_key   TEXT NOT NULL,   -- base64-encoded AES-256-GCM raw key
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id)
);

CREATE INDEX IF NOT EXISTS idx_group_keys_group_id ON message_group_keys(group_id);
