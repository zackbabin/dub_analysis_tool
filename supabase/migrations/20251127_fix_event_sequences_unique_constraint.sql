-- Migration: Fix event_sequences_raw unique constraint for ON CONFLICT
-- Created: 2025-11-27
-- Purpose: Remove WHERE clause from unique index so ON CONFLICT can use it
--
-- Background:
-- - ON CONFLICT requires a full unique constraint, not a partial index
-- - Previous migration created partial index with WHERE clause
-- - This causes error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"

-- Drop the partial index
DROP INDEX IF EXISTS idx_event_sequences_raw_user_id_dedup;

-- Create FULL unique index without WHERE clause
-- This is required for ON CONFLICT to work
CREATE UNIQUE INDEX idx_event_sequences_raw_user_id_dedup
ON event_sequences_raw (user_id, event_time, portfolio_ticker);

COMMENT ON INDEX idx_event_sequences_raw_user_id_dedup IS
'Unique constraint for event deduplication. Supports ON CONFLICT clause in sync-event-sequences-v2 Edge Function.
Ensures no duplicate events for same (user_id, event_time, portfolio_ticker) combination.
Note: Full index (no WHERE clause) is required for ON CONFLICT to work.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed event_sequences_raw unique constraint';
  RAISE NOTICE '   - Removed WHERE clause from index';
  RAISE NOTICE '   - Full unique index on (user_id, event_time, portfolio_ticker)';
  RAISE NOTICE '   - ON CONFLICT will now work correctly';
  RAISE NOTICE '';
END $$;
