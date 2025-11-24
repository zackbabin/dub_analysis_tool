-- Migration: Simplify event sequences architecture
-- Created: 2025-11-24
-- Purpose: Remove expensive aggregation, store only raw "Viewed Portfolio Details" events
--
-- NEW APPROACH:
-- 1. Store raw events in event_sequences_raw (no aggregation)
-- 2. Store first copy times in user_first_copies (from Mixpanel chart 86612901)
-- 3. Query raw data directly for Claude analysis
-- 4. Let Claude calculate uniqueness and patterns
--
-- Benefits:
-- - No JSON aggregation overhead
-- - No merge/deduplication complexity
-- - Simple flat table queries
-- - Scales easily

-- Drop the expensive aggregation table (no longer needed)
DROP TABLE IF EXISTS user_event_sequences CASCADE;

-- Clean up event_sequences_raw - remove unused columns
ALTER TABLE event_sequences_raw
  DROP COLUMN IF EXISTS creator_username,
  DROP COLUMN IF EXISTS processed_at;

-- Update comment to reflect new usage
COMMENT ON TABLE event_sequences_raw IS
'Stores raw "Viewed Portfolio Details" events (last 14 days).
No aggregation - queried directly for Claude analysis.
Each row = one view event with timestamp and portfolio ticker.';

COMMENT ON COLUMN event_sequences_raw.distinct_id IS
'User ID (sanitized, no $device: prefix)';

COMMENT ON COLUMN event_sequences_raw.event_name IS
'Always "Viewed Portfolio Details" (single event type)';

COMMENT ON COLUMN event_sequences_raw.event_time IS
'When user viewed the portfolio';

COMMENT ON COLUMN event_sequences_raw.portfolio_ticker IS
'Which portfolio was viewed (e.g., $PELOSI, $AAPL)';

-- Create table for first copy events (from Mixpanel chart 86612901)
CREATE TABLE IF NOT EXISTS user_first_copies (
  id bigserial PRIMARY KEY,
  distinct_id text NOT NULL,
  first_copy_time timestamptz NOT NULL,
  synced_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT user_first_copies_unique_user UNIQUE (distinct_id)
);

CREATE INDEX IF NOT EXISTS idx_user_first_copies_distinct_id
  ON user_first_copies(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_first_copies_copy_time
  ON user_first_copies(first_copy_time);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_first_copies TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE user_first_copies_id_seq TO service_role, authenticated;

COMMENT ON TABLE user_first_copies IS
'Stores timestamp of first portfolio copy per user.
Synced from Mixpanel chart 86612901 (Uniques of Copied Portfolio).
Used to identify converters for event sequence analysis.';

COMMENT ON COLUMN user_first_copies.distinct_id IS
'User ID (sanitized, no $device: prefix)';

COMMENT ON COLUMN user_first_copies.first_copy_time IS
'Timestamp of users first portfolio copy (from Mixpanel chart)';

COMMENT ON COLUMN user_first_copies.synced_at IS
'When this record was synced from Mixpanel';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Simplified event sequences architecture';
  RAISE NOTICE '   - Dropped user_event_sequences table (no aggregation needed)';
  RAISE NOTICE '   - Cleaned up event_sequences_raw (removed creator_username, processed_at)';
  RAISE NOTICE '   - Created user_first_copies table (tracks first copy time)';
  RAISE NOTICE '   - Ready for simplified sync workflow';
  RAISE NOTICE '';
END $$;
