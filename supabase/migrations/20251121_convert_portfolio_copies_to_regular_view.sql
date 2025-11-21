-- Convert user_portfolio_creator_copies from materialized to regular view
-- This eliminates the need for manual refresh operations and ensures data is always current

-- Drop the materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS user_portfolio_creator_copies CASCADE;

-- Recreate as a regular view with the same aggregation logic
CREATE VIEW user_portfolio_creator_copies AS
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

-- Create indexes on the underlying table for better view query performance
CREATE INDEX IF NOT EXISTS idx_upce_distinct_portfolio ON user_portfolio_creator_engagement(distinct_id, portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_upce_synced_at ON user_portfolio_creator_engagement(synced_at);

-- Grant access to all roles
GRANT SELECT ON user_portfolio_creator_copies TO service_role;
GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
GRANT SELECT ON user_portfolio_creator_copies TO anon;

-- Update comment to reflect regular view
COMMENT ON VIEW user_portfolio_creator_copies IS 'Portfolio-level engagement aggregated by (user, portfolio). Regular view - always shows current data from user_portfolio_creator_engagement. No refresh needed.';
