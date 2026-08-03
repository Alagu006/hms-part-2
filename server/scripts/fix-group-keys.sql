-- Fix malformed group encryption keys
-- This script deletes all existing group keys so they can be regenerated
-- with the correct DB_ENCRYPTION_KEY

BEGIN;

-- Delete all existing malformed group keys
DELETE FROM message_group_keys;

-- Show how many were deleted
SELECT 'Deleted malformed group keys' AS status;

COMMIT;

-- Note: Group keys will be regenerated automatically when users access their groups
-- Users should refresh their messaging page to get new keys
