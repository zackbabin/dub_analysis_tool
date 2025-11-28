-- Migration: Add creator_username to event_sequences_raw and view
-- Created: 2025-11-28
-- Purpose: Support creator sequence analysis by tracking creator_username for uniqueness

-- Add creator_username column to event_sequences_raw table
ALTER TABLE event_sequences_raw
ADD COLUMN IF NOT EXISTS creator_username TEXT;

-- Recreate event_sequences view to include creator_username
DROP VIEW IF EXISTS event_sequences CASCADE;

CREATE OR REPLACE VIEW event_sequences AS
SELECT
  es.id,
  es.user_id,
  es.event_name,
  es.event_time,
  es.portfolio_ticker,
  es.creator_username,  -- Added for creator sequence analysis
  fc.first_copy_time
FROM event_sequences_raw es
LEFT JOIN user_first_copies fc ON es.user_id = fc.user_id;

-- Grant permissions
GRANT SELECT ON event_sequences TO service_role, authenticated, anon;

-- Update comments
COMMENT ON COLUMN event_sequences_raw.creator_username IS
'Creator username from Mixpanel creatorUsername property. Used to determine uniqueness in creator sequence analysis.';

COMMENT ON VIEW event_sequences IS
'Event sequences with first_copy_time joined. Includes both portfolio and creator event data:
- portfolio_ticker: For "Viewed Portfolio Details" uniqueness calculation
- creator_username: For "Viewed Creator Profile" uniqueness calculation
- first_copy_time: For filtering events before first copy
Use this view for LLM analysis. Filter pre-copy events: WHERE event_time < first_copy_time';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added creator_username to event_sequences';
  RAISE NOTICE '   - Added creator_username column to event_sequences_raw table';
  RAISE NOTICE '   - Updated event_sequences view to include creator_username';
  RAISE NOTICE '   - portfolio_ticker: Used for portfolio sequence analysis';
  RAISE NOTICE '   - creator_username: Used for creator sequence analysis';
  RAISE NOTICE '';
END $$;
