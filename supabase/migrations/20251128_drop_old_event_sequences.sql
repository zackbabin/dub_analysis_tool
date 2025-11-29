-- Migration: Drop old event_sequences_raw table and event_sequences view
-- Created: 2025-11-28
-- Purpose: Clean up after splitting into portfolio_sequences_raw and creator_sequences_raw
-- Note: All dependencies have been migrated to the new tables/views

-- Drop the old event_sequences view (CASCADE will drop any dependent objects)
DROP VIEW IF EXISTS event_sequences CASCADE;

-- Drop old indexes from event_sequences_raw (if they still exist)
DROP INDEX IF EXISTS idx_event_sequences_raw_unique;
DROP INDEX IF EXISTS idx_event_sequences_raw_portfolio_unique;
DROP INDEX IF EXISTS idx_event_sequences_raw_creator_unique;
DROP INDEX IF EXISTS idx_event_sequences_raw_synced_at;
DROP INDEX IF EXISTS idx_event_sequences_raw_processed_at;
DROP INDEX IF EXISTS idx_event_sequences_raw_event_name;
DROP INDEX IF EXISTS idx_event_sequences_raw_creator_type;
DROP INDEX IF EXISTS idx_event_sequences_enrichment;
DROP INDEX IF EXISTS idx_event_sequences_lookup;
DROP INDEX IF EXISTS idx_event_sequences_raw_dedup;

-- Drop the old event_sequences_raw table (CASCADE will drop any remaining dependencies)
DROP TABLE IF EXISTS event_sequences_raw CASCADE;

-- Log the cleanup
DO $$
DECLARE
  portfolio_count INTEGER;
  creator_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO portfolio_count FROM portfolio_sequences_raw;
  SELECT COUNT(*) INTO creator_count FROM creator_sequences_raw;

  RAISE NOTICE '';
  RAISE NOTICE '✅ Dropped old event_sequences objects';
  RAISE NOTICE '   - Dropped event_sequences view';
  RAISE NOTICE '   - Dropped event_sequences_raw table';
  RAISE NOTICE '   - Dropped all related indexes and triggers';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Now using split tables:';
  RAISE NOTICE '   - portfolio_sequences_raw (% rows) → portfolio_sequences view', portfolio_count;
  RAISE NOTICE '   - creator_sequences_raw (% rows) → creator_sequences view', creator_count;
  RAISE NOTICE '';
  RAISE NOTICE '✅ All sync and analyze functions updated to use new tables';
  RAISE NOTICE '';
END $$;
