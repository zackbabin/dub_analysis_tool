-- Fix user_portfolio_creator_copies view to aggregate by (distinct_id, portfolio_ticker)
-- Previously: One row per (user, portfolio, creator) - caused duplicate rows
-- Now: One row per (user, portfolio) - matches creator_copy view structure
-- Using MATERIALIZED VIEW for performance (aggregation is expensive)

DROP MATERIALIZED VIEW IF EXISTS user_portfolio_creator_copies CASCADE;
DROP VIEW IF EXISTS user_portfolio_creator_copies CASCADE;

CREATE MATERIALIZED VIEW user_portfolio_creator_copies AS
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

-- Create unique index (required for CONCURRENT refresh)
CREATE UNIQUE INDEX idx_portfolio_copies_unique ON user_portfolio_creator_copies(distinct_id, portfolio_ticker);

-- Create additional indexes for faster queries
CREATE INDEX idx_portfolio_copies_pdp_view_count ON user_portfolio_creator_copies(pdp_view_count) WHERE pdp_view_count > 0;
CREATE INDEX idx_portfolio_copies_did_copy ON user_portfolio_creator_copies(did_copy) WHERE did_copy = true;

-- Grant access to all roles
GRANT SELECT ON user_portfolio_creator_copies TO service_role;
GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
GRANT SELECT ON user_portfolio_creator_copies TO anon;

-- Add comment explaining the materialized view
COMMENT ON MATERIALIZED VIEW user_portfolio_creator_copies IS 'Portfolio-level engagement aggregated by (user, portfolio). Materialized for performance. Refresh after syncing user_portfolio_creator_engagement.';
