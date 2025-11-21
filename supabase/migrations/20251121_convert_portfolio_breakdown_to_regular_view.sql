-- Convert portfolio_breakdown_with_metrics from materialized to regular view
-- This view joins pre-aggregated materialized views - no need for separate refresh
-- Query executes quickly (<50ms) since it's just joining materialized views

-- Drop the materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

-- Recreate as a regular view with the same join logic
CREATE VIEW portfolio_breakdown_with_metrics AS
SELECT
    pcem.portfolio_ticker,
    pcem.creator_id,
    pc.creator_username,
    pcem.total_copies,
    pcem.total_pdp_views,
    pcem.total_liquidations,
    -- Calculate conversion rates
    CASE
        WHEN pcem.total_pdp_views > 0
        THEN (pcem.total_copies::numeric / pcem.total_pdp_views::numeric) * 100
        ELSE 0
    END as copy_cvr,
    CASE
        WHEN pcem.total_copies > 0
        THEN (pcem.total_liquidations::numeric / pcem.total_copies::numeric) * 100
        ELSE 0
    END as liquidation_rate,
    -- Join performance metrics directly on portfolio_ticker
    ppm.total_returns_percentage,
    ppm.total_position,
    ppm.inception_date,
    ppm.uploaded_at as metrics_updated_at
FROM portfolio_creator_engagement_metrics pcem
JOIN premium_creators pc ON pcem.creator_id = pc.creator_id
LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker;

-- Create indexes on underlying tables for better view query performance
-- (portfolio_creator_engagement_metrics already has indexes as a materialized view)
CREATE INDEX IF NOT EXISTS idx_ppm_portfolio_ticker ON portfolio_performance_metrics(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_pc_creator_id ON premium_creators(creator_id);

-- Grant access to all roles
GRANT SELECT ON portfolio_breakdown_with_metrics TO service_role;
GRANT SELECT ON portfolio_breakdown_with_metrics TO authenticated;
GRANT SELECT ON portfolio_breakdown_with_metrics TO anon;

-- Update comment to reflect regular view
COMMENT ON VIEW portfolio_breakdown_with_metrics IS 'Portfolio breakdown with engagement and performance metrics. Regular view (converted from materialized) - always shows current data. Joins portfolio_creator_engagement_metrics (materialized) with portfolio_performance_metrics. No refresh needed.';
