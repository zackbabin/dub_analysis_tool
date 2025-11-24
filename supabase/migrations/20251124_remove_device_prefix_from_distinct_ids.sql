-- Migration: Remove "$device:" prefix from distinct_id columns
-- Created: 2025-11-24
-- Purpose: Clean all distinct_id values and prevent storing the prefix going forward
--
-- Background: Mixpanel sometimes includes "$device:" prefix in distinct_id values
-- We want to store the clean ID without this prefix for consistency

-- ============================================================================
-- Part 1: Retroactive cleanup - Remove "$device:" prefix from existing data
-- ============================================================================

-- Update all tables that have distinct_id column
UPDATE creator_engagement_staging
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE event_sequences_raw
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE portfolio_engagement_staging
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE premium_creator_retention_events
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE subscribers_insights
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE user_creator_engagement
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE user_first_copies
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

UPDATE user_portfolio_creator_engagement
SET distinct_id = REPLACE(distinct_id, '$device:', '')
WHERE distinct_id LIKE '$device:%';

-- Note: user_creator_profile_copies and user_portfolio_creator_copies are VIEWS, not tables
-- They will automatically reflect the cleaned data from their source tables

-- ============================================================================
-- Part 2: Create trigger function to prevent storing prefix going forward
-- ============================================================================

CREATE OR REPLACE FUNCTION clean_distinct_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove $device: prefix if present
  IF NEW.distinct_id LIKE '$device:%' THEN
    NEW.distinct_id := REPLACE(NEW.distinct_id, '$device:', '');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clean_distinct_id IS
  'Trigger function that automatically removes "$device:" prefix from distinct_id values on INSERT or UPDATE';

-- ============================================================================
-- Part 3: Apply trigger to all tables with distinct_id column
-- ============================================================================

-- creator_engagement_staging
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON creator_engagement_staging;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON creator_engagement_staging
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- event_sequences_raw
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON event_sequences_raw;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON event_sequences_raw
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- portfolio_engagement_staging
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON portfolio_engagement_staging;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON portfolio_engagement_staging
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- premium_creator_retention_events
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON premium_creator_retention_events;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON premium_creator_retention_events
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- subscribers_insights
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON subscribers_insights;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON subscribers_insights
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- user_creator_engagement
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_creator_engagement;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON user_creator_engagement
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- user_first_copies
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_first_copies;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON user_first_copies
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- user_portfolio_creator_engagement
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_portfolio_creator_engagement;
CREATE TRIGGER clean_distinct_id_trigger
  BEFORE INSERT OR UPDATE OF distinct_id
  ON user_portfolio_creator_engagement
  FOR EACH ROW
  EXECUTE FUNCTION clean_distinct_id();

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  -- Count any remaining instances with $device: prefix across all tables
  SELECT
    (SELECT COUNT(*) FROM creator_engagement_staging WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM event_sequences_raw WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM portfolio_engagement_staging WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM premium_creator_retention_events WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM subscribers_insights WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM user_creator_engagement WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM user_first_copies WHERE distinct_id LIKE '$device:%') +
    (SELECT COUNT(*) FROM user_portfolio_creator_engagement WHERE distinct_id LIKE '$device:%')
  INTO remaining_count;

  RAISE NOTICE '===============================================';
  RAISE NOTICE 'distinct_id cleanup complete!';
  RAISE NOTICE '  ✓ Removed $device: prefix from all tables';
  RAISE NOTICE '  ✓ Added triggers to prevent future occurrences';
  RAISE NOTICE '  ✓ Remaining instances with prefix: %', remaining_count;
  RAISE NOTICE '===============================================';
END $$;
