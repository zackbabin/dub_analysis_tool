-- Create materialized view for Premium Creator Breakdown
-- Aggregates portfolio-level metrics to creator level
-- Includes engagement metrics and portfolio performance metrics

DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE MATERIALIZED VIEW premium_creator_breakdown AS
SELECT
    pc.creator_username,
    -- Aggregate engagement metrics from portfolio_creator_engagement_metrics
    -- Sum across all portfolios for all creator_ids with this username
    COALESCE(SUM(pcem.total_copies), 0) AS total_copies,
    COALESCE(SUM(pcem.total_pdp_views), 0) AS total_pdp_views,
    COALESCE(SUM(pcem.total_liquidations), 0) AS total_liquidations,
    -- Calculate copy CVR and liquidation rate
    CASE
        WHEN SUM(pcem.total_pdp_views) > 0
        THEN (SUM(pcem.total_copies)::numeric / SUM(pcem.total_pdp_views)::numeric) * 100
        ELSE 0
    END AS copy_cvr,
    CASE
        WHEN SUM(pcem.total_copies) > 0
        THEN (SUM(pcem.total_liquidations)::numeric / SUM(pcem.total_copies)::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    -- Aggregate subscription metrics from premium_creator_metrics
    -- Sum across all creator_ids with this username
    COALESCE(SUM(pcm.total_subscriptions), 0) AS total_subscriptions,
    COALESCE(SUM(pcm.total_paywall_views), 0) AS total_paywall_views,
    COALESCE(SUM(pcm.total_cancellations), 0) AS total_cancellations,
    -- Calculate subscription CVR and cancellation rate after aggregation
    CASE
        WHEN SUM(pcm.total_paywall_views) > 0
        THEN (SUM(pcm.total_subscriptions)::numeric / SUM(pcm.total_paywall_views)::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN SUM(pcm.total_subscriptions) > 0
        THEN (SUM(pcm.total_cancellations)::numeric / SUM(pcm.total_subscriptions)::numeric) * 100
        ELSE 0
    END AS cancellation_rate,
    -- Aggregate portfolio performance metrics
    -- Average all-time returns across all portfolios for all creator_ids with this username
    AVG(pbm.total_returns_percentage) AS avg_all_time_returns,
    -- Sum copy capital across all portfolios for all creator_ids with this username
    -- Returns NULL if sum is 0 or all values are NULL (to match frontend display logic)
    CASE
        WHEN SUM(pbm.total_position) > 0 THEN SUM(pbm.total_position)
        ELSE NULL
    END AS total_copy_capital
FROM premium_creators pc
LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
LEFT JOIN portfolio_breakdown_with_metrics pbm ON pc.creator_id = pbm.creator_id
GROUP BY pc.creator_username;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

-- Create function to refresh the view
CREATE OR REPLACE FUNCTION refresh_premium_creator_breakdown_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW premium_creator_breakdown;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Combines engagement metrics from portfolio_creator_engagement_metrics, subscription metrics from premium_creator_metrics, and performance metrics from portfolio_breakdown_with_metrics. Refresh after syncing creator data or uploading portfolio performance metrics.';
