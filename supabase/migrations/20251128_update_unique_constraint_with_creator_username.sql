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

-- Create partial unique index for portfolio events
-- Only applies where portfolio_ticker is NOT NULL (i.e., "Viewed Portfolio Details" events)
CREATE UNIQUE INDEX idx_event_sequences_raw_portfolio_unique
ON event_sequences_raw (user_id, event_time, portfolio_ticker)
WHERE portfolio_ticker IS NOT NULL;

-- Create partial unique index for creator events
-- Only applies where creator_username is NOT NULL (i.e., "Viewed Creator Profile" events)
CREATE UNIQUE INDEX idx_event_sequences_raw_creator_unique
ON event_sequences_raw (user_id, event_time, creator_username)
WHERE creator_username IS NOT NULL;

-- Update comments
COMMENT ON INDEX idx_event_sequences_raw_portfolio_unique IS
'Ensures uniqueness for portfolio events based on (user_id, event_time, portfolio_ticker). Only applies to rows where portfolio_ticker IS NOT NULL. Used by sync-portfolio-sequences for ON CONFLICT deduplication.';

COMMENT ON INDEX idx_event_sequences_raw_creator_unique IS
'Ensures uniqueness for creator events based on (user_id, event_time, creator_username). Only applies to rows where creator_username IS NOT NULL. Used by sync-creator-sequences for ON CONFLICT deduplication.';

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
