-- Migration: Clean up obsolete indexes on user_portfolio_creator_engagement
-- Created: 2025-12-01
-- Purpose: Remove old indexes that reference distinct_id (now user_id) and redundant indexes
--
-- Problem: Many old indexes still reference distinct_id column which no longer exists
--          This causes slow queries and ON CONFLICT operations during upserts
-- Solution: Drop obsolete indexes, keep only the necessary ones for user_id

-- Drop all old indexes that reference distinct_id (column was renamed to user_id)
DROP INDEX IF EXISTS idx_engagement_distinct_id;
DROP INDEX IF EXISTS idx_upce_composite;  -- Uses distinct_id
DROP INDEX IF EXISTS idx_upce_creator_copy;  -- Uses distinct_id
DROP INDEX IF EXISTS idx_upce_did_copy;
DROP INDEX IF EXISTS idx_upce_distinct_copy;  -- Uses distinct_id
DROP INDEX IF EXISTS idx_upce_distinct_id;
DROP INDEX IF EXISTS idx_upce_distinct_portfolio;  -- Uses distinct_id

-- Drop redundant indexes (covered by unique index or other indexes)
DROP INDEX IF EXISTS idx_engagement_creator;  -- Redundant with idx_upce_creator_id
DROP INDEX IF EXISTS idx_engagement_portfolio;  -- Redundant with newer composite indexes

-- Keep these essential indexes:
-- 1. user_portfolio_creator_engagement_user_portfolio_creator (UNIQUE on user_id, portfolio_ticker, creator_id) - for ON CONFLICT
-- 2. idx_user_portfolio_creator_engagement_user_id (user_id) - for user lookups
-- 3. idx_upce_user_portfolio (user_id, portfolio_ticker) - for portfolio queries
-- 4. idx_upce_creator_id (creator_id) - for creator lookups
-- 5. idx_upce_synced_at (synced_at) - for time-based queries

-- Verify remaining indexes
DO $$
DECLARE
  index_count integer;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE tablename = 'user_portfolio_creator_engagement';

  RAISE NOTICE '';
  RAISE NOTICE '✅ Cleaned up obsolete indexes on user_portfolio_creator_engagement';
  RAISE NOTICE '   - Dropped 9 obsolete/redundant indexes';
  RAISE NOTICE '   - Kept 5 essential indexes for optimal performance';
  RAISE NOTICE '   - Current index count: %', index_count;
  RAISE NOTICE '   - This should significantly speed up ON CONFLICT upserts';
  RAISE NOTICE '';
END $$;
