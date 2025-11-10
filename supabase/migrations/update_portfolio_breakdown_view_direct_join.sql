-- Update materialized view to join directly on portfolio_ticker
-- No longer need portfolio_ticker_mapping table

DROP MATERIALIZED VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_breakdown_with_metrics AS
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

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_creator ON portfolio_breakdown_with_metrics(creator_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_ticker ON portfolio_breakdown_with_metrics(portfolio_ticker);

-- Grant permissions
GRANT SELECT ON portfolio_breakdown_with_metrics TO anon, authenticated;
