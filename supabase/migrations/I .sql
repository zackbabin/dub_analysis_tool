-- Migration: Fix engagement staging triggers to use user_id
-- Created: 2025-11-25
-- Purpose: Update clean_distinct_id triggers after renaming distinct_id → user_id
--
-- Background:
-- - 20251124_remove_device_prefix created triggers on distinct_id column
-- - 20251125_rename_distinct_id_to_user_id renamed the column to user_id
-- - Triggers still reference old column name, causing "no field distinct_id" errors
--
-- Fix: Update trigger function and recreate triggers for engagement staging tables

-- ============================================================================
-- Part 1: Update trigger function to work with user_id
-- ============================================================================

CREATE OR REPLACE FUNCTION clean_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove $device: prefix if present
  IF NEW.user_id LIKE '$device:%' THEN
    NEW.user_id := REPLACE(NEW.user_id, '$device:', '');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clean_user_id IS
  'Trigger function that automatically removes "$device:" prefix from user_id values on INSERT or UPDATE';

-- ============================================================================
-- Part 2: Recreate triggers on engagement staging tables with user_id
-- ============================================================================

-- portfolio_engagement_staging (uses user_id now)
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON portfolio_engagement_staging;
DROP TRIGGER IF EXISTS clean_user_id_trigger ON portfolio_engagement_staging;
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON portfolio_engagement_staging
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- creator_engagement_staging (uses user_id now)
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON creator_engagement_staging;
DROP TRIGGER IF EXISTS clean_user_id_trigger ON creator_engagement_staging;
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON creator_engagement_staging
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- user_portfolio_creator_engagement (uses user_id now)
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_portfolio_creator_engagement;
DROP TRIGGER IF EXISTS clean_user_id_trigger ON user_portfolio_creator_engagement;
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON user_portfolio_creator_engagement
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- user_creator_engagement (uses user_id now)
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_creator_engagement;
DROP TRIGGER IF EXISTS clean_user_id_trigger ON user_creator_engagement;
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON user_creator_engagement
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed engagement staging triggers';
  RAISE NOTICE '   - Created clean_user_id() function (replaces clean_distinct_id for user_id columns)';
  RAISE NOTICE '   - Updated triggers on:';
  RAISE NOTICE '     • portfolio_engagement_staging';
  RAISE NOTICE '     • creator_engagement_staging';
  RAISE NOTICE '     • user_portfolio_creator_engagement';
  RAISE NOTICE '     • user_creator_engagement';
  RAISE NOTICE '   - Triggers now reference user_id instead of distinct_id';
  RAISE NOTICE '';
END $$;
