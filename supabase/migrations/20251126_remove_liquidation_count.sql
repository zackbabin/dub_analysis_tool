-- Migration: Remove liquidation_count column from user_portfolio_creator_engagement
-- Created: 2025-11-26
-- Purpose: Remove unused liquidation_count column that is never populated
--
-- Background:
-- - liquidation_count column exists but is never populated by any sync function
-- - process_portfolio_engagement_staging() doesn't include it in upserts
-- - No Mixpanel events track liquidations
-- - Column is always NULL/0, providing no value

-- Step 1: Drop dependent views that reference liquidation_count
DROP VIEW IF EXISTS user_portfolio_creator_copies CASCADE;

-- Step 2: Remove liquidation_count column from table
ALTER TABLE user_portfolio_creator_engagement
  DROP COLUMN IF EXISTS liquidation_count;

COMMENT ON TABLE user_portfolio_creator_engagement IS
'Portfolio-level user engagement tracking. Stores user interactions with specific portfolios.
Updated 2025-11-26 to remove unused liquidation_count column.';

-- Step 3: Recreate user_portfolio_creator_copies view (without liquidation_count)
CREATE VIEW user_portfolio_creator_copies AS
SELECT
  user_id,
  portfolio_ticker,
  creator_id,
  creator_username,
  pdp_view_count,
  copy_count,
  (copy_count > 0) AS did_copy,
  synced_at
FROM user_portfolio_creator_engagement;

GRANT SELECT ON user_portfolio_creator_copies TO service_role, authenticated, anon;

COMMENT ON VIEW user_portfolio_creator_copies IS
'Portfolio-level engagement showing user interactions with specific portfolios.
Simple read-only view of user_portfolio_creator_engagement.
Updated 2025-11-26 to remove liquidation_count column.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed liquidation_count column';
  RAISE NOTICE '   - Dropped from user_portfolio_creator_engagement table';
  RAISE NOTICE '   - Recreated user_portfolio_creator_copies view without liquidation_count';
  RAISE NOTICE '';
END $$;
