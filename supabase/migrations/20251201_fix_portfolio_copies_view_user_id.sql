-- Migration: Fix user_portfolio_creator_copies view to use user_id instead of distinct_id
-- Created: 2025-12-01
-- Purpose: The view was created before the column rename from distinct_id to user_id,
--          so it needs to be updated to reference the correct column name

-- Drop and recreate the view with user_id
DROP VIEW IF EXISTS user_portfolio_creator_copies CASCADE;

CREATE VIEW user_portfolio_creator_copies AS
SELECT
    user_id,
    portfolio_ticker,
    SUM(pdp_view_count) as pdp_view_count,
    MAX(CASE WHEN copy_count > 0 THEN 1 ELSE 0 END)::boolean as did_copy,
    SUM(copy_count) as copy_count,
    MAX(synced_at) as synced_at
FROM user_portfolio_creator_engagement
GROUP BY user_id, portfolio_ticker;

-- Recreate indexes on the underlying table for better view query performance
-- (these may already exist, using IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS idx_upce_user_portfolio ON user_portfolio_creator_engagement(user_id, portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_upce_synced_at ON user_portfolio_creator_engagement(synced_at);

-- Grant access to all roles
GRANT SELECT ON user_portfolio_creator_copies TO service_role;
GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
GRANT SELECT ON user_portfolio_creator_copies TO anon;

-- Update comment to reflect regular view
COMMENT ON VIEW user_portfolio_creator_copies IS 'Portfolio-level engagement aggregated by (user, portfolio). Regular view - always shows current data from user_portfolio_creator_engagement. No refresh needed.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed user_portfolio_creator_copies view';
  RAISE NOTICE '   - Updated to use user_id instead of distinct_id';
  RAISE NOTICE '   - Updated indexes to use user_id';
  RAISE NOTICE '';
END $$;
