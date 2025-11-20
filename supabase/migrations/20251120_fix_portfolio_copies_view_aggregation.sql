-- Fix user_portfolio_creator_copies view to aggregate by (distinct_id, portfolio_ticker)
-- Previously: One row per (user, portfolio, creator) - caused duplicate rows
-- Now: One row per (user, portfolio) - matches creator_copy view structure
-- This ensures portfolio combinations analysis works correctly

DROP VIEW IF EXISTS user_portfolio_creator_copies;

CREATE OR REPLACE VIEW user_portfolio_creator_copies AS
SELECT
    distinct_id,
    portfolio_ticker,
    SUM(pdp_view_count) as pdp_view_count,
    MAX(CASE WHEN copy_count > 0 THEN 1 ELSE 0 END)::boolean as did_copy,
    SUM(copy_count) as copy_count,
    SUM(liquidation_count) as liquidation_count,
    MAX(synced_at) as synced_at
FROM user_portfolio_creator_engagement
GROUP BY distinct_id, portfolio_ticker;

-- Grant access to all roles
GRANT SELECT ON user_portfolio_creator_copies TO service_role;
GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
GRANT SELECT ON user_portfolio_creator_copies TO anon;

-- Add comment explaining the view
COMMENT ON VIEW user_portfolio_creator_copies IS 'Portfolio-level engagement aggregated by (user, portfolio). Used by analyze-conversion-patterns for portfolio copy combinations.';
