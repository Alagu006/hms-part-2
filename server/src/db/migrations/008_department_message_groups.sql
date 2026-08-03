-- Migration 008: Create department-based message groups for all departments
-- Safe to run multiple times (ON CONFLICT DO NOTHING)

DO $$
DECLARE
  v_admin_id UUID;
  dept RECORD;
  v_group_id UUID;
BEGIN
  -- Use the first SUPER_ADMIN as group creator
  SELECT u.id INTO v_admin_id
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'SUPER_ADMIN'
  WHERE u.deleted_at IS NULL
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'No SUPER_ADMIN found, skipping department group creation.';
    RETURN;
  END IF;

  FOR dept IN SELECT id, name FROM departments WHERE deleted_at IS NULL LOOP
    -- Only create if a group with this exact name doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM message_groups WHERE name = dept.name AND deleted_at IS NULL
    ) THEN
      INSERT INTO message_groups (id, name, type, created_by, created_at, updated_at)
      VALUES (gen_random_uuid(), dept.name, 'DEPARTMENT', v_admin_id, NOW(), NOW())
      RETURNING id INTO v_group_id;

      INSERT INTO message_group_members (id, group_id, user_id, role, joined_at)
      VALUES (gen_random_uuid(), v_group_id, v_admin_id, 'ADMIN', NOW())
      ON CONFLICT (group_id, user_id) DO NOTHING;

      RAISE NOTICE 'Created department group: %', dept.name;
    ELSE
      RAISE NOTICE 'Department group already exists: %', dept.name;
    END IF;
  END LOOP;
END $$;
