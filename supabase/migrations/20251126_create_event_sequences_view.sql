-- Migration: Create event_sequences view and remove user_id column from event_sequences_raw
-- Created: 2025-11-26
-- Purpose: Keep event_sequences_raw as pure raw Mixpanel data, use view for user_id join
--
-- Changes:
-- 1. Remove user_id column from event_sequences_raw (keep it as raw Export API data only)
-- 2. Create event_sequences view that joins event_sequences_raw + user_first_copies
-- 3. Remove populate_event_sequences_user_id function (no longer needed)
--
-- This simplifies the architecture:
-- - event_sequences_raw = pure raw events from Mixpanel Export API
-- - event_sequences = view with user_id joined from user_first_copies

-- Drop old user_id population function
DROP FUNCTION IF EXISTS populate_event_sequences_user_id();

-- Remove user_id column from event_sequences_raw
ALTER TABLE event_sequences_raw DROP COLUMN IF EXISTS user_id;

-- Remove user_id index (if it exists)
DROP INDEX IF EXISTS idx_event_sequences_raw_user_id;

-- Create event_sequences view (joins raw events with user_first_copies to get user_id)
-- LEFT JOIN ensures only events that exist in event_sequences_raw are included
CREATE OR REPLACE VIEW event_sequences AS
SELECT
  esr.id,
  esr.distinct_id,
  ufc.user_id,
  esr.event_name,
  esr.event_time,
  esr.portfolio_ticker,
  esr.synced_at,
  esr.processed_at,
  esr.created_at
FROM event_sequences_raw esr
LEFT JOIN user_first_copies ufc ON esr.distinct_id = ufc.distinct_id;

-- Add index to event_sequences_raw.distinct_id for efficient joins
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_distinct_id_join
  ON event_sequences_raw(distinct_id);

-- Grant permissions
GRANT SELECT ON event_sequences TO service_role, authenticated, anon;

-- Update comments
COMMENT ON TABLE event_sequences_raw IS
'Raw Mixpanel event data from Export API. No user_id column - pure raw events.
Use event_sequences view to get user_id via join with user_first_copies.';

COMMENT ON VIEW event_sequences IS
'Event sequences with user_id joined from user_first_copies.
Use this view instead of event_sequences_raw when you need user_id.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created event_sequences view';
  RAISE NOTICE '   - event_sequences_raw: pure raw events (no user_id)';
  RAISE NOTICE '   - event_sequences: view with user_id from user_first_copies join';
  RAISE NOTICE '   - Removed populate_event_sequences_user_id function';
  RAISE NOTICE '';
END $$;
