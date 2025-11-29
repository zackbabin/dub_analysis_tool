-- Migration: Remove events without required properties
-- Created: 2025-11-28
-- Purpose: Clean up event_sequences_raw to remove events that aren't useful for analysis

-- Delete Viewed Creator Profile events without creator_username
DELETE FROM event_sequences_raw
WHERE event_name = 'Viewed Creator Profile'
  AND creator_username IS NULL;

-- Delete Viewed Portfolio Details events without portfolio_ticker
DELETE FROM event_sequences_raw
WHERE event_name = 'Viewed Portfolio Details'
  AND portfolio_ticker IS NULL;

-- Log the results
DO $$
DECLARE
  creator_deleted INTEGER;
  portfolio_deleted INTEGER;
BEGIN
  -- Get count of deleted rows (approximation since we already deleted)
  SELECT COUNT(*) INTO creator_deleted
  FROM event_sequences_raw
  WHERE event_name = 'Viewed Creator Profile' AND creator_username IS NULL;
  
  SELECT COUNT(*) INTO portfolio_deleted
  FROM event_sequences_raw
  WHERE event_name = 'Viewed Portfolio Details' AND portfolio_ticker IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '✅ Cleaned up event_sequences_raw';
  RAISE NOTICE '   - Removed "Viewed Creator Profile" events without creator_username';
  RAISE NOTICE '   - Removed "Viewed Portfolio Details" events without portfolio_ticker';
  RAISE NOTICE '   - Events without these properties are not useful for analysis';
  RAISE NOTICE '';
END $$;
