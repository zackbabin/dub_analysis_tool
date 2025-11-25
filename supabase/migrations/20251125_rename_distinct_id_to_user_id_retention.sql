-- Migration: Rename distinct_id to user_id in retention table
-- Created: 2025-11-25
-- Purpose: Consistency - this table only uses $user_id (no dual-tracking needed)
--
-- Background:
-- - Retention charts (85857452, 86188712) return only $user_id
-- - No need for distinct_id mapping (unlike subscribers_insights)
-- - Rename column for clarity and consistency
--
-- Table affected:
-- - premium_creator_retention_events

-- Rename in premium_creator_retention_events
ALTER TABLE premium_creator_retention_events
  RENAME COLUMN distinct_id TO user_id;

-- Update indexes
DROP INDEX IF EXISTS idx_premium_creator_retention_events_distinct_id;
CREATE INDEX IF NOT EXISTS idx_premium_creator_retention_events_user_id
  ON premium_creator_retention_events(user_id);

-- Update unique constraint
DROP INDEX IF EXISTS premium_creator_retention_events_distinct_id_creator_userna_key;
CREATE UNIQUE INDEX IF NOT EXISTS premium_creator_retention_events_user_creator_cohort
  ON premium_creator_retention_events(user_id, creator_username, cohort_month);

-- Update column comment
COMMENT ON COLUMN premium_creator_retention_events.user_id IS
'Mixpanel $user_id (from charts 85857452, 86188712)';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Renamed distinct_id → user_id in retention table';
  RAISE NOTICE '   - premium_creator_retention_events.user_id';
  RAISE NOTICE '   - Updated indexes and unique constraints';
  RAISE NOTICE '';
END $$;
