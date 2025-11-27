-- Migration: Add unique constraint for user_id-based event_sequences_raw
-- Created: 2025-11-27
-- Purpose: Add unique constraint to support ON CONFLICT upsert in sync-event-sequences-v2
--
-- Background:
-- - Edge function uses: ON CONFLICT (user_id, event_time, portfolio_ticker)
-- - Old constraint was on (distinct_id, event_name, event_time)
-- - Need to update to use user_id and portfolio_ticker instead

-- Drop old distinct_id-based unique index if it exists
DROP INDEX IF EXISTS idx_event_sequences_raw_dedup;

-- Create new unique index for user_id-based deduplication
-- This supports the upsert: ON CONFLICT (user_id, event_time, portfolio_ticker)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_sequences_raw_user_id_dedup
ON event_sequences_raw (user_id, event_time, portfolio_ticker)
WHERE user_id IS NOT NULL AND event_time IS NOT NULL;

COMMENT ON INDEX idx_event_sequences_raw_user_id_dedup IS
'Unique constraint for event deduplication. Supports ON CONFLICT clause in sync-event-sequences-v2 Edge Function.
Ensures no duplicate events for same (user_id, event_time, portfolio_ticker) combination.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added unique constraint for event_sequences_raw';
  RAISE NOTICE '   - Dropped old distinct_id-based index';
  RAISE NOTICE '   - Created new user_id-based index: (user_id, event_time, portfolio_ticker)';
  RAISE NOTICE '   - Supports ON CONFLICT upsert in sync-event-sequences-v2';
  RAISE NOTICE '';
END $$;
