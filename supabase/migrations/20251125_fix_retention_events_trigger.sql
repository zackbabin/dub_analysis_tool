-- Migration: Fix premium_creator_retention_events trigger to use user_id
-- Created: 2025-11-25
-- Purpose: Update clean_distinct_id trigger after renaming distinct_id → user_id
--
-- Background:
-- - 20251124_remove_device_prefix created trigger on distinct_id column
-- - 20251125_rename_distinct_id_to_user_id_retention renamed the column to user_id
-- - Trigger still references old column name, causing "no field distinct_id" errors

-- premium_creator_retention_events (uses user_id now)
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON premium_creator_retention_events;
DROP TRIGGER IF EXISTS clean_user_id_trigger ON premium_creator_retention_events;
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON premium_creator_retention_events
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed premium_creator_retention_events trigger';
  RAISE NOTICE '   - Trigger now references user_id instead of distinct_id';
  RAISE NOTICE '';
END $$;
