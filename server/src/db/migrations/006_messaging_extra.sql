-- =============================================================================
-- Message reads table for read receipts
-- =============================================================================
CREATE TABLE message_reads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_reads_message_id ON message_reads(message_id);
CREATE INDEX idx_message_reads_user_id  ON message_reads(user_id);

-- Pending: message_reactions table must exist for upsert
-- (created by app layer on first reaction, but defined here for completeness)
CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message_id ON message_reactions(message_id);

-- Pending: pinned_messages table
CREATE TABLE IF NOT EXISTS pinned_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id),
    pinned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, message_id)
);

-- Pending: message_hidden table (per-user soft delete)
CREATE TABLE IF NOT EXISTS message_hidden (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);
