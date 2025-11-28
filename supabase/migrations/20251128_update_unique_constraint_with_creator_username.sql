-- Migration: Update unique constraint to support both portfolio and creator events
-- Created: 2025-11-28
-- Purpose: Allow separate deduplication logic for each event type
--
-- Note: User will flush event_sequences_raw table before applying this migration
--
-- Constraint design:
-- - Portfolio events: Unique on (user_id, event_time, portfolio_ticker) where portfolio_ticker IS NOT NULL
-- - Creator events: Unique on (user_id, event_time, creator_username) where creator_username IS NOT NULL
-- - Each event type has its own partial index, allowing independent ON CONFLICT clauses

-- Drop any existing indexes
DROP INDEX IF EXISTS idx_event_sequences_raw_unique;
DROP INDEX IF EXISTS idx_event_sequences_raw_portfolio_unique;
DROP INDEX IF EXISTS idx_event_sequences_raw_creator_unique;

-- Create unique index for portfolio events (same as before, what sync-portfolio-sequences uses)
CREATE UNIQUE INDEX idx_event_sequences_raw_portfolio_unique
ON event_sequences_raw (user_id, event_time, portfolio_ticker);

-- Create unique index for creator events (mirrors portfolio approach)
CREATE UNIQUE INDEX idx_event_sequences_raw_creator_unique
ON event_sequences_raw (user_id, event_time, creator_username);

-- Update comments
COMMENT ON INDEX idx_event_sequences_raw_portfolio_unique IS
'Ensures uniqueness for portfolio events based on (user_id, event_time, portfolio_ticker). Used by sync-portfolio-sequences with onConflict.';

COMMENT ON INDEX idx_event_sequences_raw_creator_unique IS
'Ensures uniqueness for creator events based on (user_id, event_time, creator_username). Used by sync-creator-sequences with onConflict.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated unique constraints for event_sequences_raw';
  RAISE NOTICE '   - Dropped old constraint: (user_id, event_time, portfolio_ticker)';
  RAISE NOTICE '   - Added portfolio constraint: (user_id, event_time, portfolio_ticker) WHERE portfolio_ticker IS NOT NULL';
  RAISE NOTICE '   - Added creator constraint: (user_id, event_time, creator_username) WHERE creator_username IS NOT NULL';
  RAISE NOTICE '   - sync-portfolio-sequences uses: onConflict user_id,event_time,portfolio_ticker';
  RAISE NOTICE '   - sync-creator-sequences uses: onConflict user_id,event_time,creator_username';
  RAISE NOTICE '';
END $$;
