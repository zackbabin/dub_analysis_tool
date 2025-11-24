-- Migration: Cleanup event sequences architecture
-- Created: 2025-11-23
-- Purpose: Drop event_sequences_raw table and clean up redundant columns
--
-- CONTEXT:
-- - event_sequences_raw was an intermediate table that stored individual events
-- - process-event-sequences aggregated these into user_event_sequences
-- - This 2-step process caused 95% more DB writes than necessary
--
-- NEW ARCHITECTURE:
-- - sync-event-sequences-v2 now aggregates events during sync and writes directly to user_event_sequences
-- - process-event-sequences function is no longer needed
-- - analyze-event-sequences now JOINs with subscribers_insights for copy/subscription counts

-- Drop the event_sequences_raw table (no longer used)
DROP TABLE IF EXISTS event_sequences_raw CASCADE;

-- Drop unused event_data JSONB column from user_event_sequences if it exists
-- (This was from an older schema iteration)
ALTER TABLE user_event_sequences DROP COLUMN IF EXISTS event_data;

-- Drop total_copies and total_subscriptions columns from user_event_sequences
-- These were always set to 0 and never populated correctly
-- analyze-event-sequences now gets these from subscribers_insights directly
ALTER TABLE user_event_sequences DROP COLUMN IF EXISTS total_copies;
ALTER TABLE user_event_sequences DROP COLUMN IF EXISTS total_subscriptions;

-- Add comment to document the new simplified architecture
COMMENT ON TABLE user_event_sequences IS
  'Stores aggregated event sequences per user. Populated directly by sync-event-sequences-v2.
   For copy/subscription counts, JOIN with subscribers_insights table.';

-- Verification: Show final schema
DO $$
DECLARE
  column_count INT;
BEGIN
  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_name = 'user_event_sequences'
    AND table_schema = 'public';

  RAISE NOTICE '✅ Cleanup complete - user_event_sequences now has % columns', column_count;
  RAISE NOTICE '   Expected: distinct_id (PK), event_sequence (JSONB), synced_at';
  RAISE NOTICE '   event_sequences_raw table dropped';
  RAISE NOTICE '   process-event-sequences function no longer needed';
END $$;
