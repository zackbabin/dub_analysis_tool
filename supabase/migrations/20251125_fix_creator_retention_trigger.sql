-- Migration: Fix trigger on creator_retention after user_id rename
-- Created: 2025-11-25
-- Purpose: Update clean_distinct_id trigger to reference user_id instead of distinct_id

-- Drop the old trigger that references distinct_id
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON premium_creator_retention_events;

-- Create new trigger function for user_id
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

-- Apply trigger to premium_creator_retention_events
CREATE TRIGGER clean_user_id_trigger
  BEFORE INSERT OR UPDATE OF user_id
  ON premium_creator_retention_events
  FOR EACH ROW
  EXECUTE FUNCTION clean_user_id();

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed trigger on premium_creator_retention_events';
  RAISE NOTICE '   - Dropped old clean_distinct_id_trigger';
  RAISE NOTICE '   - Created new clean_user_id_trigger for user_id column';
END $$;
