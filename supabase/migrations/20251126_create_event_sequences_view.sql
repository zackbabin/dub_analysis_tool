-- Migration: Simplify event sequences to use only user_id
-- Created: 2025-11-26
-- Purpose: Remove distinct_id columns and use only user_id from Export API
--
-- Changes:
-- 1. Remove distinct_id column from event_sequences_raw
-- 2. Remove distinct_id column from user_first_copies
-- 3. Keep user_id as the primary identifier (from Export API $user_id)
-- 4. Create event_sequences view (simple pass-through of event_sequences_raw)
-- 5. Remove populate_event_sequences_user_id function (no longer needed)
--
-- Architecture:
-- - event_sequences_raw: Stores raw events with only user_id (from Export API $user_id)
-- - user_first_copies: Stores first copy times with only user_id (from Insights API $user_id)
-- - event_sequences: View that selects from event_sequences_raw (for backwards compatibility)

-- Drop old user_id population function (no longer needed)
DROP FUNCTION IF EXISTS populate_event_sequences_user_id();

-- Drop existing event_sequences view (will recreate without distinct_id)
DROP VIEW IF EXISTS event_sequences;

-- Drop any triggers that depend on distinct_id
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON event_sequences_raw;
DROP TRIGGER IF EXISTS clean_distinct_id_trigger ON user_first_copies;

-- Remove old distinct_id indexes
DROP INDEX IF EXISTS idx_event_sequences_raw_distinct_id;
DROP INDEX IF EXISTS idx_event_sequences_raw_distinct_id_join;
DROP INDEX IF EXISTS idx_user_first_copies_distinct_id;

-- Add user_id column to event_sequences_raw if it doesn't exist
ALTER TABLE event_sequences_raw ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Add user_id column to user_first_copies if it doesn't exist
ALTER TABLE user_first_copies ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Remove distinct_id column from event_sequences_raw
ALTER TABLE event_sequences_raw DROP COLUMN IF EXISTS distinct_id;

-- Remove distinct_id column from user_first_copies
ALTER TABLE user_first_copies DROP COLUMN IF EXISTS distinct_id;

-- Remove synced_at and created_at columns (redundant - we track sync status in sync_logs)
ALTER TABLE event_sequences_raw DROP COLUMN IF EXISTS synced_at;
ALTER TABLE event_sequences_raw DROP COLUMN IF EXISTS created_at;
ALTER TABLE user_first_copies DROP COLUMN IF EXISTS synced_at;
ALTER TABLE user_first_copies DROP COLUMN IF EXISTS created_at;

-- Create index on user_id for event_sequences_raw
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_user_id
  ON event_sequences_raw(user_id);

-- Create index on user_id for user_first_copies (primary key)
CREATE UNIQUE INDEX IF NOT EXISTS user_first_copies_user_id_key
  ON user_first_copies(user_id);

-- Create event_sequences view (simple pass-through)
CREATE OR REPLACE VIEW event_sequences AS
SELECT
  id,
  user_id,
  event_name,
  event_time,
  portfolio_ticker
FROM event_sequences_raw;

-- Grant permissions
GRANT SELECT ON event_sequences TO service_role, authenticated, anon;

-- Update comments
COMMENT ON TABLE event_sequences_raw IS
'Raw Mixpanel event data from Export API. Uses user_id from $user_id property (merged identity).';

COMMENT ON TABLE user_first_copies IS
'Users who copied at least once, with first copy time. Uses user_id from Insights API $user_id (merged identity).';

COMMENT ON VIEW event_sequences IS
'Event sequences view. Pass-through of event_sequences_raw.
Use this view for queries to allow for future optimizations.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Simplified event sequences to use only user_id';
  RAISE NOTICE '   - Removed distinct_id from event_sequences_raw';
  RAISE NOTICE '   - Removed distinct_id from user_first_copies';
  RAISE NOTICE '   - Both tables now use only user_id (from Export/Insights API $user_id)';
  RAISE NOTICE '';
END $$;
